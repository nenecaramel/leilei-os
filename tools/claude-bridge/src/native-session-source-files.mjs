import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { readNativeSession } from './native-session-catalog.mjs';
const fail = code => Object.assign(new Error(code), { code });

// Same project only, bounded, no symlink/archive traversal or native writes.
export async function readNativeHistorySources(projectDirectory, sessionId) {
  const files = (await readdir(projectDirectory, { withFileTypes: true })).filter(e =>
    e.isFile() && /^[a-f0-9-]{36}\.jsonl$/i.test(e.name) && e.name !== `${sessionId}.jsonl`).sort((a,b) => a.name.localeCompare(b.name));
  if (files.length > 256) throw fail('NATIVE_SOURCE_SCAN_LIMIT');
  let bytes = 0;
  const sources = [];
  for (const file of files) {
    bytes += (await stat(path.join(projectDirectory, file.name))).size;
    if (bytes > 256 * 1024 * 1024) throw fail('NATIVE_SOURCE_SCAN_LIMIT');
    sources.push(await readNativeSession(projectDirectory, file.name.slice(0, -6)));
  }
  return sources;
}

export async function verifyNativeHistorySources(projectDirectory, sources) {
  for (const source of sources) {
    if ((await readNativeSession(projectDirectory, source.sessionId)).revision !== source.revision) throw fail('NATIVE_INSPECTION_CHANGED');
  }
}
