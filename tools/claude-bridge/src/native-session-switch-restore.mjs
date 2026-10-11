import { preflightNativeSessionSwitch } from './native-session-switch-preflight.mjs';
import { readDesktopNativeHistory } from './native-session-inspection.mjs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { materializeNativeSessionHistoryAssets } from './native-session-assets.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = code => Object.assign(new Error(code), { code });
// Time bounds, inner to outer. A large restore upload must give up before the
// server's own bound (Node's default 300-second requestTimeout; the server does
// not override it), and the local command's guard must exceed the whole
// bounded sequence. Full re-uploads are a first-import cost, not the steady state.
export const NATIVE_HISTORY_REQUEST_TIMEOUT_MS = 30_000;
export const NATIVE_RESTORE_UPLOAD_TIMEOUT_MS = 180_000;
export const NATIVE_SERVER_REQUEST_TIMEOUT_MS = 300_000;
const publicCodes = new Set(['NATIVE_CONVERSATION_BUSY', 'STALE_NATIVE_PROJECTION', 'CANONICAL_HEAD_CHANGED', 'CANONICAL_HISTORY_CHANGED', 'CANONICAL_CHECKPOINT_CHANGED', 'NATIVE_SOURCE_BINDING_REQUIRED', 'EXPLICIT_BRANCH_SELECTION_REQUIRED', 'NATIVE_HISTORY_REWRITTEN', 'NATIVE_TRANSCRIPT_DIVERGED', 'NATIVE_SESSION_RECOVERY_REQUIRED', 'CLEANUP_IN_PROGRESS', 'NATIVE_CONVERSATION_NOT_FOUND', 'INVALID_NATIVE_PROJECTION', 'INVALID_NATIVE_SNAPSHOT', 'BATCH_TOO_LARGE', 'NATIVE_SESSION_ALREADY_ATTACHED', 'INVALID_NATIVE_ASSET', 'NATIVE_ASSET_UNAVAILABLE', 'NATIVE_ASSET_MISMATCH']);

// Explicit history restore only: no SDK query, native file writes, Desktop
// launching or execution lease. The server binds ownership to internal auth.
export function nativeHistoryRequest({ relayUrl, relayToken, fetchImpl = fetch }) {
  let endpoint;
  try { endpoint = new URL(relayUrl); } catch { throw fail('INVALID_NATIVE_RESTORE_ENDPOINT'); }
  if (!relayToken || typeof relayToken !== 'string' ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' ||
    !(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)))) {
    throw fail('INVALID_NATIVE_RESTORE_ENDPOINT');
  }
  const request = async (route, payload) => {
    const body = JSON.stringify(payload);
    // Existing authenticated session-store parser is 32 MB; fail before a
    // request rather than truncate records or silently split a restore txn.
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > 30 * 1024 * 1024) throw fail('NATIVE_RESTORE_PAYLOAD_TOO_LARGE');
    // A large, single-transaction restore needs upload time on slow links.
    const timeoutMs = route === 'restore' && bytes >= 4 * 1024 * 1024 ? NATIVE_RESTORE_UPLOAD_TIMEOUT_MS : NATIVE_HISTORY_REQUEST_TIMEOUT_MS;
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
      // has a distinct sanitized code. Neither case is retried automatically.
      if (signal?.aborted && signal.reason?.name === 'TimeoutError') throw fail('NATIVE_RESTORE_TIMEOUT');
      throw fail(publicCodes.has(error?.code) || ['NATIVE_RESTORE_INVALID_RESPONSE', 'NATIVE_RESTORE_UNAVAILABLE',
        'NATIVE_RESTORE_SERVER_REJECTED'].includes(error?.code) ? error.code : 'NATIVE_RESTORE_UNAVAILABLE');
    }
  };
  return request;
}

export async function restoreDesktopNativeSession({ input, conversationId, relayUrl, relayToken, fetchImpl = fetch,
  recoveryDirectory = input?.recoveryDirectory ?? path.join(homedir(), '.leileios'), uploadImpl = fetch }) {
  if (!uuid.test(conversationId ?? '')) throw fail('INVALID_NATIVE_RESTORE_ENDPOINT');
  const request = nativeHistoryRequest({ relayUrl, relayToken, fetchImpl });
  await assertNativeHandoffRecoveryClear(recoveryDirectory);
  const selection = await preflightNativeSessionSwitch(input);
  input = { ...input, expectedHistoryRevision: selection.historyRevision };
  const history = await readDesktopNativeHistory(input);
  const state = await request('state', { conversationId, sessionId: selection.providerSessionId });
  if (!state || !(state.expectedHeadMessageId === null || uuid.test(state.expectedHeadMessageId ?? '')) ||
    !(state.expectedRevision === null || /^[0-9a-f]{64}$/.test(state.expectedRevision ?? ''))) throw fail('NATIVE_RESTORE_INVALID_RESPONSE');
  // A remote round trip may take time. Pin source/index and release again
  // immediately before submitting; backend still checks canonical CAS/busy.
  await preflightNativeSessionSwitch(input);
  await assertNativeHandoffRecoveryClear(recoveryDirectory);
  const result = await request('restore', { conversationId, expectedHeadMessageId: state.expectedHeadMessageId,
    expectedRevision: state.expectedRevision, effectiveWorkingDirectory: selection.workingDirectory,
    projection: history.projection, nativeSnapshot: history.nativeSnapshot });
  if (!result || !['restored', 'already_current'].includes(result.outcome) || result.conversationId !== conversationId ||
    !uuid.test(result.headMessageId ?? '') || !Number.isSafeInteger(result.inserted) || result.inserted < 0) throw fail('NATIVE_RESTORE_INVALID_RESPONSE');
  await preflightNativeSessionSwitch(input);
  const assets = await materializeNativeSessionHistoryAssets({ history, conversationId, request, uploadImpl });
  return { outcome: result.outcome, conversationId, headMessageId: result.headMessageId, inserted: result.inserted,
    providerSessionId: selection.providerSessionId, providerCheckpointId: selection.providerCheckpointId,
    nativeRevision: selection.nativeRevision, executionAuthorized: false, assets };
}

// Conservative local gate: outstanding recovery on this Mac must be replayed by
// the existing daemon, not discarded or marked complete by the switch command.
export async function assertNativeHandoffRecoveryClear(recoveryDirectory) {
  const directoryEntries = async directory => {
    try {
      if (!(await lstat(directory)).isDirectory()) throw fail('NATIVE_RECOVERY_UNCONFIRMED');
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.length > 1000) throw fail('NATIVE_RECOVERY_UNCONFIRMED');
      return entries.filter(entry => !entry.name.startsWith('.'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw fail('NATIVE_RECOVERY_UNCONFIRMED');
    }
  };
  for (const folder of ['terminal-results', 'session-store-append-receipts']) {
    for (const scope of await directoryEntries(path.join(recoveryDirectory, folder))) {
      if (!scope.isDirectory() || !/^[a-f0-9]{64}$/.test(scope.name)) throw fail('NATIVE_RECOVERY_UNCONFIRMED');
      if ((await directoryEntries(path.join(recoveryDirectory, folder, scope.name))).length) throw fail('NATIVE_SESSION_RECOVERY_REQUIRED');
    }
  }
}

export async function launchDesktopNativeSession(selection, execute = promisify(execFile), environment = process.env) {
  const env = { ...environment, CLAUDE_CONFIG_DIR: selection.configDirectory };
  delete env.LEILEI_NATIVE_LIVE_RELAY_TOKEN;
  delete env.LEILEI_NATIVE_LIVE_RELAY_URL;
  try {
    await execute('claude', ['--desktop', '--resume', selection.providerSessionId], {
      cwd: selection.workingDirectory, env, timeout: 60_000, maxBuffer: 64 * 1024,
    });
  } catch { throw fail('NATIVE_DESKTOP_LAUNCH_FAILED'); }
}

export async function handoffNativeSessionToDesktop({ input, conversationId, relayUrl, relayToken, fetchImpl = fetch,
  recoveryDirectory = path.join(homedir(), '.leileios'), launchImpl = launchDesktopNativeSession }) {
  const request = nativeHistoryRequest({ relayUrl, relayToken, fetchImpl });
  await assertNativeHandoffRecoveryClear(recoveryDirectory);
  const synced = await restoreDesktopNativeSession({ input, conversationId, relayUrl, relayToken, fetchImpl, recoveryDirectory });
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
  return { ...released, desktopLaunchRequested: true, desktopSessionVerified: false };
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
