import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readNativeSession } from '../src/native-session-catalog.mjs';
import { readNativeHistorySources } from '../src/native-session-source-files.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const write = (dir, sessionId, entries) => writeFile(path.join(dir, `${sessionId}.jsonl`), entries.map(JSON.stringify).join('\n'));
// Root compacted from A, which was itself compacted from B. Copies keep forkedFrom.
async function chain(dir) {
  const [ROOT, A, B] = [id(1), id(2), id(3)];
  await write(dir, B, [{ type: 'user', uuid: id(10), parentUuid: null, message: { content: 'b' } }, { type: 'assistant', uuid: id(11), parentUuid: id(10), message: { content: 'b' } }]);
  await write(dir, A, [
    { type: 'system', uuid: id(20), parentUuid: null, subtype: 'compact_boundary', logicalParentUuid: id(11), compactMetadata: { preservedMessages: { allUuids: [id(21)] } } },
    { type: 'assistant', uuid: id(21), parentUuid: id(20), message: { content: 'b' }, forkedFrom: { sessionId: B, messageUuid: id(11) } },
    { type: 'user', uuid: id(22), parentUuid: id(21), message: { content: 'a' } }, { type: 'assistant', uuid: id(23), parentUuid: id(22), message: { content: 'a' } }]);
  await write(dir, ROOT, [
    { type: 'system', uuid: id(30), parentUuid: null, subtype: 'compact_boundary', logicalParentUuid: id(31), compactMetadata: { preservedMessages: { allUuids: [id(31)] } } },
    { type: 'assistant', uuid: id(31), parentUuid: id(30), message: { content: 'a' }, forkedFrom: { sessionId: A, messageUuid: id(23) } }]);
  return { ROOT, A, B };
}

test('only transcripts the compaction chain needs are read, however many unrelated copies exist', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-sources-'));
  try {
    const { ROOT, A, B } = await chain(dir);
    for (let n = 0; n < 300; n++) await write(dir, id(1000 + n), [{ type: 'user', uuid: id(5000 + n), parentUuid: null, message: { content: 'unrelated' } }]);
    await writeFile(path.join(dir, `${id(999)}.jsonl`), '{not json');
    const sources = await readNativeHistorySources(dir, ROOT, await readNativeSession(dir, ROOT));
    assert.deepEqual(sources.map(s => s.sessionId), [A, B]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a copy that carries a needed record is still offered, so conflicting copies are detected as before', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-sources-'));
  try {
    const { ROOT, A, B } = await chain(dir);
    const copy = id(4);
    await write(dir, copy, [{ type: 'assistant', uuid: id(23), parentUuid: id(22), message: { content: 'a' } }]);
    const sources = await readNativeHistorySources(dir, ROOT, await readNativeSession(dir, ROOT));
    assert.deepEqual(sources.map(s => s.sessionId).sort(), [A, B, copy].sort());
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the source limit holds by default and can be raised explicitly by an offline caller', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-sources-'));
  try {
    const { ROOT } = await chain(dir);
    // Desktop Rewind copies all carry the needed record.
    for (let n = 0; n < 260; n++) await write(dir, id(2000 + n), [{ type: 'assistant', uuid: id(23), parentUuid: id(22), message: { content: 'a' } }]);
    const root = await readNativeSession(dir, ROOT);
    await assert.rejects(readNativeHistorySources(dir, ROOT, root), { code: 'NATIVE_SOURCE_SCAN_LIMIT' });
    const sources = await readNativeHistorySources(dir, ROOT, root, { maxSourceFiles: 1024, maxSourceBytes: 1024 * 1024 * 1024 });
    assert.equal(sources.length, 262);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
