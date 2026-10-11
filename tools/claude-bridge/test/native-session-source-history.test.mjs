import test from 'node:test';
import assert from 'node:assert/strict';
import { projectNativeHistory } from '../src/native-session-history.mjs';
const row = (uuid,parentUuid,type,content,extra={}) => ({uuid,parentUuid,type,message:{content},...extra});
const snap = (sessionId,entries) => ({sessionId,revision:sessionId,entries});
const original = snap('original',[row('u',null,'user','old'),row('a','u','assistant','reply'),row('later','a','user','DO_NOT_IMPORT')]);
const current = snap('current',[
  row('compact',null,'system',null,{subtype:'compact_boundary',logicalParentUuid:'copy',compactMetadata:{preservedMessages:{allUuids:['copy']}}}),
  row('summary','compact','user','SUMMARY',{isCompactSummary:true}),
  row('copy','summary','assistant','reply',{forkedFrom:{sessionId:'original',messageUuid:'a'}}),
  row('u2','copy','user','new'),row('a2','u2','assistant','new reply'),
]);
test('compact fork follows exact original UUID, excludes source tail, and leaves execution snapshot unchanged',()=>{
  const before=structuredClone(current);
  const result=projectNativeHistory(current,'a2',{sourceSnapshots:[original]});
  assert.deepEqual(result.messages.map(x=>x.sourceMessageId),['u','copy','u2','a2']);
  assert.doesNotMatch(JSON.stringify(result),/SUMMARY|DO_NOT_IMPORT/);
  assert.deepEqual(current,before);
  assert.equal(result.sessionId,'current'); assert.equal(result.checkpointId,'a2');
});
test('missing source, changed retained content and conflicting complete ancestries still fail closed',()=>{
  for(const sources of [[],[snap('bad',[row('a',null,'assistant','different')])],
    [original,snap('other',[row('different',null,'user','different branch'),row('a','different','assistant','reply')])]]) {
    assert.throws(()=>projectNativeHistory(current,'a2',{sourceSnapshots:sources}));
  }
});

test('nested compacts preserve one copy of each turn and accept only native usage bookkeeping changes', () => {
  const first = snap('first', structuredClone(current.entries));
  first.entries[2].message.usage = { input_tokens: 1 };
  const next = snap('next', [
    row('c2',null,'system',null,{subtype:'compact_boundary',logicalParentUuid:'a2',compactMetadata:{preservedMessages:{allUuids:['a2']}}}),
    row('s2','c2','user','SECOND SUMMARY',{isCompactSummary:true}),
    row('a2','s2','assistant','new reply'), row('u3','a2','user','third'),row('a3','u3','assistant','third reply'),
  ]);
  const p = projectNativeHistory(next,'a3',{sourceSnapshots:[first,original]});
  assert.deepEqual(p.messages.map(m=>m.sourceMessageId),['u','copy','u2','a2','u3','a3']);
  assert.doesNotMatch(JSON.stringify(p),/SUMMARY|DO_NOT_IMPORT/);
  const bad = structuredClone(first); bad.entries[2].message.content = 'changed';
  assert.throws(()=>projectNativeHistory(next,'a3',{sourceSnapshots:[bad,original]}));
});

test('source checkpoint remains display-only: reconstructed chain is not a provider resume prefix', async () => {
  const { durableCheckpointPrefix } = await import('../src/provider-checkpoint-prefix.mjs');
  projectNativeHistory(current,'a2',{sourceSnapshots:[original]});
  assert.throws(()=>durableCheckpointPrefix(current.entries,'u'));
  assert.ok(durableCheckpointPrefix(current.entries,'a2'));
});

test('asset revision is invariant to JSONB object key ordering but sensitive to bytes and order', async () => {
  const { nativeDisplayAssetRevision } = await import('../src/native-session-history.mjs');
  assert.equal(nativeDisplayAssetRevision([{uuid:'a',type:'user',message:{content:[{type:'image',source:{data:'AA==',type:'base64'}}]}}]),
    nativeDisplayAssetRevision([{message:{content:[{source:{type:'base64',data:'AA=='},type:'image'}]},type:'user',uuid:'a'}]));
  assert.notEqual(nativeDisplayAssetRevision([{data:'AA=='}]),nativeDisplayAssetRevision([{data:'AQ=='}]));
  assert.notEqual(nativeDisplayAssetRevision(['a','b']),nativeDisplayAssetRevision(['b','a']));
});

test('retained final response joins preceding tool activity in the same original assistant turn', () => {
  const source = snap('source', [row('u',null,'user','question'),row('tool','u','assistant',[{type:'tool_use',id:'t',name:'read',input:{}}]),
    row('result','tool','user',[{type:'tool_result',tool_use_id:'t',content:'done'}]),row('a','result','assistant','reply')]);
  const p = projectNativeHistory(current,'a2',{sourceSnapshots:[source]});
  assert.equal(p.messages.length,4);
  assert.deepEqual(p.messages[1].sourceEntryUuids,['tool','result','copy']);
  assert.equal(p.messages[1].providerCheckpointId,'copy');
});

test('every preserved carrier requires exact content evidence, not just the final tail UUID', () => {
  const source = snap('source',[row('u',null,'user','question'),row('tool','u','assistant','original activity'),row('a','tool','assistant','reply')]);
  const s = snap('next',[
    row('c',null,'system',null,{subtype:'compact_boundary',logicalParentUuid:'a',compactMetadata:{preservedMessages:{allUuids:['tool','a']}}}),
    row('s','c','user','summary',{isCompactSummary:true}),row('tool','s','assistant','changed activity'),row('a','tool','assistant','reply')]);
  assert.throws(()=>projectNativeHistory(s,'a',{sourceSnapshots:[source]}),e=>e.code==='CONFLICTING_NATIVE_UUID');
  s.entries[2].message.content='original activity';
  assert.equal(projectNativeHistory(s,'a',{sourceSnapshots:[source]}).messages.length,2);
  s.entries[0].compactMetadata.preservedMessages.allUuids=['u','a'];
  assert.throws(()=>projectNativeHistory(s,'a',{sourceSnapshots:[source]}));
});
