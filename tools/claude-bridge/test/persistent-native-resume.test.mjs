import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentSdkClaudeTransport } from '../src/agent-sdk-claude-transport.mjs';
const sid='11111111-1111-4111-8111-111111111111', cp='22222222-2222-4222-8222-222222222222', prior='33333333-3333-4333-8333-333333333333', inputId='44444444-4444-4444-8444-444444444444';
const spec={sessionId:sid,checkpointId:cp,inputId,source:'task-notification',timeoutMs:50};
function queue(){let waiter,ended=false;const values=[];return {push(value){if(waiter){const w=waiter;waiter=null;w({value,done:false});}else values.push(value);},end(){ended=true;waiter?.({done:true});},[Symbol.asyncIterator](){return {next(){return values.length?Promise.resolve({value:values.shift(),done:false}):ended?Promise.resolve({done:true}):new Promise(r=>{waiter=r;});}};}};}
function fixture({identity=sid,initIdentity=sid,missingReceipt=false,failClose=false,loadQuery=null,sessionStore=null,local=true}={}){
 let constructed;const started=new Promise(r=>{constructed=r;});
 const output=queue(),inputs=[],admissions=[];let calls=0,closed=0,options;
 const entries=[{type:'user',uuid:prior,parentUuid:null,sessionId:sid,message:{role:'user',content:'synthetic'}},{type:'assistant',uuid:cp,parentUuid:prior,sessionId:sid,message:{role:'assistant',content:[]}}];
 const queryImpl=({prompt,options:opts})=>{calls++;options=opts;constructed();
  if(!missingReceipt)queueMicrotask(()=>{const receipt=opts.settings.hooks.SessionStart[0].hooks[0].command.match(/'([^']+)'$/)[1];output.push({type:'system',subtype:'hook_response',hook_event:'SessionStart',stdout:receipt,outcome:'success',exit_code:0,session_id:identity});});
  (async()=>{for await(const input of prompt){inputs.push(input);output.push({type:'command_lifecycle',state:'queued',command_uuid:input.uuid,session_id:sid});output.push({type:'system',subtype:'init',session_id:initIdentity});output.push({type:'result',subtype:'success',session_id:initIdentity,user_message_uuid:input.uuid});}})();
  return {close(){closed++;if(failClose){failClose=false;throw Error('synthetic close failure');}output.end();},async *[Symbol.asyncIterator](){yield* output;}};
 };
 const transport=new AgentSdkClaudeTransport({environment:{},cwd:'/synthetic',queryImpl:loadQuery?null:queryImpl,...(loadQuery?{loadQuery}:{}),sessionStore,sessionMessagesImpl:async()=>local?[{}]:[],importSessionToStoreImpl:async(_id,store)=>{await store.append({sessionId:sid},entries);}});
 const opts={authorize:async context=>{admissions.push(context);return true;},onBackgroundResult:async()=>{}};
 return {transport,entries,output,inputs,admissions,queryImpl,opts,started,get calls(){return calls;},get closed(){return closed;},get options(){return options;},open(extra={}){return transport.restorePersistentSession(spec,{...opts,...extra});}};
}
test('native persistent resume verifies startup identity then continues two turns in the original query',async t=>{
 const f=fixture();const host=await f.open();t.after(()=>host.close());assert.equal(f.inputs.length,0);
 const first=await host.submit('wake',{id:inputId,source:'task-notification'});
 const second=await host.submit('next',{id:'55555555-5555-4555-8555-555555555555',source:'human'});
 assert.equal(first.providerSessionId,sid);assert.equal(second.providerSessionId,sid);assert.equal(f.calls,1);assert.equal(f.options.resume,sid);assert.equal(f.options.resumeSessionAt,cp);assert.equal(f.options.forkSession,undefined);assert.equal(f.options.sessionStore,undefined);assert.deepEqual(f.options.thinking,{type:'adaptive',display:'summarized'});
 assert.ok(f.admissions.length>=3);assert.equal(f.admissions[0].providerSessionId,sid);
});
test('copied startup identity refuses prompt delivery',async()=>{
 const f=fixture({identity:'99999999-9999-4999-8999-999999999999'});await assert.rejects(f.open(),/different|identity|session/i);assert.equal(f.inputs.length,0);assert.equal(f.closed,1);
});
test('missing startup identity times out and closes without input',async()=>{
 const f=fixture({missingReceipt:true});await assert.rejects(f.open(),/deadline|timeout|identity/i);assert.equal(f.inputs.length,0);assert.equal(f.closed,1);
});
test('initial native submit cannot silently change the reserved UUID or source',async t=>{
 const f=fixture();const host=await f.open();t.after(()=>host.close());
 await assert.rejects(host.submit('wrong',{id:'wrong',source:'human'}),/initial|identity|input/i);assert.equal(f.inputs.length,0);
 await host.submit('right',{id:inputId,source:'task-notification'});
});
test('unseen local history added during SDK loading is not rewound',async()=>{
 let release,entered;const started=new Promise(r=>{entered=r;}),loading=new Promise(r=>{release=r;});const f=fixture({loadQuery:()=>{entered();return loading;}});
 const opening=f.open(),rejected=assert.rejects(opening,/unsynchronized|history/i);await started;
 f.entries.push({type:'user',uuid:'66666666-6666-4666-8666-666666666666',parentUuid:cp,sessionId:sid,message:{role:'user',content:'synthetic later'}});release(f.queryImpl);await rejected;assert.equal(f.calls,0);
});
test('startup admission denial never constructs the SDK query',async()=>{
 const f=fixture();await assert.rejects(f.open({authorize:async()=>false}),/admission/i);assert.equal(f.calls,0);
});
test('remote materializing stores and unavailable local sessions cannot be restored',async()=>{
 const remote=fixture({sessionStore:{load:async()=>[],append:async()=>{}}});await assert.rejects(remote.open(),/local|store|materializ/i);assert.equal(remote.calls,0);
 const absent=fixture({local:false});await assert.rejects(absent.open(),/transcript|session/i);assert.equal(absent.calls,0);
});
test('abort while native startup waits rejects opening and releases ownership',async()=>{
 const f=fixture({missingReceipt:true});const opening=f.open();const rejected=assert.rejects(opening,/abort|closed|identity/i);
 await Promise.race([f.started,opening]);f.transport.abort();await rejected;assert.equal(f.inputs.length,0);assert.equal(f.transport.activeSessionHost,null);
});
test('failed close after invalid native startup retains ownership for explicit retry',async()=>{
 const f=fixture({identity:'99999999-9999-4999-8999-999999999999',failClose:true});await assert.rejects(f.open());
 await assert.rejects(f.open(),/active/i);await f.transport.closePersistentSession();assert.equal(f.transport.activeSessionHost,null);
});
test('native history is rechecked after the final asynchronous admission check',async()=>{
 const f=fixture();let calls=0,entered,release;const waiting=new Promise(r=>{entered=r;}),barrier=new Promise(r=>{release=r;});
 const opening=f.open({authorize:async()=>{calls++;if(calls===2){entered();await barrier;}return true;}});
 const rejected=assert.rejects(opening,/unsynchronized|history/i);await waiting;
 f.entries.push({type:'user',uuid:'66666666-6666-4666-8666-666666666666',parentUuid:cp,sessionId:sid,message:{role:'user',content:'synthetic late'}});release();
 try {await rejected;assert.equal(f.calls,0);}finally{await f.transport.closePersistentSession();}
});
test('abort immediately after a valid startup receipt cannot report a closed host as restored',async()=>{
 const f=fixture();
 f.transport.queryImpl=({options})=>({close(){},async *[Symbol.asyncIterator](){
  const receipt=options.settings.hooks.SessionStart[0].hooks[0].command.match(/'([^']+)'$/)[1];
  yield {type:'system',subtype:'hook_response',hook_event:'SessionStart',stdout:receipt,outcome:'success',exit_code:0,session_id:sid};
  f.transport.abort();await new Promise(()=>{});
 }});
 await assert.rejects(f.open(),/abort|closed/i);assert.equal(f.transport.activeSessionHost,null);
});
