import assert from 'node:assert/strict';
import test from 'node:test';

const ok = data => new Response(JSON.stringify({ success: true, data }));
const unavailable = () => new Response(JSON.stringify({ success: false, error: { code: 'NATIVE_HISTORY_UNAVAILABLE' } }), { status: 503 });

async function client(responses, options = {}) {
  const { nativeHistoryRequest } = await import('../src/native-session-switch-restore.mjs');
  const calls = [], sleeps = [];
  const request = nativeHistoryRequest({ relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN',
    sleep: async ms => { sleeps.push(ms); }, ...options,
    fetchImpl: async url => { calls.push(url); const next = responses.shift(); if (next instanceof Error) throw next; return next(); } });
  return { request, calls, sleeps };
}

test('idempotent relay requests ride out a database or app restart with bounded backoff', async () => {
  const { request, calls, sleeps } = await client([unavailable, () => { throw new Error('socket hang up'); }, () => ok({ expectedHeadMessageId: null })]);
  assert.deepEqual(await request('continuation-state', { conversationId: 'x' }), { expectedHeadMessageId: null });
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [5_000, 15_000]);
});

test('persistent unavailability gives up after four attempts with a sanitized code', async () => {
  const { request, calls, sleeps } = await client([unavailable, unavailable, unavailable, unavailable, unavailable]);
  await assert.rejects(request('continuation-release', {}), e => e.code === 'NATIVE_RESTORE_UNAVAILABLE' && !e.message.includes('PRIVATE'));
  assert.equal(calls.length, 4);
  assert.deepEqual(sleeps, [5_000, 15_000, 30_000]);
});

test('switch metadata calls retry unavailability; refusals and unlisted routes never retry', async () => {
  for (const route of ['choices', 'continuation-attach', 'continuation-release-begin']) {
    const { request, calls } = await client([unavailable, () => ok({ done: true })]);
    assert.deepEqual(await request(route, {}), { done: true });
    assert.equal(calls.length, 2, route);
  }
  for (const route of ['referenced-sessions', 'attachment-upload-slot']) {
    const { request, calls } = await client([unavailable, () => ok({})]);
    await assert.rejects(request(route, {}), e => e.code === 'NATIVE_RESTORE_UNAVAILABLE');
    assert.deepEqual(calls, [`https://relay.invalid/internal/native-live-session-store/native-history/${route}`]);
  }
  const busy = await client([() => new Response(JSON.stringify({ success: false, error: { code: 'NATIVE_CONVERSATION_BUSY' } }), { status: 409 }), () => ok({})]);
  await assert.rejects(busy.request('continuation-attach', {}), e => e.code === 'NATIVE_CONVERSATION_BUSY');
  assert.equal(busy.calls.length, 1);
});

test('every switch request gets the same short bound', async () => {
  const { nativeHistoryRequest, NATIVE_HISTORY_REQUEST_TIMEOUT_MS } = await import('../src/native-session-switch-restore.mjs');
  const original = AbortSignal.timeout;
  const durations = [];
  AbortSignal.timeout = ms => { durations.push(ms); return new AbortController().signal; };
  try {
    const request = nativeHistoryRequest({ relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN', fetchImpl: async () => ok({}) });
    await request('continuation-attach', { small: true });
    await request('choices', { small: true });
    assert.deepEqual(durations, [NATIVE_HISTORY_REQUEST_TIMEOUT_MS, NATIVE_HISTORY_REQUEST_TIMEOUT_MS]);
  } finally { AbortSignal.timeout = original; }
});

test('refusals keep the codes the server still sends; codes of the retired history restore collapse', async () => {
  const refuse = async code => (await client([() => new Response(JSON.stringify({ success: false, error: { code } }), { status: 409 })])).request('continuation-attach', {}).then(assert.fail, error => error.code);
  for (const code of ['NATIVE_SESSION_SWITCHING', 'NATIVE_CONVERSATION_BUSY', 'STALE_NATIVE_PROJECTION', 'NATIVE_RELEASE_BEGIN_REQUIRED',
    'CANONICAL_CHECKPOINT_CHANGED', 'NATIVE_SOURCE_BINDING_REQUIRED', 'EXPLICIT_BRANCH_SELECTION_REQUIRED', 'CLEANUP_IN_PROGRESS',
    'NATIVE_CONVERSATION_NOT_FOUND', 'NATIVE_SESSION_ALREADY_ATTACHED', 'INVALID_NATIVE_PROJECTION']) assert.equal(await refuse(code), code);
  for (const code of ['CANONICAL_HEAD_CHANGED', 'CANONICAL_HISTORY_CHANGED', 'NATIVE_HISTORY_REWRITTEN', 'NATIVE_TRANSCRIPT_DIVERGED', 'INVALID_NATIVE_SNAPSHOT',
    'BATCH_TOO_LARGE', 'INVALID_NATIVE_ASSET', 'NATIVE_ASSET_UNAVAILABLE', 'NATIVE_ASSET_MISMATCH', 'NATIVE_SYNC_BASE_CHANGED']) assert.equal(await refuse(code), 'NATIVE_RESTORE_SERVER_REJECTED', code);
});
