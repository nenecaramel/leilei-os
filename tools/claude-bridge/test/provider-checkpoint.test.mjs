import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { forkSession } from '@anthropic-ai/claude-agent-sdk';
import { AgentSdkClaudeTransport } from '../src/agent-sdk-claude-transport.mjs';
function fixture({ mode = 'resume', conflicting = false, missing = false } = {}) {
    const a = randomUUID(), b = randomUUID(), cp = randomUUID(), tail = randomUUID();
    let state = 'complete';
    const marks = [];
    const map = new Map([[a, [{ type: 'assistant', uuid: cp, parentUuid: null, sessionId: a, message: { role: 'assistant', content: [{ type: 'text', text: 'kept' }] } }]]]);
    const store = { load: async (k) => map.get(k.sessionId) ?? null, getStatus: async () => state, markIncomplete: async () => { state = 'incomplete'; marks.push(state); }, markComplete: async () => { state = 'complete'; marks.push(state); }, append: async (k, v) => map.set(k.sessionId, [...(map.get(k.sessionId) ?? []), ...v]) };
    let calls = 0, options;
    const id = conflicting ? (mode === 'fork' ? a : b) : (mode === 'fork' ? b : a);
    const transport = new AgentSdkClaudeTransport({ environment: {}, cwd: '/private/tmp/provider-checkpoint-test', sessionStore: store, sessionMessagesImpl: async () => [], queryImpl: input => {
            calls++;
            options = input.options;
            return { close() { }, async *[Symbol.asyncIterator]() {
                    if (mode === 'resume')
                        assert.equal(state, 'incomplete');
                    yield { type: 'system', subtype: 'init', session_id: id };
                    if(input.prompt==='/compact')yield {type:'system',subtype:'compact_boundary',session_id:id,compact_metadata:{trigger:'manual',pre_tokens:100}};
                    yield { type: 'assistant', uuid: randomUUID(), session_id: id, message: { content: [{ type: 'text', text: 'ok' }] } };
                    // End-turn tool payload may persist AFTER the final assistant event.
                    if (!missing)
                        map.set(id, [...(map.get(id) ?? []), { type: 'user', uuid: tail, parentUuid: cp, sessionId: id, message: { role: 'user', content: [{ type: 'tool_result', content: 'retained output' }] } }]);
                    yield { type: 'result', uuid: randomUUID(), subtype: 'success', session_id: id, result: 'ok' };
                } };
        } });
    return { a, b, cp, tail, marks, store, transport, run: () => transport.executeTurn('prompt', { mode, parentProviderSessionId: a, parentProviderCheckpointId: cp, requireProviderCheckpoint: true }), get options() { return options; }, get calls() { return calls; } };
}
test('exact historical fork addresses persisted UUID and checkpoints the last carrier, not result UUID', async () => {
    const f = fixture({ mode: 'fork' });
    const result = await f.run();
    assert.equal(f.options.resumeSessionAt, f.cp);
    assert.equal(f.options.forkSession, true);
    assert.equal(result.providerSessionId, f.b);
    assert.equal(result.providerCheckpointId, f.tail);
    assert.equal(f.calls, 1);
});
test('resume keeps branch identity and SessionStore mutation lifecycle', async () => {
    const f = fixture();
    const result = await f.run();
    assert.equal(f.options.resumeSessionAt, f.cp);
    assert.equal(result.providerSessionId, f.a);
    assert.equal(result.providerCheckpointId, f.tail);
    assert.deepEqual(f.marks, ['incomplete', 'complete']);
    assert.equal(f.options.forkSession, undefined);
});
test('resume identity mismatch is rejected', async () => {
    await assert.rejects(fixture({ conflicting: true }).run(), e => e.runtimeCode === 'PROVIDER_SESSION_CONFLICT');
});
test('fork identity mismatch is still rejected', async () => {
    await assert.rejects(fixture({ mode: 'fork', conflicting: true }).run(), e => e.runtimeCode === 'PROVIDER_SESSION_CONFLICT');
});
test('missing historical UUID refuses before query and never falls back to latest tail', async () => {
    const f = fixture({ mode: 'fork' });
    await assert.rejects(f.transport.executeTurn('prompt', { mode: 'fork', parentProviderSessionId: f.a, parentProviderCheckpointId: randomUUID(), requireProviderCheckpoint: true }), e => e.runtimeCode === 'NO_PROVIDER_SESSION');
    assert.equal(f.calls, 0);
    assert.deepEqual(f.marks, []);
});
test('real SDK exact fork excludes later turns and preserves source, including post-compact history', async () => {
    const a = randomUUID(), u = randomUUID(), cp = randomUUID(), later = randomUUID(), boundary = randomUUID();
    const entries = [{ type: 'user', uuid: u, parentUuid: null, sessionId: a, message: { role: 'user', content: 'first' } }, { type: 'assistant', uuid: cp, parentUuid: u, sessionId: a, message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] } }, { type: 'user', uuid: later, parentUuid: cp, sessionId: a, message: { role: 'user', content: 'MUST_NOT_LEAK' } }, { type: 'system', subtype: 'compact_boundary', uuid: boundary, parentUuid: later, sessionId: a, compactMetadata: { trigger: 'manual', preTokens: 100 } }];
    const map = new Map([[a, entries]]);
    const store = { load: async (k) => map.get(k.sessionId) ?? null, append: async (k, v) => map.set(k.sessionId, v) };
    const fork = await forkSession(a, { dir: '/private/tmp/provider-checkpoint-test', upToMessageId: cp, sessionStore: store });
    assert.notEqual(fork.sessionId, a);
    assert.equal(JSON.stringify(map.get(fork.sessionId)).includes('MUST_NOT_LEAK'), false);
    assert.equal(map.get(a), entries);
    await assert.rejects(forkSession(a, { dir: '/private/tmp/provider-checkpoint-test', upToMessageId: randomUUID(), sessionStore: store }), /not found/);
});
test('successful new fork without a persisted transcript checkpoint is not accepted', async () => { await assert.rejects(fixture({ mode: 'fork', missing: true }).run(), e => e.runtimeCode === 'NO_PROVIDER_SESSION'); });
test('V4 checkpoint cannot commit when durable SessionStore completion fails', async () => {
    const f = fixture();
    f.store.markComplete = async () => { throw new Error('store unavailable'); };
    await assert.rejects(f.run(), e => e.runtimeCode === 'RUNTIME_UNAVAILABLE');
});


test('failed local resume can backfill then resume from canonical UUID without failed tail', async () => {
 const a=randomUUID(), cp=randomUUID(), failedTail=randomUUID(), tail=randomUUID();
 let state='complete', attempt=0, imports=0, completed=0;
 const entries=[{type:'assistant',uuid:cp,parentUuid:null,sessionId:a}];
 const store={load:async()=>entries,getStatus:async()=>state,markIncomplete:async()=>{state='incomplete'},markComplete:async()=>{state='complete';completed++},append:async()=>{}};
 const transport=new AgentSdkClaudeTransport({environment:{},cwd:'/private/tmp/provider-checkpoint-test',sessionStore:store,sessionMessagesImpl:async()=>[{type:'assistant'}],importSessionToStoreImpl:async()=>{imports++},queryImpl:({options})=>({close(){},async *[Symbol.asyncIterator](){
  assert.equal(options.resumeSessionAt,cp);
  if(++attempt===1){entries.push({type:'user',uuid:failedTail,parentUuid:cp,sessionId:a});throw Object.assign(new Error('interrupted'),{runtimeCode:'ABORTED'});}
  entries.push({type:'assistant',uuid:tail,parentUuid:cp,sessionId:a});
  yield {type:'result',subtype:'success',session_id:a,result:'ok'};
 }})});
 const run=()=>transport.executeTurn('continue',{mode:'resume',parentProviderSessionId:a,parentProviderCheckpointId:cp,requireProviderCheckpoint:true});
 await assert.rejects(run());assert.equal(state,'incomplete');
 const result=await run();assert.equal(result.providerSessionId,a);assert.equal(result.providerCheckpointId,tail);assert.equal(state,'complete');assert.equal(imports,1);assert.equal(completed,2);
});


test('modern compact starts from canonical checkpoint and requires durable completion',async()=>{
 const f=fixture();const result=await f.transport.compact(f.a,null,f.cp);
 assert.equal(f.options.resumeSessionAt,f.cp);assert.equal(result.providerCheckpointId,f.tail);assert.equal(result.providerSessionId,f.a);
 const broken=fixture();broken.store.markComplete=async()=>{throw new Error('unavailable')};
 await assert.rejects(broken.transport.compact(broken.a,null,broken.cp),e=>e.runtimeCode==='RUNTIME_UNAVAILABLE');
});

test('exact fork loads only the canonical prefix without changing the durable source', async () => {
  const a=randomUUID(), b=randomUUID(), cp=randomUUID(), u=randomUUID(), tail=randomUUID();
  const source=[{type:'assistant',uuid:cp,parentUuid:null,sessionId:a},
   {type:'user',uuid:u,parentUuid:cp,sessionId:a},
   {type:'assistant',uuid:randomUUID(),parentUuid:u,sessionId:a},
   {type:'system',subtype:'compact_boundary',uuid:randomUUID(),parentUuid:u,sessionId:a}];
  const before=structuredClone(source), rows=new Map([[a,source]]);
  const subpath=[{type:'assistant',uuid:randomUUID()}];
  const store={load:async k=>k.subpath?subpath:rows.get(k.sessionId)??null,
   append:async(k,v)=>rows.set(k.sessionId,[...(rows.get(k.sessionId)??[]),...v]),
   getStatus:async()=> 'complete',markIncomplete:async()=>{},markComplete:async()=>{}};
  const transport=new AgentSdkClaudeTransport({environment:{},cwd:'/private/tmp/provider-checkpoint-test',sessionStore:store,
   sessionMessagesImpl:async()=>[],queryImpl:({options})=>({close(){},async *[Symbol.asyncIterator](){
    assert.equal(options.resume,a);assert.equal(options.resumeSessionAt,cp);
    const loaded=await options.sessionStore.load({projectKey:'sdk-normalized',sessionId:a});
    assert.deepEqual(loaded,[before[0]],'Failed user UUID/tail and later compact must not be materialized into this query');
    assert.deepEqual(await options.sessionStore.load({projectKey:'sdk-normalized',sessionId:a,subpath:'agent-test'}),subpath);
    await options.sessionStore.append({projectKey:'sdk-normalized',sessionId:b},[{type:'assistant',uuid:tail,parentUuid:cp,sessionId:b}]);
    yield {type:'result',subtype:'success',session_id:b,result:'ok'};
   }})});
  const result=await transport.executeTurn('prompt',{mode:'fork',parentProviderSessionId:a,parentProviderCheckpointId:cp,requireProviderCheckpoint:true,userMessageUuid:u});
  assert.equal(result.providerCheckpointId,tail);
  assert.deepEqual(rows.get(a).slice(0,before.length),before,'Durable history is retained');
  assert.equal(rows.get(a).length,before.length);
});

test('ordinary exact resume retains the SDK user-UUID replay/idempotency store', async()=>{
 const f=fixture();const original=f.transport.queryImpl;
 f.transport.queryImpl=input=>{assert.equal(input.options.sessionStore,f.store);return original(input)};
 await f.run();
});
