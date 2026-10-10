import { preflightNativeSessionSwitch } from './native-session-switch-preflight.mjs';
import { readDesktopNativeHistory } from './native-session-inspection.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = code => Object.assign(new Error(code), { code });
const publicCodes = new Set(['NATIVE_CONVERSATION_BUSY', 'STALE_NATIVE_PROJECTION', 'CANONICAL_HEAD_CHANGED', 'CANONICAL_HISTORY_CHANGED', 'CANONICAL_CHECKPOINT_CHANGED', 'NATIVE_SOURCE_BINDING_REQUIRED', 'EXPLICIT_BRANCH_SELECTION_REQUIRED', 'NATIVE_HISTORY_REWRITTEN', 'NATIVE_TRANSCRIPT_DIVERGED', 'NATIVE_SESSION_RECOVERY_REQUIRED', 'CLEANUP_IN_PROGRESS', 'NATIVE_CONVERSATION_NOT_FOUND', 'INVALID_NATIVE_PROJECTION', 'INVALID_NATIVE_SNAPSHOT', 'BATCH_TOO_LARGE']);

// Explicit history restore only: no SDK query, native file writes, Desktop
// launching or execution lease. The server binds ownership to internal auth.
export async function restoreDesktopNativeSession({ input, conversationId, relayUrl, relayToken, fetchImpl = fetch }) {
  let endpoint;
  try { endpoint = new URL(relayUrl); } catch { throw fail('INVALID_NATIVE_RESTORE_ENDPOINT'); }
  if (!uuid.test(conversationId ?? '') || !relayToken || typeof relayToken !== 'string' ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' ||
    !(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)))) {
    throw fail('INVALID_NATIVE_RESTORE_ENDPOINT');
  }
  const request = async (route, payload) => {
    const body = JSON.stringify(payload);
    // Existing authenticated session-store parser is 32 MB; fail before a
    // request rather than truncate records or silently split a restore txn.
    if (Buffer.byteLength(body, 'utf8') > 30 * 1024 * 1024) throw fail('NATIVE_RESTORE_PAYLOAD_TOO_LARGE');
    try {
      const response = await fetchImpl(new URL('internal/native-live-session-store/native-history/' + route, endpoint).href, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + relayToken }, body,
      });
      const text = await readBoundedResponse(response);
      const value = JSON.parse(text);
      if (!response.ok || value.success !== true) throw fail(publicCodes.has(value?.error?.code) ? value.error.code : 'NATIVE_RESTORE_UNAVAILABLE');
      return value.data;
    } catch (error) {
      // Do not expose server errors, request bodies, URLs or credentials.
      throw fail(publicCodes.has(error?.code) || ['NATIVE_RESTORE_INVALID_RESPONSE', 'NATIVE_RESTORE_UNAVAILABLE'].includes(error?.code) ? error.code : 'NATIVE_RESTORE_UNAVAILABLE');
    }
  };
  const selection = await preflightNativeSessionSwitch(input);
  const history = await readDesktopNativeHistory(input);
  const state = await request('state', { conversationId, sessionId: selection.providerSessionId });
  if (!state || !(state.expectedHeadMessageId === null || uuid.test(state.expectedHeadMessageId ?? '')) ||
    !(state.expectedRevision === null || /^[0-9a-f]{64}$/.test(state.expectedRevision ?? ''))) throw fail('NATIVE_RESTORE_INVALID_RESPONSE');
  // A remote round trip may take time. Pin source/index and release again
  // immediately before submitting; backend still checks canonical CAS/busy.
  await preflightNativeSessionSwitch(input);
  const result = await request('restore', { conversationId, expectedHeadMessageId: state.expectedHeadMessageId,
    expectedRevision: state.expectedRevision, effectiveWorkingDirectory: selection.workingDirectory,
    projection: history.projection, nativeSnapshot: history.nativeSnapshot });
  if (!result || !['restored', 'already_current'].includes(result.outcome) || result.conversationId !== conversationId ||
    !uuid.test(result.headMessageId ?? '') || !Number.isSafeInteger(result.inserted) || result.inserted < 0) throw fail('NATIVE_RESTORE_INVALID_RESPONSE');
  return { outcome: result.outcome, conversationId, headMessageId: result.headMessageId, inserted: result.inserted,
    providerSessionId: selection.providerSessionId, providerCheckpointId: selection.providerCheckpointId,
    nativeRevision: selection.nativeRevision, executionAuthorized: false };
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
