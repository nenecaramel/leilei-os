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
  assert.deepEqual(await request('state', { conversationId: 'x' }), { expectedHeadMessageId: null });
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [5_000, 15_000]);
});

test('persistent unavailability gives up after four attempts with a sanitized code', async () => {
  const { request, calls, sleeps } = await client([unavailable, unavailable, unavailable, unavailable, unavailable]);
  await assert.rejects(request('release', {}), e => e.code === 'NATIVE_RESTORE_UNAVAILABLE' && !e.message.includes('PRIVATE'));
  assert.equal(calls.length, 4);
  assert.deepEqual(sleeps, [5_000, 15_000, 30_000]);
});

test('restore and asset binding retry unavailability; refusals and attachment slots never retry', async () => {
  for (const route of ['restore', 'asset', 'asset-stage']) {
    const { request, calls } = await client([unavailable, () => ok({ done: true })]);
    assert.deepEqual(await request(route, {}), { done: true });
    assert.equal(calls.length, 2, route);
  }
  for (const route of ['attachment-upload-slot', 'attachment-complete/00000000-0000-4000-8000-000000000001']) {
    const { request, calls } = await client([unavailable, () => ok({})]);
    await assert.rejects(request(route, {}), e => e.code === 'NATIVE_RESTORE_UNAVAILABLE');
    assert.equal(calls.length, 1, route);
  }
  const busy = await client([() => new Response(JSON.stringify({ success: false, error: { code: 'NATIVE_CONVERSATION_BUSY' } }), { status: 409 }), () => ok({})]);
  await assert.rejects(busy.request('restore', {}), e => e.code === 'NATIVE_CONVERSATION_BUSY');
  assert.equal(busy.calls.length, 1);
});

test('restore always gets the long bound because server-side work, not only upload, takes time', async () => {
  const { nativeHistoryRequest, NATIVE_RESTORE_UPLOAD_TIMEOUT_MS, NATIVE_HISTORY_REQUEST_TIMEOUT_MS } = await import('../src/native-session-switch-restore.mjs');
  const original = AbortSignal.timeout;
  const durations = [];
  AbortSignal.timeout = ms => { durations.push(ms); return new AbortController().signal; };
  try {
    const request = nativeHistoryRequest({ relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN', fetchImpl: async () => ok({}) });
    await request('restore', { small: true });
    await request('state', { small: true });
    assert.deepEqual(durations, [NATIVE_RESTORE_UPLOAD_TIMEOUT_MS, NATIVE_HISTORY_REQUEST_TIMEOUT_MS]);
  } finally { AbortSignal.timeout = original; }
});
