import assert from 'node:assert/strict';
import test from 'node:test';
import { projectNativeHistory, neutralMessageFingerprint, nativeSyncDigest, nativeDisplayAssetRevision } from '../src/native-session-history.mjs';
import { incrementalNativePayload } from '../src/native-session-switch-restore.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (uuid, parentUuid, type, content) => ({ uuid, parentUuid, type, timestamp: '2026-10-11T00:00:00.000Z', message: { content } });
const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } };
const entries = [row(id(1), null, 'user', [image]), row(id(2), id(1), 'assistant', 'a'), row(id(3), id(2), 'user', 'b'), row(id(4), id(3), 'assistant', 'c')];
const history = sessionId => ({ projection: projectNativeHistory({ sessionId, revision: 'r'.repeat(64), entries }, id(4)),
  nativeSnapshot: { sessionId, revision: 'r'.repeat(64), entries } });
const anchorFor = (projection, count) => ({ count, digest: nativeSyncDigest(projection.messages.slice(0, count).map(m => ({ sourceMessageId: m.sourceMessageId, fingerprint: neutralMessageFingerprint(m) }))) });

test('only messages and native records after the agreed base are sent', () => {
  const h = history(id(10));
  const out = incrementalNativePayload(h, { messageAnchor: anchorFor(h.projection, 2), entriesAnchor: { count: 2, digest: nativeDisplayAssetRevision(entries.slice(0, 2)) } });
  assert.deepEqual(out.projection.messages.map(m => m.sourceMessageId), [id(3), id(4)]);
  assert.deepEqual(out.projection.anchor, anchorFor(h.projection, 2));
  assert.deepEqual([out.nativeSnapshot.entries, out.nativeSnapshot.entriesOffset], [entries.slice(2), 2]);
});

test('neutral fingerprints let a different session reuse the base, and an unchanged history still sends its last message', () => {
  const synced = history(id(10)), rotated = history(id(11));
  assert.notEqual(synced.projection.messages[0].fingerprint, rotated.projection.messages[0].fingerprint, 'image block names the session');
  const out = incrementalNativePayload(rotated, { messageAnchor: anchorFor(synced.projection, 4) });
  assert.deepEqual(out.projection.messages.map(m => m.sourceMessageId), [id(4)]);
  assert.equal(out.projection.anchor.count, 3);
  assert.equal(out.nativeSnapshot, rotated.nativeSnapshot, 'no stored records for a new session: full records');
});

test('a mismatching or out-of-range base falls back to the full history', () => {
  const h = history(id(10));
  for (const state of [{}, { messageAnchor: { count: 2, digest: 'f'.repeat(64) } }, { messageAnchor: { count: 9, digest: anchorFor(h.projection, 2).digest } },
    { entriesAnchor: { count: 2, digest: 'f'.repeat(64) } }]) {
    const out = incrementalNativePayload(h, state);
    assert.equal(out.projection, h.projection);
    assert.equal(out.nativeSnapshot, h.nativeSnapshot);
  }
});

test('a base that moved between state and restore is resent in full once; only pending assets are materialized', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const { createHash } = await import('node:crypto');
  const { restoreDesktopNativeSession } = await import('../src/native-session-switch-restore.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'native-incremental-'));
  try {
    const configDirectory = path.join(root, 'config'), projectDirectory = path.join(configDirectory, 'projects', '-fixture'), peerDirectory = path.join(configDirectory, 'sessions');
    await mkdir(projectDirectory, { recursive: true }); await mkdir(peerDirectory);
    const S = id(20);
    const local = entries.map(entry => ({ ...entry, cwd: '/fixture/work', sessionId: S }));
    local[3] = { ...local[3], message: { content: [image] } };
    const text = local.map(JSON.stringify).join('\n');
    await writeFile(path.join(projectDirectory, `${S}.jsonl`), text);
    const input = { indexFile: null, projectDirectory, configDirectory, peerDirectory, recoveryDirectory: path.join(root, 'recovery'),
      expectedSessionId: S, expectedCheckpointId: id(4), expectedRevision: createHash('sha256').update(text).digest('hex') };
    const h = { projection: projectNativeHistory({ sessionId: S, revision: 'x', entries: local }, id(4)) };
    const bodies = [], assetCalls = [];
    const bytes = Buffer.from('AA==', 'base64');
    await restoreDesktopNativeSession({ input, conversationId: id(30), relayUrl: 'https://relay.invalid', relayToken: 'T', sleep: async () => {},
      fetchImpl: async (url, options) => {
        const route = url.split('/native-history/')[1], body = JSON.parse(options.body);
        const ok = data => new Response(JSON.stringify({ success: true, data }));
        if (route === 'state') return ok({ expectedHeadMessageId: id(4), expectedRevision: 'b'.repeat(64), messageAnchor: anchorFor(h.projection, 2) });
        if (route === 'restore') {
          bodies.push(body);
          if (bodies.length === 1) return new Response(JSON.stringify({ success: false, error: { code: 'NATIVE_SYNC_BASE_CHANGED' } }), { status: 409 });
          return ok({ outcome: 'already_current', conversationId: id(30), headMessageId: id(4), inserted: 0, pendingAssets: [{ sourceEntryUuid: id(4), sourceBlockOrdinal: 0 }] });
        }
        if (route === 'asset') { assetCalls.push(body.sourceEntryUuid); return ok({ attachmentId: id(40), filename: 'n.png', mimeType: 'image/png', kind: 'image', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
        assert.fail(route);
      } }).then(result => assert.deepEqual(result.assets, { materialized: 2, unavailable: 0 }));
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].projection.anchor.count, 2);
    assert.equal(bodies[1].projection.anchor, undefined, 'fallback resends the full history');
    assert.equal(bodies[1].projection.messages.length, 4);
    assert.deepEqual(assetCalls, [id(4)], 'the already-bound image is not checked again');
  } finally { await rm(root, { recursive: true, force: true }); }
});
