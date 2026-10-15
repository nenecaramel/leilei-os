import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentSdkClaudeTransport } from '../src/agent-sdk-claude-transport.mjs';
function queue(){let waiter,ended=false;const values=[];return {push(v){if(waiter){const w=waiter;waiter=null;w({value:v,done:false});}else values.push(v);},end(){ended=true;waiter?.({done:true});},[Symbol.asyncIterator](){return {next(){return values.length?Promise.resolve({value:values.shift(),done:false}):ended?Promise.resolve({done:true}):new Promise(r=>{waiter=r;});}};}};}
function fixture({loadQuery=null,omitEcho=false,failClose=false}={}){
 const output=queue(),inputs=[],background=[];let calls=0,closed=0,options;
 const queryImpl=({prompt,options:opts})=>{calls++;options=opts;(async()=>{let initialized=false;for await(const input of prompt){inputs.push(input);if(!initialized){initialized=true;output.push({type:'system',subtype:'init',session_id:'s'});}output.push({type:'assistant',session_id:'s',message:{content:[{type:'text',text:input.message.content[0].text}]}});output.push({type:'result',subtype:'success',session_id:'s',result:'synthetic',...(omitEcho==='zero'?{user_message_uuid:'00000000-0000-0000-0000-000000000000'}:omitEcho?{}:{user_message_uuid:input.uuid})});}})();return {close(){closed++;if(failClose){failClose=false;throw new Error('synthetic close failure');}output.end();},async interrupt(){return {still_queued:[]};},async stopTask(){},async *[Symbol.asyncIterator](){yield* output;}};};
 const transport=new AgentSdkClaudeTransport({environment:{},cwd:'/synthetic',toolPermissionPolicy:'auto_allow',...(loadQuery?{loadQuery}:{queryImpl})});
 return {transport,inputs,background,output,queryImpl,get options(){return options;},get calls(){return calls;},get closed(){return closed;},open(extra={}){return transport.openPersistentSession({authorize:async()=>true,onBackgroundResult:async value=>{background.push(value);},...extra});}};
}
test('configured transport uses one SDK query for two turns and retains default settings/permissions',async t=>{
 const f=fixture();const host=await f.open();t.after(()=>host.close());
 const a=await host.submit('first',{id:'a'}),b=await host.submit('second',{id:'b'});
 assert.equal(a.providerSessionId,'s');assert.equal(b.providerSessionId,'s');assert.equal(f.calls,1);assert.equal(f.closed,0);
 assert.deepEqual(f.options.settingSources,['user','project','local']);assert.equal(f.options.permissionMode,'default');assert.equal(f.options.env.ANTHROPIC_API_KEY,undefined);
 assert.deepEqual(await f.options.canUseTool('Write',{synthetic:true},{}),{behavior:'allow'});
 assert.equal(f.options.perTaskStopAffordance,false);
});
test('input admission is awaited and rejection never sends prompt to SDK',async t=>{
 const f=fixture();let release;const barrier=new Promise(r=>{release=r;});const host=await f.open({authorize:async context=>{assert.equal(context.phase,'input');await barrier;return false;}});t.after(()=>host.close());
 const pending=host.submit('blocked');const rejected=assert.rejects(pending,/admission/i);assert.equal(f.inputs.length,0);release();await rejected;assert.equal(f.inputs.length,0);
});
test('persistent owner blocks existing turn APIs, and close releases ownership',async()=>{
 const f=fixture();const host=await f.open();await assert.rejects(f.transport.executeTurn('other'),/active/i);await assert.rejects(f.transport.sendNew('other'),/active/i);await assert.rejects(f.open(),/active/i);await host.close();assert.equal(f.closed,1);const next=await f.open();await next.close();assert.equal(f.calls,2);
});
test('missing result correlation fails explicitly rather than hanging or guessing',async()=>{
 const f=fixture({omitEcho:true});const host=await f.open();await assert.rejects(host.submit('synthetic'),/correlation/i);await assert.rejects(host.completion,/correlation/i);assert.equal(f.closed,1);
});
test('autonomous results reach the required background sink',async t=>{
 const f=fixture();const host=await f.open();t.after(()=>host.close());await host.submit('first',{id:'a'});
 const delivered=new Promise(resolve=>host.events.once('background-result',resolve));f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'background',result:'background'});await delivered;assert.equal(f.background.length,1);assert.equal(f.background[0].result.result,'background');
});
test('tool admission is checked independently of automatic permission approval',async t=>{
 const f=fixture();const host=await f.open({authorize:async context=>context.phase!=='tool'});t.after(()=>host.close());
 const hook=f.options.hooks.PreToolUse[0].hooks[0];const verdict=await hook({hook_event_name:'PreToolUse',tool_name:'Write',tool_input:{}},null,{signal:new AbortController().signal});assert.equal(verdict.hookSpecificOutput.permissionDecision,'deny');
});
test('gates and unsupported resume options are rejected before SDK starts',async()=>{
 const f=fixture();await assert.rejects(f.transport.openPersistentSession(),/authorize/i);await assert.rejects(f.open({resume:'old-session'}),/resume|unsupported/i);assert.equal(f.calls,0);
});
test('abort during SDK loading prevents late startup and releases admission',async()=>{
 let release;const loading=new Promise(r=>{release=r;});const f=fixture({loadQuery:()=>loading});const pending=f.open();const rejected=assert.rejects(pending,/abort/i);f.transport.abort();release(f.queryImpl);await rejected;assert.equal(f.calls,0);
});
test('an earlier legacy launch holds admission while SDK loading is still pending',async t=>{
 let release,loads=0;const loading=new Promise(r=>{release=r;});
 const queryImpl=()=>({close(){},async *[Symbol.asyncIterator](){yield {type:'system',subtype:'init',session_id:'legacy'};yield {type:'result',subtype:'success',session_id:'legacy',result:'done'};}});
 const transport=new AgentSdkClaudeTransport({environment:{},loadQuery:()=>{loads++;if(loads>1)throw new Error('duplicate SDK loading');return loading;}});
 const pending=transport.sendNew('synthetic');pending.catch(()=>{});t.after(async()=>{release(queryImpl);await pending;});
 await assert.rejects(transport.openPersistentSession({authorize:async()=>true,onBackgroundResult:async()=>{}}),/active/i);assert.equal(loads,1);
});
test('failed SDK close holds admission until a successful retry',async()=>{
 const f=fixture({failClose:true});const host=await f.open();await assert.rejects(host.close(),/close failure/);await assert.rejects(f.open(),/active/);await host.close();assert.equal(f.closed,2);
});
test('abort while input admission is pending never delivers the late input',async()=>{
 const f=fixture();let release;const barrier=new Promise(r=>{release=r;});const host=await f.open({authorize:async()=>{await barrier;return true;}});const pending=host.submit('synthetic');const rejected=assert.rejects(pending,/closed/i);f.transport.abort();release();await rejected;assert.equal(f.inputs.length,0);
});
test('actual questions still need real answers; absent handler never invents them',async()=>{
 const f=fixture();let host=await f.open();assert.equal((await f.options.canUseTool('AskUserQuestion',{questions:[]},{})).behavior,'deny');await host.close();
 const answered=fixture();host=await answered.open({questionHandler:async()=>({decision:'answer',answers:{'Synthetic?':'Chosen'}})});
 const answer=await answered.options.canUseTool('AskUserQuestion',{questions:[{question:'Synthetic?',options:[]}]},{});assert.equal(answer.updatedInput.answers['Synthetic?'],'Chosen');await host.close();
});
test('input provenance distinguishes human messages from wake and never defaults to human',async t=>{
 const f=fixture();const admitted=[];const host=await f.open({authorize:async context=>{admitted.push(context);return true;}});t.after(()=>host.close());
 await host.submit('user',{source:'human'});await host.submit('wake',{source:'task-notification'});await host.submit('unspecified');
 assert.deepEqual(f.inputs.map(x=>x.origin.kind),['human','task-notification','unclassified']);assert.deepEqual(admitted.map(x=>x.source),['human','task-notification','unclassified']);assert.equal(f.options.verbatimPrompts,true);
});
test('new input waits until background result ownership has been acknowledged',async t=>{
 const f=fixture();let entered,release,admitted=0;const started=new Promise(r=>{entered=r;});const barrier=new Promise(r=>{release=r;});
 const host=await f.open({authorize:async context=>{if(context.phase==='input')admitted++;return true;},onBackgroundResult:async()=>{entered();await barrier;}});t.after(()=>host.close());await host.submit('first');
 f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'background',result:'synthetic'});await started;
 const pending=host.submit('after-background');pending.catch(()=>{});assert.equal(admitted,1);assert.equal(f.inputs.length,1);release();await pending;assert.equal(f.inputs.length,2);
});
test('permission callback also refuses tool execution after session admission is revoked',async t=>{
 const f=fixture();const host=await f.open({authorize:async context=>context.phase!=='tool'});t.after(()=>host.close());assert.equal((await f.options.canUseTool('Write',{},{})).behavior,'deny');
});
test('zeroed SDK correlation cannot leave a user submission pending forever',async()=>{
 const f=fixture({omitEcho:'zero'});const host=await f.open();const pending=host.submit('synthetic');pending.catch(()=>{});
 const routed=new Promise(resolve=>host.events.once('background-result',()=>resolve('misrouted')));
 const outcome=await Promise.race([pending.then(()=> 'resolved',()=> 'rejected'),routed]);
 try {assert.equal(outcome,'rejected');} finally {await host.close();}
});
test('failed close revokes both tool admission paths while retaining ownership',async()=>{
 const f=fixture({failClose:true});const host=await f.open();
 try {
  await assert.rejects(host.close(),/close failure/);
  assert.equal((await f.options.canUseTool('Write',{},{})).behavior,'deny');
  assert.equal((await f.options.hooks.PreToolUse[0].hooks[0]()).hookSpecificOutput.permissionDecision,'deny');
 } finally {await host.close();}
});
test('close during asynchronous authorization revokes the pending tool',async()=>{
 let entered,release;const started=new Promise(r=>{entered=r;});const barrier=new Promise(r=>{release=r;});
 const f=fixture({failClose:true});const host=await f.open({authorize:async()=>{entered();await barrier;return true;}});
 const verdict=f.options.canUseTool('Write',{},{});await started;
 try {await assert.rejects(host.close(),/close failure/);release();assert.equal((await verdict).behavior,'deny');}
 finally {release();await host.close();}
});
test('background acknowledgement beginning during input admission holds dispatch and revalidates',async t=>{
 let admissionEntered,releaseAdmission,sinkEntered,releaseSink,checks=0;
 const started=new Promise(r=>{admissionEntered=r;});const admission=new Promise(r=>{releaseAdmission=r;});
 const sinking=new Promise(r=>{sinkEntered=r;});const sink=new Promise(r=>{releaseSink=r;});
 const f=fixture();const host=await f.open({authorize:async()=>{checks++;if(checks===2){admissionEntered();await admission;}return true;},onBackgroundResult:async()=>{sinkEntered();await sink;}});t.after(()=>host.close());
 await host.submit('first');const pending=host.submit('second');pending.catch(()=>{});await started;
 f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'background'});await sinking;
 releaseAdmission();await new Promise(r=>setImmediate(r));
 try {assert.equal(f.inputs.length,1);} finally {releaseSink();await pending;}
 assert.equal(checks,3);assert.equal(f.inputs.length,2);
});
test('background acknowledged entirely during admission still requires fresh authorization',async t=>{
 let entered,release,checks=0;const started=new Promise(r=>{entered=r;});const barrier=new Promise(r=>{release=r;});
 const f=fixture();const host=await f.open({authorize:async()=>{checks++;if(checks===2){entered();await barrier;}return true;}});t.after(()=>host.close());
 await host.submit('first');const pending=host.submit('second');pending.catch(()=>{});await started;
 const acknowledged=new Promise(r=>host.events.once('background-result',r));
 f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'background'});await acknowledged;
 release();await pending;assert.equal(checks,3);
});
for (const tool of ['Write','AskUserQuestion']) test(`close while ${tool} handler awaits revokes its late approval`,async()=>{
 let entered,release;const started=new Promise(r=>{entered=r;});const barrier=new Promise(r=>{release=r;});
 const f=fixture({failClose:true});f.transport.toolPermissionPolicy='ask';
 const host=await f.open({permissionHandler:async()=>{entered();await barrier;return {decision:'allow'};},questionHandler:async()=>{entered();await barrier;return {decision:'answer',answers:{Q:'A'}};}});
 const verdict=f.options.canUseTool(tool,{questions:[{question:'Q',options:[]}]},{});await started;
 try {await assert.rejects(host.close(),/close failure/);release();assert.equal((await verdict).behavior,'deny');}finally{release();await host.close();}
});
test('abort in query creation retains failed-close ownership until retry',async()=>{
 const f=fixture({failClose:true});const query=f.transport.queryImpl;
 f.transport.queryImpl=args=>{const result=query(args);queueMicrotask(()=>f.transport.abort());return result;};
 await assert.rejects(f.open(),/close failure/);assert.equal(f.calls,1);
 await assert.rejects(f.open(),/active/);assert.equal(f.calls,1);
 await f.transport.closePersistentSession();assert.equal(f.transport.activeSessionHost,null);
});
