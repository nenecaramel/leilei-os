import path from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { nativeRecoveryProtectedSessions } from './native-transcript-archive-recovery.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = code => Object.assign(new Error(code), { code });
// Continuation switching exchanges metadata only; every request is short.
export const NATIVE_HISTORY_REQUEST_TIMEOUT_MS = 30_000;
// The free-plan database restarts about every 10 minutes and the app follows it
// for ~40 s. Requests whose replay is idempotent wait that out; the rest fail.
export const NATIVE_RELAY_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
const retryOnUnavailable = new Set(['choices', 'continuation-state', 'continuation-attach', 'continuation-release', 'continuation-release-begin', 'continuation-release-cancel']);
// Only these short read/bind calls retry; attachment routes never do.
const retryOnTimeout = retryOnUnavailable;
const publicCodes = new Set(['NATIVE_SESSION_SWITCHING', 'NATIVE_CONVERSATION_BUSY', 'STALE_NATIVE_PROJECTION', 'NATIVE_RELEASE_BEGIN_REQUIRED', 'CANONICAL_HEAD_CHANGED', 'CANONICAL_HISTORY_CHANGED', 'CANONICAL_CHECKPOINT_CHANGED', 'NATIVE_SOURCE_BINDING_REQUIRED', 'EXPLICIT_BRANCH_SELECTION_REQUIRED', 'NATIVE_HISTORY_REWRITTEN', 'NATIVE_TRANSCRIPT_DIVERGED', 'NATIVE_SESSION_RECOVERY_REQUIRED', 'CLEANUP_IN_PROGRESS', 'NATIVE_CONVERSATION_NOT_FOUND', 'INVALID_NATIVE_PROJECTION', 'INVALID_NATIVE_SNAPSHOT', 'BATCH_TOO_LARGE', 'NATIVE_SESSION_ALREADY_ATTACHED', 'INVALID_NATIVE_ASSET', 'NATIVE_ASSET_UNAVAILABLE', 'NATIVE_ASSET_MISMATCH', 'NATIVE_SYNC_BASE_CHANGED']);

// Authenticated switch metadata requests: no SDK query, native file writes,
// Desktop launching or execution lease. The server binds ownership to internal auth.
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
    let signal;
    try {
      signal = AbortSignal.timeout(NATIVE_HISTORY_REQUEST_TIMEOUT_MS);
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

// Conservative local gate: outstanding recovery on this Mac must be replayed by
// the existing daemon, not discarded or marked complete by the switch command.
export async function assertNativeHandoffRecoveryClear(recoveryDirectory, scope) {
  // Continuation switching names its conversation and session: only their own
  // pending or quarantined background receipts block it.
  if (!scope) throw fail('NATIVE_RECOVERY_UNCONFIRMED');
  const { sessions, conversations } = await nativeRecoveryProtectedSessions(recoveryDirectory);
  if (sessions.has(String(scope.providerSessionId).toLowerCase()) || conversations.has(String(scope.conversationId).toLowerCase()))
    throw fail('NATIVE_SESSION_RECOVERY_REQUIRED');
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
