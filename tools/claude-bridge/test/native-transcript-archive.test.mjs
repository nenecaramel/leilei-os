import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, utimes, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planNativeTranscriptArchive, applyNativeTranscriptArchive } from '../src/native-transcript-archive.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const old = new Date('2026-10-01T00:00:00Z');
const NOW = new Date('2026-10-14T12:00:00Z').getTime();
const write = async (dir, sessionId, entries, recent = false) => {
  const file = path.join(dir, `${sessionId}.jsonl`);
  await writeFile(file, entries.map(e => JSON.stringify({ ...e, sessionId })).join('\n'));
  if (!recent) await utimes(file, old, old);
};
// S: original history. W: the window, compacted from S (preserved tail keeps its UUID).
// C1/C2: Desktop rewind copies of W. F: an unreferenced fork carrying S's records. R: referenced elsewhere. N: recent.
async function folder() {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-archive-'));
  const [S, W, C1, C2, F, R, N] = [10, 20, 30, 31, 40, 50, 60].map(id);
  const history = [{ type: 'user', uuid: id(101), parentUuid: null, message: { content: 'one' } }, { type: 'assistant', uuid: id(102), parentUuid: id(101), message: { content: 'two' } }];
  const window = [
    { type: 'system', uuid: id(201), parentUuid: null, subtype: 'compact_boundary', logicalParentUuid: id(102), compactMetadata: { preservedMessages: { allUuids: [id(102)] } } },
    { type: 'user', uuid: id(202), parentUuid: id(201), isCompactSummary: true, message: { content: 'summary' } },
    { ...history[1], parentUuid: id(202), forkedFrom: { sessionId: S, messageUuid: id(102) } },
    { type: 'user', uuid: id(203), parentUuid: id(102), message: { content: 'three' } }, { type: 'assistant', uuid: id(204), parentUuid: id(203), message: { content: 'four' } }];
  await write(dir, S, history);
  await write(dir, W, window);
  await write(dir, C1, window); await write(dir, C2, window.slice(0, 4).concat([{ ...window[4], uuid: id(205) }]));
  await mkdir(path.join(dir, C1)); await writeFile(path.join(dir, C1, 'tool-result.txt'), 'subfolder bytes');
  await write(dir, F, history);
  await write(dir, R, [{ type: 'user', uuid: id(301), parentUuid: null, message: { content: 'x' } }, { type: 'assistant', uuid: id(302), parentUuid: id(301), message: { content: 'y' } }]);
  await write(dir, N, [{ type: 'user', uuid: id(401), parentUuid: null, message: { content: 'new' } }], true);
  return { dir, S, W, C1, C2, F, R, N };
}

test('plan keeps windows, referenced, recent and needed sources; archives only redundant copies, proven identical', async () => {
  const f = await folder();
  try {
    const plan = await planNativeTranscriptArchive({ projectDirectory: f.dir, windows: new Map([[f.W, id(204)]]), referenced: new Set([f.R]), now: NOW });
    assert.deepEqual(plan.keep.map(k => k.sessionId), [f.S, f.W, f.R, f.N].sort());
    assert.deepEqual(plan.archive, [f.C1, f.C2, f.F].sort());
    assert.ok(plan.keep.find(k => k.sessionId === f.S).reasons.some(r => r.startsWith('source:')));
    const window = plan.verified.find(v => v.sessionId === f.W);
    assert.deepEqual([window.readable, window.identical, window.messages], [true, true, 4]);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('an open session is never archived', async () => {
  const f = await folder();
  try {
    const plan = await planNativeTranscriptArchive({ projectDirectory: f.dir, windows: new Map([[f.W, id(204)]]), referenced: new Set([f.R]), now: NOW, isOpen: async s => s === f.C1 });
    assert.ok(plan.keep.some(k => k.sessionId === f.C1 && k.reasons.includes('open')));
    assert.equal(plan.archive.includes(f.C1), false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('apply archives files and same-named folders, verifies every byte, and restores exactly', async () => {
  const f = await folder();
  const archiveDirectory = await mkdtemp(path.join(tmpdir(), 'native-archive-out-'));
  try {
    const original = { jsonl: await readFile(path.join(f.dir, `${f.C1}.jsonl`)), sub: await readFile(path.join(f.dir, f.C1, 'tool-result.txt')) };
    const result = await applyNativeTranscriptArchive({ projectDirectory: f.dir, sessionIds: [f.C1, f.F], archiveDirectory, label: 'test-archive' });
    assert.equal(result.files, 3);
    const left = await readdir(f.dir);
    assert.equal(left.some(n => n.startsWith(f.C1) || n.startsWith(f.F)), false, 'originals and folder removed');
    assert.ok(left.includes(`${f.W}.jsonl`));
    const manifest = JSON.parse(await readFile(`${result.archiveFile}.manifest.json`, 'utf8'));
    assert.deepEqual(manifest.sessionIds, [f.C1, f.F]);
    const restore = await mkdtemp(path.join(tmpdir(), 'native-archive-restore-'));
    try {
      if (result.archiveFile.endsWith('.zst')) execFileSync('/bin/sh', ['-c', `zstd -dc --long=31 '${result.archiveFile}' | tar xf - -C '${restore}'`]);
      else execFileSync('tar', ['-xJf', result.archiveFile, '-C', restore]);
      assert.deepEqual(await readFile(path.join(restore, `${f.C1}.jsonl`)), original.jsonl);
      assert.deepEqual(await readFile(path.join(restore, f.C1, 'tool-result.txt')), original.sub);
    } finally { await rm(restore, { recursive: true, force: true }); }
    await assert.rejects(applyNativeTranscriptArchive({ projectDirectory: f.dir, sessionIds: [f.R], archiveDirectory, label: 'test-archive' }), e => e.code === 'ARCHIVE_EXISTS');
    await access(path.join(f.dir, `${f.R}.jsonl`));
  } finally { await rm(f.dir, { recursive: true, force: true }); await rm(archiveDirectory, { recursive: true, force: true }); }
});
