import { requestNativeSessionDrain, requestNativeSessionResume } from './native-session-daemon-drain.mjs';
import { pinDrainedNativeSource, settleDrainedNativeSource } from './native-session-drain-settle.mjs';
import { preflightNativeSessionSwitch } from './native-session-switch-preflight.mjs';
import { readDesktopNativeHistory } from './native-session-inspection.mjs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { materializeNativeSessionHistoryAssets } from './native-session-assets.mjs';
import { nativeDisplayAssetRevision, nativeSyncDigest, neutralMessageFingerprint } from './native-session-history.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = code => Object.assign(new Error(code), { code });
// Time bounds, inner to outer. A large restore upload must give up before the
// server's own bound (Node's default 300-second requestTimeout; the server does
// not override it), and the local command's guard must exceed the whole
// bounded sequence. Full re-uploads are a first-import cost, not the steady state.
export const NATIVE_HISTORY_REQUEST_TIMEOUT_MS = 30_000;
export const NATIVE_RESTORE_UPLOAD_TIMEOUT_MS = 180_000;
export const NATIVE_SERVER_REQUEST_TIMEOUT_MS = 300_000;
// Image/document bytes travel in small idempotent batches ahead of the restore,
// so one dropped connection costs one batch instead of the whole history.
export const NATIVE_DISPLAY_ASSET_BATCH_BYTES = 2 * 1024 * 1024;
// The free-plan database restarts about every 10 minutes and the app follows it
// for ~40 s. Requests whose replay is idempotent wait that out; the rest fail.
export const NATIVE_RELAY_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
const retryOnUnavailable = new Set(['state', 'asset-stage', 'restore', 'release', 'asset', 'choices', 'continuation-state', 'continuation-attach', 'continuation-release']);
// A restore that timed out may still be committing; replaying it only queues
// behind the same lock, so only short read/bind calls retry after a timeout.
const retryOnTimeout = new Set(['state', 'asset-stage', 'release', 'asset', 'choices', 'continuation-state', 'continuation-attach', 'continuation-release']);
const publicCodes = new Set(['NATIVE_CONVERSATION_BUSY', 'STALE_NATIVE_PROJECTION', 'CANONICAL_HEAD_CHANGED', 'CANONICAL_HISTORY_CHANGED', 'CANONICAL_CHECKPOINT_CHANGED', 'NATIVE_SOURCE_BINDING_REQUIRED', 'EXPLICIT_BRANCH_SELECTION_REQUIRED', 'NATIVE_HISTORY_REWRITTEN', 'NATIVE_TRANSCRIPT_DIVERGED', 'NATIVE_SESSION_RECOVERY_REQUIRED', 'CLEANUP_IN_PROGRESS', 'NATIVE_CONVERSATION_NOT_FOUND', 'INVALID_NATIVE_PROJECTION', 'INVALID_NATIVE_SNAPSHOT', 'BATCH_TOO_LARGE', 'NATIVE_SESSION_ALREADY_ATTACHED', 'INVALID_NATIVE_ASSET', 'NATIVE_ASSET_UNAVAILABLE', 'NATIVE_ASSET_MISMATCH', 'NATIVE_SYNC_BASE_CHANGED']);

// Explicit history restore only: no SDK query, native file writes, Desktop
// launching or execution lease. The server binds ownership to internal auth.
export function nativeHistoryRequest({ relayUrl, relayToken, fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), retryDelaysMs = NATIVE_RELAY_RETRY_DELAYS_MS }) {
  let endpoint;
  try { endpoint = new URL(relayUrl); } catch { throw fail('INVALID_NATIVE_RESTORE_ENDPOINT'); }
  if (!relayToken || typeof relayToken !== 'string' ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' ||
    !(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)))) {
    throw fail('INVALID_NATIVE_RESTORE_ENDPOINT');
  }
  const attempt = async (route, payload) => {
    const body = JSON.stringify(payload);
    // Existing authenticated session-store parser is 32 MB; fail before a
    // request rather than truncate records or silently split a restore txn.
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > 30 * 1024 * 1024) throw fail('NATIVE_RESTORE_PAYLOAD_TOO_LARGE');
    // A restore spends its time uploading and in one server transaction; large
    // staging batches need upload time on slow links.
    const upload = route === 'restore' || (route === 'asset-stage' && bytes >= 1024 * 1024);
    const timeoutMs = upload ? NATIVE_RESTORE_UPLOAD_TIMEOUT_MS : NATIVE_HISTORY_REQUEST_TIMEOUT_MS;
    let signal;
    try {
      signal = AbortSignal.timeout(timeoutMs);
      const routePath = route === 'attachment-upload-slot' ? 'internal/native-live-relay/attachments/upload-slots'
        : route.startsWith('attachment-complete/') && uuid.test(route.slice('attachment-complete/'.length))
          ? 'internal/native-live-relay/attachments/' + route.slice('attachment-complete/'.length) + '/complete'
          : 'internal/native-live-session-store/native-history/' + route;
      const response = await fetchImpl(new URL(routePath, endpoint).href, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + relayToken }, body,
      });
      const text = await readBoundedResponse(response);
      // Preserve canonical error codes; classify opaque HTTP 4xx refusals
      // without exposing response bodies, URLs, credentials or transcript data.
      const refused = response.status >= 400 && response.status < 500;
      let value;
      try { value = JSON.parse(text); }
      catch { throw fail(refused ? 'NATIVE_RESTORE_SERVER_REJECTED' : 'NATIVE_RESTORE_UNAVAILABLE'); }
      if (!response.ok || value.success !== true) throw fail(publicCodes.has(value?.error?.code) ? value.error.code
        : refused ? 'NATIVE_RESTORE_SERVER_REJECTED' : 'NATIVE_RESTORE_UNAVAILABLE');
      return value.data;
    } catch (error) {
      // Timeout means the request did not finish; a server-side rejection
      // has a distinct sanitized code and is never retried.
      if (signal?.aborted && signal.reason?.name === 'TimeoutError') throw fail('NATIVE_RESTORE_TIMEOUT');
      throw fail(publicCodes.has(error?.code) || ['NATIVE_RESTORE_INVALID_RESPONSE', 'NATIVE_RESTORE_UNAVAILABLE',
        'NATIVE_RESTORE_SERVER_REJECTED'].includes(error?.code) ? error.code : 'NATIVE_RESTORE_UNAVAILABLE');
    }
  };
  return async (route, payload) => {
    for (let index = 0; ; index++) {
      try { return await attempt(route, payload); }
      catch (error) {
        const retryable = (error.code === 'NATIVE_RESTORE_UNAVAILABLE' && retryOnUnavailable.has(route))
          || (error.code === 'NATIVE_RESTORE_TIMEOUT' && retryOnTimeout.has(route));
        if (!retryable || index >= retryDelaysMs.length) throw error;
        await sleep(retryDelaysMs[index]);
      }
    }
  };
}

// Send only what follows the server's synchronized base, when both sides agree
// on it by digest. Anything else falls back to the full history.
export function incrementalNativePayload(history, state) {
  let projection = history.projection, nativeSnapshot = history.nativeSnapshot;
  const messages = projection.messages, anchor = state?.messageAnchor, base = state?.entriesAnchor;
  if (anchor && Number.isSafeInteger(anchor.count) && anchor.count >= 1 && anchor.count <= messages.length) {
    const pairs = messages.slice(0, anchor.count).map(m => ({ sourceMessageId: m.sourceMessageId, fingerprint: neutralMessageFingerprint(m) }));
    // Keep at least one message: the projection must end at its checkpoint.
    const count = Math.min(anchor.count, messages.length - 1);
    if (nativeSyncDigest(pairs) === anchor.digest && count >= 1) {
      projection = { ...projection, messages: messages.slice(count), anchor: { count, digest: nativeSyncDigest(pairs.slice(0, count)) } };
    }
  }
  if (base && Number.isSafeInteger(base.count) && base.count >= 1 && base.count <= nativeSnapshot.entries.length
    && nativeDisplayAssetRevision(nativeSnapshot.entries.slice(0, base.count)) === base.digest) {
    nativeSnapshot = { ...nativeSnapshot, entries: nativeSnapshot.entries.slice(base.count), entriesOffset: base.count };
  }
  return { projection, nativeSnapshot };
}

export const restoreDesktopNativeSession = options => restoreNativeSessionHistory(options, true);

async function restoreNativeSessionHistory({ input, conversationId, relayUrl, relayToken, fetchImpl = fetch,
  recoveryDirectory = input?.recoveryDirectory ?? path.join(homedir(), '.leileios'), uploadImpl = fetch, sleep, retryDelaysMs }, resumeDaemon) {
  if (!uuid.test(conversationId ?? '')) throw fail('INVALID_NATIVE_RESTORE_ENDPOINT');
  const request = nativeHistoryRequest({ relayUrl, relayToken, fetchImpl, sleep, retryDelaysMs });
  await assertNativeHandoffRecoveryClear(recoveryDirectory);
  const selection = await preflightNativeSessionSwitch(input);
  input = { ...input, expectedHistoryRevision: selection.historyRevision };
  const history = await readDesktopNativeHistory(input);
  const state = await request('state', { conversationId, sessionId: selection.providerSessionId });
  if (!state || !(state.expectedHeadMessageId === null || uuid.test(state.expectedHeadMessageId ?? '')) ||
    !(state.expectedRevision === null || /^[0-9a-f]{64}$/.test(state.expectedRevision ?? ''))) throw fail('NATIVE_RESTORE_INVALID_RESPONSE');
  const displayAssets = history.nativeSnapshot.displayAssets;
  if (displayAssets) await stageNativeDisplayAssets({ request, sessionId: history.nativeSnapshot.sessionId, assets: displayAssets });
  const staged = displayAssets ? { displayAssets: { revision: displayAssets.revision, stagedCount: displayAssets.entries.length } } : {};
  // A remote round trip may take time. Pin source/index and release again
  // immediately before submitting; backend still checks canonical CAS/busy.
  await preflightNativeSessionSwitch(input);
  await assertNativeHandoffRecoveryClear(recoveryDirectory);
  const submit = ({ projection, nativeSnapshot }) => request('restore', { conversationId, expectedHeadMessageId: state.expectedHeadMessageId,
    expectedRevision: state.expectedRevision, effectiveWorkingDirectory: selection.workingDirectory,
    projection, nativeSnapshot: { ...nativeSnapshot, ...staged } });
  const incremental = incrementalNativePayload(history, state);
  let result;
  try { result = await submit(incremental); }
  catch (error) {
    // The base moved between `state` and `restore`: resend the full history once.
    if (error?.code !== 'NATIVE_SYNC_BASE_CHANGED' || incremental.projection === history.projection && incremental.nativeSnapshot === history.nativeSnapshot) throw error;
    result = await submit({ projection: history.projection, nativeSnapshot: history.nativeSnapshot });
  }
  if (!result || !['restored', 'already_current'].includes(result.outcome) || result.conversationId !== conversationId ||
    !uuid.test(result.headMessageId ?? '') || !Number.isSafeInteger(result.inserted) || result.inserted < 0 ||
    !(result.pendingAssets === undefined || (Array.isArray(result.pendingAssets) && result.pendingAssets.every(ref =>
      uuid.test(ref?.sourceEntryUuid ?? '') && Number.isSafeInteger(ref.sourceBlockOrdinal))))) throw fail('NATIVE_RESTORE_INVALID_RESPONSE');
  await preflightNativeSessionSwitch(input);
  // Only assets the server still lacks; older servers do not say, so check all.
  const assets = await materializeNativeSessionHistoryAssets({ history, conversationId, request, uploadImpl,
    only: result.pendingAssets && new Set(result.pendingAssets.map(ref => `${ref.sourceEntryUuid}:${ref.sourceBlockOrdinal}`)) });
  await preflightNativeSessionSwitch(input);
  await assertNativeHandoffRecoveryClear(recoveryDirectory);
  const resumed = resumeDaemon ? await requestNativeSessionResume({ recoveryDirectory, conversationId, providerSessionId: selection.providerSessionId }) : null;
  return { ...(resumed ? { daemonResumed: true } : {}), outcome: result.outcome, conversationId, headMessageId: result.headMessageId, inserted: result.inserted,
    providerSessionId: selection.providerSessionId, providerCheckpointId: selection.providerCheckpointId,
    nativeRevision: selection.nativeRevision, executionAuthorized: false, assets };
}

// Resume from the server's stored count; staged rows stay inert until a restore
// names their revision and the server verifies the complete set.
export async function stageNativeDisplayAssets({ request, sessionId, assets, batchBytes = NATIVE_DISPLAY_ASSET_BATCH_BYTES }) {
  const { revision, entries } = assets;
  // Positional and idempotent; the relay request retries transport failures.
  const send = async (offset, batch) => {
    const state = await request('asset-stage', { sessionId, revision, total: entries.length, offset, entries: batch });
    if (!Number.isSafeInteger(state?.stored) || state.stored < 0 || state.stored > entries.length || typeof state.complete !== 'boolean'
      || (state.complete && state.stored !== entries.length)) throw fail('NATIVE_RESTORE_INVALID_RESPONSE');
    return state;
  };
  let state = await send(0, []), restarted = false, batches = 0;
  while (!state.complete) {
    const offset = state.stored;
    let end = offset + 1, bytes = Buffer.byteLength(JSON.stringify(entries[offset]));
    while (end < entries.length && bytes + Buffer.byteLength(JSON.stringify(entries[end])) <= batchBytes) {
      bytes += Buffer.byteLength(JSON.stringify(entries[end])); end++;
    }
    state = await send(offset, entries.slice(offset, end));
    batches++;
    if (!state.complete && state.stored <= offset) {
      // The server discarded a complete set that did not match its revision.
      if (restarted) throw fail('NATIVE_ASSET_STAGE_INVALID');
      restarted = true;
    }
  }
  return { staged: entries.length, batches };
}

// Conservative local gate: outstanding recovery on this Mac must be replayed by
// the existing daemon, not discarded or marked complete by the switch command.
export async function assertNativeHandoffRecoveryClear(recoveryDirectory) {
  const directoryEntries = async (directory, includeHidden = false) => {
    try {
      if (!(await lstat(directory)).isDirectory()) throw fail('NATIVE_RECOVERY_UNCONFIRMED');
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.length > 1000) throw fail('NATIVE_RECOVERY_UNCONFIRMED');
      return includeHidden ? entries : entries.filter(entry => !entry.name.startsWith('.'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw fail('NATIVE_RECOVERY_UNCONFIRMED');
    }
  };
  for (const folder of ['terminal-results', 'background-results', 'session-store-append-receipts']) {
    for (const scope of await directoryEntries(path.join(recoveryDirectory, folder))) {
      if (!scope.isDirectory() || !/^[a-f0-9]{64}$/.test(scope.name)) throw fail('NATIVE_RECOVERY_UNCONFIRMED');
      const directory = path.join(recoveryDirectory, folder, scope.name);
      for (const entry of await directoryEntries(directory)) {
        // Quarantine directories persist after the daemon recovers their last
        // receipt. Only an actually empty background quarantine is inert.
        if (folder === 'background-results' && entry.name === 'blocked' && entry.isDirectory()
          && !(await directoryEntries(path.join(directory, 'blocked'), true)).length) continue;
        throw fail('NATIVE_SESSION_RECOVERY_REQUIRED');
      }
    }
  }
}

// `claude --desktop` refuses redirected stdout/stdin, so it runs under a pseudo
// terminal from `script`, whose own stdin must be /dev/null (a pipe breaks it).
function runUnderTerminal(file, args, { cwd, env, timeout }) {
  return new Promise((resolve, reject) => {
    const child = spawn('script', ['-q', '/dev/null', file, ...args], { cwd, env, stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(fail('NATIVE_DESKTOP_LAUNCH_FAILED')); });
  });
}

export async function launchDesktopNativeSession(selection, execute = runUnderTerminal, environment = process.env, home = homedir()) {
  const env = { ...environment };
  // The CLI keys its sign-in by config location: name only a non-default one.
  if (selection.configDirectory && path.resolve(selection.configDirectory) !== path.join(home, '.claude')) env.CLAUDE_CONFIG_DIR = selection.configDirectory;
  else delete env.CLAUDE_CONFIG_DIR;
  delete env.LEILEI_NATIVE_LIVE_RELAY_TOKEN;
  delete env.LEILEI_NATIVE_LIVE_RELAY_URL;
  try {
    await execute('claude', ['--desktop', '--resume', selection.providerSessionId], { cwd: selection.workingDirectory, env, timeout: 60_000 });
  } catch { throw fail('NATIVE_DESKTOP_LAUNCH_FAILED'); }
}

export async function handoffNativeSessionToDesktop({ input, conversationId, relayUrl, relayToken, fetchImpl = fetch,
  recoveryDirectory = input?.recoveryDirectory ?? path.join(homedir(), '.leileios'), launchImpl = launchDesktopNativeSession, sleep, retryDelaysMs, drainSettle }) {
  const request = nativeHistoryRequest({ relayUrl, relayToken, fetchImpl, sleep, retryDelaysMs });
  const pinned = await pinDrainedNativeSource(input);
  const drain = await requestNativeSessionDrain({ recoveryDirectory, conversationId, providerSessionId: input.expectedSessionId });
  if (drain && !drain.ready) throw fail('NATIVE_DAEMON_DRAIN_UNCONFIRMED');
  if (drain) input = await settleDrainedNativeSource(input, pinned, drainSettle);
  await assertNativeHandoffRecoveryClear(recoveryDirectory);
  const synced = await restoreNativeSessionHistory({ input, conversationId, relayUrl, relayToken, fetchImpl, recoveryDirectory, sleep, retryDelaysMs }, false);
  const selected = await preflightNativeSessionSwitch(input);
  await assertNativeHandoffRecoveryClear(recoveryDirectory);
  const released = await request('release', { conversationId, sessionId: synced.providerSessionId,
    expectedHeadMessageId: synced.headMessageId, expectedRevision: synced.nativeRevision, expectedCheckpointId: synced.providerCheckpointId });
  if (released?.owner !== 'desktop' || released.conversationId !== conversationId || released.providerSessionId !== synced.providerSessionId
    || released.providerCheckpointId !== synced.providerCheckpointId || released.headMessageId !== synced.headMessageId) throw fail('NATIVE_RESTORE_INVALID_RESPONSE');
  // Never roll back the fence on a launch error: the caller may have opened
  // Desktop despite a lost launcher response. Retry only after release checks.
  await preflightNativeSessionSwitch(input);
  await assertNativeHandoffRecoveryClear(recoveryDirectory);
  await launchImpl({ ...selected, configDirectory: input.configDirectory });
  return { ...released, ...(drain ? { drain } : {}), desktopLaunchRequested: true, desktopSessionVerified: false };
}

async function readBoundedResponse(response) {
  if (!response.body) throw fail('NATIVE_RESTORE_INVALID_RESPONSE');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) { await reader.cancel(); throw fail('NATIVE_RESTORE_INVALID_RESPONSE'); }
      chunks.push(Buffer.from(value));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { reader.releaseLock(); }
}
