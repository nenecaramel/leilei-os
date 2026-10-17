import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, mkdir, writeFile, readFile, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runNativeTranscriptArchive } from '../scripts/native-transcript-archive.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const old = new Date('2026-10-01T00:00:00Z');

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'native-archive-cmd-'));
  const configDirectory = path.join(root, 'config'), project = path.join(configDirectory, 'projects', '-fixture');
  const desktopSessionsDirectory = path.join(root, 'desktop'), archiveDirectory = path.join(root, 'archive');
  await mkdir(project, { recursive: true }); await mkdir(path.join(configDirectory, 'sessions'));
  await mkdir(path.join(desktopSessionsDirectory, 'acct', 'org'), { recursive: true });
  const entries = [{ type: 'user', uuid: id(101), parentUuid: null, message: { content: 'a' } }, { type: 'assistant', uuid: id(102), parentUuid: id(101), message: { content: 'b' } }];
  for (const s of [id(1), id(2), id(3)]) {
    await writeFile(path.join(project, `${s}.jsonl`), entries.map(e => JSON.stringify({ ...e, sessionId: s })).join('\n'));
    await utimes(path.join(project, `${s}.jsonl`), old, old);
  }
  await writeFile(path.join(desktopSessionsDirectory, 'acct', 'org', `local_${id(9)}.json`), JSON.stringify({ sessionId: `local_${id(9)}`, cliSessionId: id(1), lastAssistantUuid: id(102), cwd: '/fixture' }));
  return { root, configDirectory, project, desktopSessionsDirectory, archiveDirectory, recoveryDirectory:path.join(root,'recovery') };
}

test('archive command needs LeileiOS references, plans by default and applies only when asked', async () => {
  const f = await fixture();
  const ok = sessionIds => async () => new Response(JSON.stringify({ success: true, data: { sessionIds } }));
  try {
    await assert.rejects(runNativeTranscriptArchive({ ...f, relayUrl: 'https://relay.invalid', relayToken: 'T', fetchImpl: async () => new Response('{}', { status: 503 }) }),
      e => e.code === 'ARCHIVE_REFERENCES_UNAVAILABLE');
    const plan = await runNativeTranscriptArchive({ ...f, relayUrl: 'https://relay.invalid', relayToken: 'T', fetchImpl: ok([id(2)]) });
    assert.deepEqual(plan.results.map(r => [r.folder, r.keep, r.archive, r.applied]), [['-fixture', 2, 1, null]]);
    assert.equal((await readdir(f.project)).length, 3, 'planning never removes anything');
    const applied = await runNativeTranscriptArchive({ ...f, apply: true, relayUrl: 'https://relay.invalid', relayToken: 'T', fetchImpl: ok([id(2)]) });
    assert.match(applied.results[0].applied, /^-fixture-.*\.tar\.(zst|xz)$/);
    assert.deepEqual((await readdir(f.project)).sort(), [`${id(1)}.jsonl`, `${id(2)}.jsonl`]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});


test('plan creates no archive/plan files; apply checks recovery before moving anything', async()=>{
  const f=await fixture();const fetchImpl=async()=>new Response(JSON.stringify({success:true,data:{sessionIds:[id(2)]}}));
  const recoveryDirectory=path.join(f.root,'recovery');
  try{
    await runNativeTranscriptArchive({...f,recoveryDirectory,relayUrl:'https://relay.invalid',relayToken:'T',fetchImpl});
    await assert.rejects(readdir(f.archiveDirectory),e=>e.code==='ENOENT');
    const pending=path.join(recoveryDirectory,'terminal-results','a'.repeat(64));await mkdir(pending,{recursive:true});
    await writeFile(path.join(pending,'pending.json'),'{}');
    await assert.rejects(runNativeTranscriptArchive({...f,recoveryDirectory,apply:true,relayUrl:'https://relay.invalid',relayToken:'T',fetchImpl}),e=>e.code==='NATIVE_SESSION_RECOVERY_REQUIRED');
    assert.equal((await readdir(f.project)).length,3);
  } finally{await rm(f.root,{recursive:true,force:true});}
});

test('a new remote reference during packing prevents deleting the selected transcript',async()=>{
 const f=await fixture();let reads=0;
 const fetchImpl=async()=>new Response(JSON.stringify({success:true,data:{sessionIds:++reads<3?[id(2)]:[id(2),id(3)]}}));
 try{
  await assert.rejects(runNativeTranscriptArchive({...f,recoveryDirectory:path.join(f.root,'recovery'),apply:true,relayUrl:'https://relay.invalid',relayToken:'T',fetchImpl}),e=>e.code==='ARCHIVE_PLAN_CHANGED');
  assert.equal((await readdir(f.project)).length,3);
 }finally{await rm(f.root,{recursive:true,force:true});}
});


test('archive plans include a referenced local-only project without a Desktop window',async()=>{
 const f=await fixture();
 const fetchImpl=async()=>new Response(JSON.stringify({success:true,data:{sessionIds:[id(2)]}}));
 try{
  await rm(f.desktopSessionsDirectory,{recursive:true});
  const plan=await runNativeTranscriptArchive({...f,relayUrl:'https://relay.invalid',relayToken:'T',fetchImpl});
  assert.equal(plan.results.length,1);
  assert.deepEqual(plan.results[0].keepDetails.map(k=>k.sessionId),[id(2)]);
  assert.deepEqual(plan.results[0].archiveDetails.map(k=>k.sessionId),[id(1),id(3)]);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('a Desktop window added during packing protects its native session',async()=>{
 const f=await fixture();let reads=0;
 const fetchImpl=async()=>{
  if(++reads===3)await writeFile(path.join(f.desktopSessionsDirectory,'acct','org',`local_${id(10)}.json`),JSON.stringify({cliSessionId:id(3),lastAssistantUuid:id(102)}));
  return new Response(JSON.stringify({success:true,data:{sessionIds:[id(2)]}}));
 };
 try{
  await assert.rejects(runNativeTranscriptArchive({...f,apply:true,relayUrl:'https://relay.invalid',relayToken:'T',fetchImpl}),e=>e.code==='ARCHIVE_PLAN_CHANGED');
  assert.equal((await readdir(f.project)).length,3);
 }finally{await rm(f.root,{recursive:true,force:true});}
});


test('unreadable Desktop accounts cannot disappear from protection', {skip:process.getuid?.()===0},async()=>{
 const f=await fixture(),account=path.join(f.desktopSessionsDirectory,'acct');
 const fetchImpl=async()=>new Response(JSON.stringify({success:true,data:{sessionIds:[id(2)]}}));
 try{
  await chmod(account,0);
  await assert.rejects(runNativeTranscriptArchive({...f,apply:true,relayUrl:'https://relay.invalid',relayToken:'T',fetchImpl}),e=>e.code==='ARCHIVE_DESKTOP_INDEX_UNREADABLE');
  assert.equal((await readdir(f.project)).length,3);
 }finally{await chmod(account,0o700);await rm(f.root,{recursive:true,force:true});}
});

const safeReceipt = sessionId => ({
  sourcePrepareId: id(201), receiptId: id(202), listenerInstanceId: id(206), generationId: id(207),
  parentProviderCheckpointId: id(203),
  result: { prepare_id: id(201), conversation_id: id(204), provider_session_id: sessionId,
    provider_checkpoint_id: id(205), status: 'success', normalized_events: [] },
});
const blockedPath = (f, name = 'a'.repeat(64)) =>
  path.join(f.recoveryDirectory, 'background-results', name, 'blocked',
    createHash('sha256').update(JSON.stringify([id(206), id(207), id(202)])).digest('hex') + '.json');
async function writeBlocked(f, sessionId, name) {
  const file = blockedPath(f, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(safeReceipt(sessionId)));
  return file;
}
const remote = sessionIds => async () =>
  new Response(JSON.stringify({success:true,data:{sessionIds}}));

test('quarantined background output protects its exact native session, but not unrelated stale files', async () => {
  const f = await fixture();
  try {
    // Server protects #2, Desktop protects #1, quarantine protects #3;
    // an unrelated old #4 is still eligible for a verified archive.
    const root = await readdir(f.project);
    const existing = await readFile(path.join(f.project, `${id(3)}.jsonl`));
    await writeFile(path.join(f.project, `${id(4)}.jsonl`), existing);
    await utimes(path.join(f.project, `${id(4)}.jsonl`), old, old);
    const original = await writeBlocked(f, id(3));
    const options = { ...f, relayUrl:'https://relay.invalid',relayToken:'T',fetchImpl:remote([id(2)]) };
    const planned = await runNativeTranscriptArchive(options);
    assert.deepEqual(planned.results.map(r=>[r.keep,r.archive,r.protectionCounts.quarantined]), [[3,1,1]]);
    assert.ok(root.length === 3);
    assert.equal((await readFile(original,'utf8')),JSON.stringify(safeReceipt(id(3))));
    const applied = await runNativeTranscriptArchive({...options,apply:true});
    assert.ok(applied.results[0].applied);
    assert.deepEqual((await readdir(f.project)).sort(),[id(1),id(2),id(3)].map(v=>`${v}.jsonl`));
    assert.equal((await readFile(original,'utf8')),JSON.stringify(safeReceipt(id(3))));
  } finally { await rm(f.root,{recursive:true,force:true}); }
});

test('new quarantined receipt during packing aborts the retirement of its session', async () => {
  const f = await fixture();
  let calls=0;
  const fetchImpl = async () => {
    if (++calls === 3) await writeBlocked(f,id(3));
    return remote([id(2)])();
  };
  try {
    await assert.rejects(
      runNativeTranscriptArchive({ ...f,apply:true,relayUrl:'https://relay.invalid',relayToken:'T',fetchImpl }),
      e => e.code === 'ARCHIVE_PLAN_CHANGED'
    );
    assert.deepEqual((await readdir(f.project)).sort(),[id(1),id(2),id(3)].map(v=>`${v}.jsonl`));
    assert.ok((await readFile(blockedPath(f),'utf8')).includes(id(3)));
  } finally { await rm(f.root,{recursive:true,force:true}); }
});

test('unverifiable quarantine, missing native session and unknown recovery files fail closed', async () => {
  const f = await fixture();
  const options={...f,relayUrl:'https://relay.invalid',relayToken:'T',fetchImpl:remote([id(2)])};
  try {
    const receiptFile=await writeBlocked(f,id(9));
    await assert.rejects(runNativeTranscriptArchive(options),e=>e.code==='NATIVE_RECOVERY_UNCONFIRMED');
    await writeFile(receiptFile,'{"result":{}}');
    await assert.rejects(runNativeTranscriptArchive(options),e=>e.code==='NATIVE_RECOVERY_UNCONFIRMED');
    await writeFile(receiptFile,JSON.stringify(safeReceipt(id(3))));
    const foreign=path.join(path.dirname(receiptFile),'unknown.txt');
    await writeFile(foreign,'incomplete write');
    await assert.rejects(runNativeTranscriptArchive(options),e=>e.code==='NATIVE_RECOVERY_UNCONFIRMED');
  } finally { await rm(f.root,{recursive:true,force:true}); }
});

test('an empty blocked directory is not an outstanding recovery receipt', async () => {
  const f = await fixture();
  try {
    await mkdir(path.dirname(blockedPath(f)),{recursive:true});
    const plan=await runNativeTranscriptArchive({...f,relayUrl:'https://relay.invalid',relayToken:'T',fetchImpl:remote([id(2)])});
    assert.equal(plan.results[0].archive,1);
  } finally {await rm(f.root,{recursive:true,force:true});}
});
