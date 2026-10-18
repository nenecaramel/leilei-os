import path from 'node:path';
import { readOnlyFileSnapshot } from './read-only-file-snapshot.mjs';
import { readNativeSessionRelease } from './native-session-activity.mjs';

const fail = code => Object.assign(new Error(code), { code });
export const pinDrainedNativeSource = input => readOnlyFileSnapshot(
  path.join(input.projectDirectory, `${input.expectedSessionId}.jsonl`), 64 * 1024 * 1024);

// A drain receipt retires the SDK query; its child may still flush exit
// metadata. Preserve the exact pinned bytes and allow only that known suffix.
export async function settleDrainedNativeSource(input, pinned, { pollMs = 100, quietMs = 500, timeoutMs = 10_000 } = {}) {
  if (pinned.revision !== input.expectedRevision) throw fail('NATIVE_INSPECTION_CHANGED');
  const deadline = Date.now() + timeoutMs;
  let current = null, quietSince = 0, open = false;
  for (;;) {
    let next = null;
    try { next = await pinDrainedNativeSource(input); } catch { /* Poll a mid-flush source again. */ }
    open = (await readNativeSessionRelease(input.peerDirectory, input.expectedSessionId, { probeProcessStart: input.probeProcessStart })).state === 'still_open';
    if (!next || open || next.revision !== current?.revision) { current = next; quietSince = Date.now(); }
    else if (Date.now() - quietSince >= quietMs) break;
    if (Date.now() >= deadline) throw fail(open ? 'NATIVE_SESSION_STILL_OPEN' : 'NATIVE_INSPECTION_CHANGED');
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  if (current.revision === pinned.revision) return input;
  try {
    if (!current.bytes.subarray(0, pinned.bytes.length).equals(pinned.bytes)) throw new Error();
    const suffix = new TextDecoder('utf-8', { fatal: true }).decode(current.bytes.subarray(pinned.bytes.length));
    if (pinned.bytes.length && pinned.bytes.at(-1) !== 10 && !suffix.startsWith('\n')) throw new Error();
    const appended = suffix.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    if (!appended.length || appended.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry)
      || !['last-prompt', 'cost-state'].includes(entry.type) || Object.hasOwn(entry, 'uuid') || Object.hasOwn(entry, 'parentUuid')
      || (Object.hasOwn(entry, 'sessionId') && entry.sessionId !== input.expectedSessionId))) throw new Error();
  } catch { throw fail('NATIVE_INSPECTION_CHANGED'); }
  return { ...input, expectedRevision: current.revision };
}
