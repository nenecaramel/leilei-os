import assert from 'node:assert/strict';
import test from 'node:test';
import { open, mkdtemp, mkdir, writeFile, readFile, readdir, rm, utimes, access } from 'node:fs/promises';
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

test('both archive modes protect files modified within five minutes and release older ones', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-archive-five-minutes-'));
  try {
    for (const [index, ageMinutes] of [4, 5, 6].entries()) {
      const sessionId = id(index + 1);
      const userId = id(index * 2 + 101), assistantId = id(index * 2 + 102);
      await write(dir, sessionId, [
        { type:'user', uuid:userId, parentUuid:null, message:{ content:'hello' } },
        { type:'assistant', uuid:assistantId, parentUuid:userId, message:{ content:'response' } },
      ]);
      const modified = new Date(NOW - ageMinutes * 60_000);
      await utimes(path.join(dir, `${sessionId}.jsonl`), modified, modified);
    }
    for (const historyMode of ['complete', 'continuation']) {
      const plan = await planNativeTranscriptArchive({ projectDirectory:dir, historyMode, now:NOW });
      assert.deepEqual(plan.keep.map(item => item.sessionId), [id(1)], `${historyMode}: four-minute file remains protected`);
      assert.ok(plan.keep[0].reasons.includes('recent'));
      assert.deepEqual(plan.archive, [id(2), id(3)], `${historyMode}: five- and six-minute files are eligible`);
    }
  } finally { await rm(dir, { recursive:true, force:true }); }
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


test('continuation archive stops at compact physical root; history-only source becomes eligible', async () => {
  const f = await folder();
  try {
    const options = { projectDirectory:f.dir, windows:new Map([[f.W,id(204)]]), referenced:new Set([f.R]), now:NOW };
    const oldPlan = await planNativeTranscriptArchive(options);
    const plan = await planNativeTranscriptArchive({ ...options, historyMode:'continuation' });
    assert.equal(oldPlan.archive.includes(f.S),false);
    assert.equal(plan.archive.includes(f.S),true);
    assert.deepEqual(plan.keep.map(k=>k.sessionId),[f.W,f.R,f.N].sort());
    assert.equal(plan.verified.find(v=>v.sessionId===f.W).executionIdentical,true);
    assert.ok(plan.archiveDetails.find(v=>v.sessionId===f.S).reasons.includes('history_only_source'));
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test('continuation archival preserves archive windows, checkpoint references and open sessions', async () => {
  const f = await folder();
  try {
    const plan = await planNativeTranscriptArchive({projectDirectory:f.dir,historyMode:'continuation',
      windows:new Map([[f.W,id(204)],[f.S,id(102)]]),referenced:new Set([f.F,f.R]),isOpen:async s=>s===f.C1,now:NOW});
    for(const session of [f.S,f.W,f.F,f.R,f.C1,f.N]) assert.ok(plan.keep.some(k=>k.sessionId===session));
    assert.deepEqual(plan.archive,[f.C2]);
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test('an unreadable kept physical chain prevents continuation archival in that project', async () => {
  const f = await folder();
  try {
    await write(f.dir,f.W,[{type:'assistant',uuid:id(204),parentUuid:id(999),message:{content:'gap'}}]);
    const plan = await planNativeTranscriptArchive({projectDirectory:f.dir,historyMode:'continuation',windows:new Map([[f.W,id(204)]]),now:NOW});
    assert.deepEqual(plan.archive,[]);
    assert.ok(plan.keep.every(k=>k.reasons.some(r=>r.startsWith('unverified_execution:'))||k.sessionId===f.W));
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});

test('archive application refuses originals changed after planning or while packing', async () => {
  const f = await folder();const out = await mkdtemp(path.join(tmpdir(),'native-archive-stale-'));
  try {
    const original=await readFile(path.join(f.dir,`${f.C1}.jsonl`));
    const digest=(await import('node:crypto')).createHash('sha256').update(original).digest('hex');
    await writeFile(path.join(f.dir,`${f.C1}.jsonl`),Buffer.concat([original,Buffer.from('\n')]));
    await assert.rejects(applyNativeTranscriptArchive({projectDirectory:f.dir,sessionIds:[f.C1],archiveDirectory:out,label:'stale-plan',expectedDigests:{[`${f.C1}.jsonl`]:digest}}),e=>e.code==='ARCHIVE_PLAN_CHANGED');
    let checks=0;
    await assert.rejects(applyNativeTranscriptArchive({projectDirectory:f.dir,sessionIds:[f.C1],archiveDirectory:out,label:'changed-while-packing',verifyPlan:async()=>{
      if(++checks===2)await writeFile(path.join(f.dir,`${f.C1}.jsonl`),'changed after archive verification');
    }}),e=>e.code==='ARCHIVE_PLAN_CHANGED');
    assert.equal(await readFile(path.join(f.dir,`${f.C1}.jsonl`),'utf8'),'changed after archive verification');
  } finally { await rm(f.dir,{recursive:true,force:true});await rm(out,{recursive:true,force:true}); }
});


test('an original writer racing removal is preserved in recovery, not discarded after a stale digest',async()=>{
 const f=await folder(),out=await mkdtemp(path.join(tmpdir(),'native-archive-writer-'));
 const file=path.join(f.dir,`${f.C1}.jsonl`);const writer=await open(file,'a');
 try{
  await assert.rejects(applyNativeTranscriptArchive({projectDirectory:f.dir,sessionIds:[f.C1],archiveDirectory:out,label:'racing-writer',
    assertStagedFilesClosed:async()=>{await writer.write('\nNEW_BYTES_AFTER_LAST_DIGEST');throw Object.assign(Error(),{code:'ARCHIVE_SOURCE_OPEN'});}
  }),e=>e.code==='ARCHIVE_SOURCE_OPEN');
  assert.match(await readFile(file,'utf8'),/NEW_BYTES_AFTER_LAST_DIGEST$/);
  const recovery=JSON.parse(await readFile(path.join(out,'racing-writer.recovery.json'),'utf8'));
  assert.match(await readFile(path.join(recovery.stagingDirectory,`${f.C1}.jsonl`),'utf8'),/NEW_BYTES_AFTER_LAST_DIGEST$/);
 }finally{await writer.close();await rm(f.dir,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});

test('a recreated original path is never overwritten or unlinked by archive finalization',async()=>{
 const f=await folder(),out=await mkdtemp(path.join(tmpdir(),'native-archive-reopen-'));
 const file=path.join(f.dir,`${f.C1}.jsonl`);
 try{
  await assert.rejects(applyNativeTranscriptArchive({projectDirectory:f.dir,sessionIds:[f.C1],archiveDirectory:out,label:'reopened',
    assertStagedFilesClosed:async()=>{await writeFile(file,'NEW_SESSION_AT_ORIGINAL_PATH');}
  }),e=>e.code==='ARCHIVE_PLAN_CHANGED');
  assert.equal(await readFile(file,'utf8'),'NEW_SESSION_AT_ORIGINAL_PATH');
  const recovery=JSON.parse(await readFile(path.join(out,'reopened.recovery.json'),'utf8'));
  assert.notEqual(await readFile(path.join(recovery.stagingDirectory,`${f.C1}.jsonl`),'utf8'),'NEW_SESSION_AT_ORIGINAL_PATH');
 }finally{await rm(f.dir,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});


test('real descriptor probe refuses an open original inode after its atomic move',async()=>{
 const f=await folder(),out=await mkdtemp(path.join(tmpdir(),'native-archive-open-inode-'));
 const file=path.join(f.dir,`${f.C1}.jsonl`),original=await readFile(file),writer=await open(file,'a');
 try{
  await assert.rejects(applyNativeTranscriptArchive({projectDirectory:f.dir,sessionIds:[f.C1],archiveDirectory:out,label:'open-inode'}),e=>e.code==='ARCHIVE_SOURCE_OPEN');
  await writer.write('\nSTILL_WRITING_AFTER_RECOVERY');
  assert.equal(await readFile(file,'utf8'),original.toString()+'\nSTILL_WRITING_AFTER_RECOVERY');
 }finally{await writer.close();await rm(f.dir,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});


test('a kept native chain still protects another session companion directory it directly references',async()=>{
 const f=await folder();
 try{
  const file=path.join(f.dir,`${f.W}.jsonl`);
  const text=await readFile(file,'utf8');
  const entries=text.split('\n').map(line=>JSON.parse(line));
  entries.at(-1).message.content=`Full output saved to ${path.join(f.dir,f.C1,'tool-result.txt')}`;
  await write(f.dir,f.W,entries);
  const plan=await planNativeTranscriptArchive({projectDirectory:f.dir,historyMode:'continuation',windows:new Map([[f.W,id(204)]]),referenced:new Set([f.R]),now:NOW});
  assert.ok(plan.keep.some(k=>k.sessionId===f.C1&&k.reasons.includes(`native_files:${f.W}`)));
  assert.equal(plan.archive.includes(f.S),true,'display-only ancestry can still be archived');
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
