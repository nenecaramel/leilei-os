import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const fail = code => Object.assign(new Error(code), { code });
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const carrier = (n, bytes) => ({ type: 'user', uuid: uuid(100 + n), message: { content: [
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.alloc(bytes, n).toString('base64') } }] } });

// Positional, idempotent mock of the server staging contract.
function stagingServer(entries, { preStored = 0, lostResponses = [], transportFailures = 0, resets = 0, refuse = null } = {}) {
  const stored = entries.slice(0, preStored), calls = [];
  let failures = transportFailures, remainingResets = resets;
  const request = async (route, payload) => {
    assert.equal(route, 'asset-stage');
    calls.push({ offset: payload.offset, count: payload.entries.length, bytes: Buffer.byteLength(JSON.stringify(payload)) });
    if (refuse) throw fail(refuse);
    if (failures > 0) { failures--; throw fail('NATIVE_RESTORE_UNAVAILABLE'); }
    if (payload.offset <= stored.length && stored.length < payload.offset + payload.entries.length) {
      stored.push(...payload.entries.slice(stored.length - payload.offset));
    }
    if (lostResponses.includes(calls.length)) throw fail('NATIVE_RESTORE_UNAVAILABLE');
    if (stored.length === payload.total) {
      if (remainingResets > 0) { remainingResets--; stored.length = 0; return { stored: 0, complete: false }; }
      return { stored: stored.length, complete: true };
    }
    return { stored: stored.length, complete: false };
  };
  return { request, stored, calls };
}

test('display assets upload in bounded batches and the staged set equals the original carriers', async () => {
  const { stageNativeDisplayAssets } = await import('../src/native-session-switch-restore.mjs');
  const entries = Array.from({ length: 6 }, (_, n) => carrier(n, 600 * 1024)); // ~800 KB base64: two per 2 MB batch
  const server = stagingServer(entries);
  const result = await stageNativeDisplayAssets({ request: server.request, sessionId: uuid(1), assets: { revision: 'r'.repeat(64), entries }, batchBytes: 2 * 1024 * 1024 });
  assert.deepEqual(server.stored, entries);
  assert.equal(result.batches, 3);
  assert.equal(server.calls[0].count, 0, 'first call only learns the stored count');
  for (const call of server.calls) assert.ok(call.bytes < 2 * 1024 * 1024 + 4096, `batch of ${call.bytes} bytes`);
});

test('a single carrier larger than the batch target is still sent alone', async () => {
  const { stageNativeDisplayAssets } = await import('../src/native-session-switch-restore.mjs');
  const entries = [carrier(1, 100), carrier(2, 3 * 1024 * 1024), carrier(3, 100)];
  const server = stagingServer(entries);
  await stageNativeDisplayAssets({ request: server.request, sessionId: uuid(1), assets: { revision: 'r'.repeat(64), entries }, batchBytes: 1024 * 1024 });
  assert.deepEqual(server.calls.slice(1).map(c => c.count), [1, 1, 1]);
  assert.deepEqual(server.stored, entries);
});

test('staging resumes from the server stored count instead of resending', async () => {
  const { stageNativeDisplayAssets } = await import('../src/native-session-switch-restore.mjs');
  const entries = Array.from({ length: 5 }, (_, n) => carrier(n, 1024));
  const server = stagingServer(entries, { preStored: 3 });
  await stageNativeDisplayAssets({ request: server.request, sessionId: uuid(1), assets: { revision: 'r'.repeat(64), entries } });
  assert.deepEqual(server.calls.map(c => [c.offset, c.count]), [[0, 0], [3, 2]]);
  assert.deepEqual(server.stored, entries);
});

// Staging through the real relay request: transport retries live there.
async function relayStaging(entries, { dropAfterWrite = [], unavailable = 0, refuse = null } = {}) {
  const { nativeHistoryRequest } = await import('../src/native-session-switch-restore.mjs');
  const server = stagingServer(entries);
  let calls = 0, outages = unavailable;
  const request = nativeHistoryRequest({ relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN', sleep: async () => {},
    fetchImpl: async (_url, options) => {
      calls++;
      if (refuse) return new Response(JSON.stringify({ success: false, error: { code: refuse } }), { status: 400 });
      if (outages > 0) { outages--; return new Response('{}', { status: 503 }); }
      const data = await server.request('asset-stage', JSON.parse(options.body));
      if (dropAfterWrite.includes(calls)) throw new Error('socket hang up');
      return new Response(JSON.stringify({ success: true, data }));
    } });
  return { request, server, calls: () => calls };
}

test('a dropped connection or lost response retries the same batch without duplicating carriers', async () => {
  const { stageNativeDisplayAssets } = await import('../src/native-session-switch-restore.mjs');
  const entries = Array.from({ length: 4 }, (_, n) => carrier(n, 600 * 1024));
  const relay = await relayStaging(entries, { dropAfterWrite: [2] });
  await stageNativeDisplayAssets({ request: relay.request, sessionId: uuid(1), assets: { revision: 'r'.repeat(64), entries }, batchBytes: 1024 * 1024 });
  assert.deepEqual(relay.server.stored, entries);
  assert.equal(relay.server.calls[1].offset, relay.server.calls[2].offset, 'lost response retried at the same offset');
});

test('transport failures retry a bounded number of times; refusals never retry', async () => {
  const { stageNativeDisplayAssets } = await import('../src/native-session-switch-restore.mjs');
  const entries = [carrier(1, 1024)];
  const flaky = await relayStaging(entries, { unavailable: 4 });
  await assert.rejects(stageNativeDisplayAssets({ request: flaky.request, sessionId: uuid(1), assets: { revision: 'r'.repeat(64), entries } }),
    e => e.code === 'NATIVE_RESTORE_UNAVAILABLE');
  assert.equal(flaky.calls(), 4);
  const recovered = await relayStaging(entries, { unavailable: 3 });
  await stageNativeDisplayAssets({ request: recovered.request, sessionId: uuid(1), assets: { revision: 'r'.repeat(64), entries } });
  assert.deepEqual(recovered.server.stored, entries);
  const refused = await relayStaging(entries, { refuse: 'INVALID_NATIVE_SNAPSHOT' });
  await assert.rejects(stageNativeDisplayAssets({ request: refused.request, sessionId: uuid(1), assets: { revision: 'r'.repeat(64), entries } }),
    e => e.code === 'INVALID_NATIVE_SNAPSHOT');
  assert.equal(refused.calls(), 1);
});

test('a discarded mismatching set restages once, then fails with a sanitized code', async () => {
  const { stageNativeDisplayAssets } = await import('../src/native-session-switch-restore.mjs');
  const entries = [carrier(1, 1024), carrier(2, 1024)];
  const once = stagingServer(entries, { resets: 1 });
  await stageNativeDisplayAssets({ request: once.request, sessionId: uuid(1), assets: { revision: 'r'.repeat(64), entries } });
  assert.deepEqual(once.stored, entries);
  const always = stagingServer(entries, { resets: 2 });
  await assert.rejects(stageNativeDisplayAssets({ request: always.request, sessionId: uuid(1), assets: { revision: 'r'.repeat(64), entries } }),
    e => e.code === 'NATIVE_ASSET_STAGE_INVALID');
});

test('restore stages compact-source images first and the restore body carries no image bytes', async () => {
  const { restoreDesktopNativeSession } = await import('../src/native-session-switch-restore.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'native-stage-test-'));
  try {
    const [A, B, U, C, CP, BOUND, SUM, D] = [1, 2, 3, 4, 5, 6, 7, 8].map(uuid);
    const configDirectory = path.join(root, 'config');
    const projectDirectory = path.join(configDirectory, 'projects', '-fixture');
    const peerDirectory = path.join(configDirectory, 'sessions');
    await mkdir(projectDirectory, { recursive: true });
    await mkdir(peerDirectory);
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'UFJJVkFURV9JTUFHRQ==' } };
    const original = [{ type: 'user', uuid: U, parentUuid: null, message: { content: [image] } },
      { type: 'assistant', uuid: C, parentUuid: U, message: { content: 'PRIVATE_REPLY' } }];
    const compact = [
      { type: 'system', uuid: BOUND, parentUuid: null, subtype: 'compact_boundary', logicalParentUuid: CP, compactMetadata: { preservedMessages: { allUuids: [CP] } } },
      { type: 'user', uuid: SUM, parentUuid: BOUND, isCompactSummary: true, message: { content: 'SUMMARY' } },
      { type: 'assistant', uuid: CP, parentUuid: SUM, message: { content: 'PRIVATE_REPLY' }, forkedFrom: { sessionId: B, messageUuid: C } },
    ];
    await writeFile(path.join(projectDirectory, `${B}.jsonl`), original.map(JSON.stringify).join('\n'));
    const text = compact.map(JSON.stringify).join('\n');
    const transcriptFile = path.join(projectDirectory, `${A}.jsonl`);
    await writeFile(transcriptFile, text);
    const indexFile = path.join(root, 'index.json');
    await writeFile(indexFile, JSON.stringify({ sessionId: `local_${D}`, cliSessionId: A, lastAssistantUuid: CP, cwd: '/fixture' }));
    const input = { configDirectory, projectDirectory, peerDirectory, indexFile, recoveryDirectory: path.join(root, 'recovery'),
      expectedSessionId: A, expectedCheckpointId: CP, expectedRevision: createHash('sha256').update(text).digest('hex') };
    const before = await readFile(transcriptFile);
    const routes = [], staged = [];
    const bytes = Buffer.from(image.source.data, 'base64');
    await restoreDesktopNativeSession({ input, conversationId: D, relayUrl: 'https://relay.invalid', relayToken: 'PRIVATE_TOKEN',
      fetchImpl: async (url, options) => {
        const route = url.split('/native-history/')[1];
        const body = JSON.parse(options.body);
        routes.push(route);
        const ok = data => new Response(JSON.stringify({ success: true, data }));
        if (route === 'state') return ok({ expectedHeadMessageId: null, expectedRevision: null });
        if (route === 'asset-stage') {
          staged.push(...body.entries.slice(staged.length - body.offset));
          return ok({ stored: staged.length, complete: staged.length === body.total });
        }
        if (route === 'restore') {
          assert.doesNotMatch(options.body, /UFJJVkFURV9JTUFHRQ==/, 'restore body must not carry image bytes');
          assert.deepEqual(Object.keys(body.nativeSnapshot.displayAssets).sort(), ['revision', 'stagedCount']);
          assert.equal(body.nativeSnapshot.displayAssets.stagedCount, staged.length);
          return ok({ outcome: 'restored', conversationId: D, headMessageId: CP, inserted: 2 });
        }
        if (route === 'asset') return ok({ attachmentId: uuid(9), filename: 'native.png', mimeType: 'image/png', kind: 'image',
          sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
        assert.fail(`unexpected route ${route}`);
      } });
    assert.deepEqual(routes.slice(0, 4), ['state', 'asset-stage', 'asset-stage', 'restore']);
    assert.deepEqual(staged, [{ type: 'user', uuid: U, message: { content: [image] } }]);
    assert.deepEqual(await readFile(transcriptFile), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
