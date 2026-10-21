import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentSdkClaudeTransport } from '../src/agent-sdk-claude-transport.mjs';
import { LEILEIOS_INTERACTIVE_SYSTEM_PROMPT } from '../src/agent-sdk-transport-support.mjs';
function queue(){let waiter,ended=false;const values=[];return {push(v){if(waiter){const w=waiter;waiter=null;w({value:v,done:false});}else values.push(v);},end(){ended=true;waiter?.({done:true});},[Symbol.asyncIterator](){return {next(){return values.length?Promise.resolve({value:values.shift(),done:false}):ended?Promise.resolve({done:true}):new Promise(r=>{waiter=r;});}};}};}
function fixture({loadQuery=null,omitEcho=false,failClose=false,manualResults=false,onInput=()=>{}}={}){
 const output=queue(),inputs=[],background=[];let calls=0,closed=0,options;
 const queryImpl=({prompt,options:opts})=>{calls++;options=opts;(async()=>{let initialized=false;for await(const input of prompt){inputs.push(input);onInput(input);if(!initialized){initialized=true;output.push({type:'system',subtype:'init',session_id:'s'});}if(manualResults)continue;output.push({type:'assistant',session_id:'s',message:{content:[{type:'text',text:input.message.content[0].text}]}});output.push({type:'result',subtype:'success',session_id:'s',result:'synthetic',...(omitEcho==='zero'?{user_message_uuid:'00000000-0000-0000-0000-000000000000'}:omitEcho?{}:{user_message_uuid:input.uuid})});}})();return {close(){closed++;if(failClose){failClose=false;throw new Error('synthetic close failure');}output.end();},async interrupt(){return {still_queued:[]};},async stopTask(){},async *[Symbol.asyncIterator](){yield* output;}};};
 const transport=new AgentSdkClaudeTransport({environment:{},cwd:'/synthetic',toolPermissionPolicy:'auto_allow',...(loadQuery?{loadQuery}:{queryImpl})});
 return {transport,inputs,background,output,queryImpl,get options(){return options;},get calls(){return calls;},get closed(){return closed;},open(extra={}){return transport.openPersistentSession({authorize:async()=>true,onBackgroundResult:async value=>{background.push(value);},...extra});}};
}
test('configured transport uses one SDK query for two turns and retains default settings/permissions',async t=>{
 const f=fixture();const host=await f.open();t.after(()=>host.close());
 const a=await host.submit('first',{id:'a'}),b=await host.submit('second',{id:'b'});
 assert.equal(a.providerSessionId,'s');assert.equal(b.providerSessionId,'s');assert.equal(f.calls,1);assert.equal(f.closed,0);
 assert.deepEqual(f.options.settingSources,['user','project','local']);assert.equal(f.options.permissionMode,'default');
 // A resumed Desktop-born session must still receive the LeileiOS guidance.
 assert.deepEqual(f.options.systemPrompt,{type:'custom',prompt:LEILEIOS_INTERACTIVE_SYSTEM_PROMPT,snapshot:false});assert.equal(f.options.env.ANTHROPIC_API_KEY,undefined);
 assert.deepEqual(await f.options.canUseTool('Write',{synthetic:true},{}),{behavior:'allow'});
 assert.equal(f.options.perTaskStopAffordance,false);
 assert.deepEqual(f.options.thinking,{type:'adaptive',display:'summarized'});
});
test('a forked edit keeps its native SDK query open through a second human turn and cleans only the transient prefix',async t=>{
  const parentId='10000000-0000-4000-8000-000000000001';
  const checkpoint='10000000-0000-4000-8000-000000000002';
  const userId='10000000-0000-4000-8000-000000000003';
  const localForkId='10000000-0000-4000-8000-000000000004';
  const childId='10000000-0000-4000-8000-000000000005';
  const prefix=[
    {type:'user',uuid:userId,parentUuid:null,sessionId:parentId,message:{role:'user',content:[{type:'text',text:'synthetic'}]}},
    {type:'assistant',uuid:checkpoint,parentUuid:userId,sessionId:parentId,message:{role:'assistant',content:[{type:'text',text:'synthetic'}]}},
  ];
  const output=queue();let launches=0,closed=0,cleaned=0,options;
  const transport=new AgentSdkClaudeTransport({
    environment:{},cwd:'/synthetic',toolPermissionPolicy:'auto_allow',
    createSendFileMcpServerImpl:async()=>null,
    importSessionToStoreImpl:async (_session,store)=>store.append({subpath:null},prefix),
    prepareLocalCheckpointForkImpl:async ({sessionId,checkpointId, prefix:entries})=>{
      assert.equal(sessionId,parentId);assert.equal(checkpointId,checkpoint);
      assert.equal(entries.at(-1)?.uuid,checkpoint);
      return {sessionId:localForkId,async cleanup(){cleaned++;}};
    },
    queryImpl:({prompt,options:opts})=>{
      launches++;options=opts;output.push({type:'system',subtype:'init',session_id:childId});
      void(async()=>{for await(const input of prompt){
        output.push({type:'assistant',session_id:childId,uuid:'synthetic-assistant',
          message:{content:[{type:'text',text:'synthetic reply'}]}});
        output.push({type:'result',subtype:'success',session_id:childId,
          user_message_uuid:input.uuid,result:'synthetic reply'});
      }})();
      return {close(){closed++;output.end();},async interrupt(){return {still_queued:[]};},
        async *[Symbol.asyncIterator](){yield* output;}};
    },
  });
  const host=await transport.forkPersistentSession({sessionId:parentId,checkpointId:checkpoint},{
    authorize:async()=>true,onBackgroundResult:async()=>{},
  });t.after(()=>host.close());
  const first=await host.submit('edited CronCreate message',{id:'edit-uuid'});
  await new Promise(setImmediate);
  assert.equal(first.providerSessionId,childId);
  assert.equal(cleaned,1,'temporary fork prefix is removed only after the SDK accepts the first result');
  const second=await host.submit('ordinary chat afterwards',{id:'next-uuid'});
  assert.equal(second.providerSessionId,childId);
  assert.equal(launches,1,'native Cron must stay in the same live forked process after editing');
  assert.equal(closed,0);
  assert.equal(options.forkSession,true);
  assert.equal(options.resume,localForkId);
  assert.equal(options.resumeSessionAt,checkpoint);
});

test('persistent SDK thinking summaries survive continued turns and respect explicit modes',async t=>{
 const cases=[
   ['default',null,{type:'adaptive',display:'summarized'}],
   ['adaptive',{model:'claude-opus-5-5',thinking:'adaptive',effort:'high'},{type:'adaptive',display:'summarized'}],
   ['disabled',{model:'claude-opus-5',thinking:'disabled',effort:'high'},{type:'disabled'}],
   ['between_tools',{model:'claude-sonnet-5-5',thinking:'between_tools',effort:'high'},{type:'between_tools'}],
 ];
 for(const [name,execution,expected] of cases){
   await t.test(name,async t=>{
     const f=fixture();const host=await f.open({execution});t.after(()=>host.close());
     assert.deepEqual(f.options.thinking,expected);
     assert.equal(f.options.model,execution?.model);
     assert.equal(f.options.effort,execution?.effort);
     const first=await host.submit('first',{id:'one'});
     const second=await host.submit('second',{id:'two'});
     assert.equal(first.providerSessionId,second.providerSessionId);
     assert.equal(f.calls,1,'no new query is started for the continued turn');
   });
 }
});

test('persistent SDK emits provider-supplied visible thinking without exposing signatures',async t=>{
 let f;
 // The fixture emits SDK init immediately after onInput, so queue the reply
 // after that init to preserve the real provider's startup ordering.
 f=fixture({manualResults:true,onInput:input=>queueMicrotask(()=>{
   f.output.push({type:'assistant',session_id:'s',uuid:'visible-thinking',user_message_uuid:input.uuid,
     message:{content:[{type:'thinking',thinking:'Provider summary.',signature:'PRIVATE_SIGNATURE'},
       {type:'text',text:'Response.'}]}});
   f.output.push({type:'result',subtype:'success',session_id:'s',result:'Response.',user_message_uuid:input.uuid});
 })});
 const host=await f.open();t.after(()=>host.close());
 const live=[];
 const result=await host.submit('ordinary chat',{id:'mine',onNormalizedEvent:event=>{live.push(event);}});
 assert.deepEqual(f.options.thinking,{type:'adaptive',display:'summarized'});
 const visible=result.normalizedEvents.filter(event=>event.payload?.kind==='user_visible_thinking');
 assert.equal(visible.length,1);
 assert.equal(visible[0].payload.text,'Provider summary.');
 assert.equal(live.filter(event=>event.payload?.kind==='user_visible_thinking').length,1);
 assert.ok(!JSON.stringify(result.normalizedEvents).includes('PRIVATE_SIGNATURE'));
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
 assert.deepEqual(f.inputs.map(x=>x.origin.kind),['human','task-notification','unclassified']);assert.deepEqual(admitted.map(x=>x.source),['human','task-notification','unclassified']);assert.equal(f.options.verbatimPrompts,false);
 assert.deepEqual(f.inputs.map(x=>x.client_composed),[true,true,true]);
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

for (const phase of ['authorization','permission','pre-tool']) test(`old ${phase} callback cannot approve a different active turn`,async t=>{
 let release,entered,receivedOne,receivedTwo;
 const barrier=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const firstInput=new Promise(r=>{receivedOne=r;}),secondInput=new Promise(r=>{receivedTwo=r;});
 const f=fixture({manualResults:true,onInput:input=>(input.uuid==='a'?receivedOne:receivedTwo)()});
 f.transport.toolPermissionPolicy='ask';
 const host=await f.open({authorize:async context=>{if(phase!=='permission'&&context.phase==='tool'){entered();await barrier;}return true;},permissionHandler:async()=>{entered();await barrier;return {decision:'allow'};}});
 t.after(async()=>{release();await host.close();});
 const one=host.submit('first',{id:'a'});await firstInput;
 const pending=phase==='pre-tool'?f.options.hooks.PreToolUse[0].hooks[0]():f.options.canUseTool('Write',{},{});
 await started;
 f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'a'});await one;
 const two=host.submit('second',{id:'b'});await secondInput;
 release();const verdict=await pending;
 f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'b'});await two;
 assert.equal(phase==='pre-tool'?verdict.hookSpecificOutput?.permissionDecision:verdict.behavior,'deny');
});
test('retirement between nested authorization and outer tool continuation cannot return allow',async t=>{
 let host,closing,received,toolAdmissions=0;
 const input=new Promise(r=>{received=r;});
 const f=fixture({manualResults:true,onInput:()=>received()});f.transport.toolPermissionPolicy='ask';
 host=await f.open({authorize:async context=>{
  if(context.phase==='tool'&&++toolAdmissions===2){let remaining=2;const retire=()=>{if(remaining-->0)queueMicrotask(retire);else closing=host.close();};queueMicrotask(retire);}
  return true;
 },permissionHandler:async()=>({decision:'allow'})});
 t.after(()=>host.close());
 const pending=host.submit('synthetic',{id:'a'});const rejected=assert.rejects(pending,/closed/);await input;
 const verdict=await f.options.canUseTool('Write',{},{});await closing;await rejected;
 assert.equal(verdict.behavior,'deny');
});

test('send_file reaches only the turn that owns the live reply, never background work',async t=>{
 const output=queue();let options,serverHandler;
 const queryImpl=({prompt,options:opts})=>{options=opts;(async()=>{let init=false;for await(const input of prompt){if(!init){init=true;output.push({type:'system',subtype:'init',session_id:'s'});}}})();return {close(){output.end();},async interrupt(){return {still_queued:[]};},async stopTask(){},async *[Symbol.asyncIterator](){yield* output;}};};
 const transport=new AgentSdkClaudeTransport({environment:{},cwd:'/synthetic',toolPermissionPolicy:'auto_allow',queryImpl,createSendFileMcpServerImpl:async handler=>{serverHandler=handler;return {type:'sdk',name:'leileios_local'};}});
 const host=await transport.openPersistentSession({authorize:async()=>true,onBackgroundResult:async()=>{}});t.after(()=>host.close());
 assert.ok(options.mcpServers.leileios_local,'one session-level send_file server');
 const sent=[];const pending=host.submit('user',{id:'owned',sendFileHandler:async input=>{sent.push(input.path);return {attachmentId:'a'};}});
 await new Promise(r=>setTimeout(r,0));
 const send=()=>serverHandler({path:'/synthetic/file.txt',displayName:null});
 const step=value=>new Promise(resolve=>{host.events.once('event',resolve);output.push(value);});
 await step({type:'assistant',session_id:'s',parent_tool_use_id:null,message:{content:[{type:'text',text:'background'}]}});
 await assert.rejects(send(),/send_file/i);
 await step({type:'assistant',session_id:'s',parent_tool_use_id:null,user_message_uuid:'owned',user_message_uuids:['owned'],message:{content:[{type:'text',text:'mine'}]}});
 // Rejected duplicate reservations may not remove the active turn's handler.
 await assert.rejects(host.submit('duplicate',{id:'owned',sendFileHandler:async()=>({attachmentId:'wrong'})}),/duplicate/i);
 assert.deepEqual(await send(),{attachmentId:'a'});assert.deepEqual(sent,['/synthetic/file.txt']);
 await step({type:'result',subtype:'success',session_id:'s',result:'done',user_message_uuid:'owned'});await pending;
 await assert.rejects(send(),/send_file/i);
});

test('a turn checkpoint is accepted only once durable and descended from the committed one',async t=>{
 const transcript=[];const output=queue();
 const queryImpl=({prompt})=>{(async()=>{for await(const input of prompt){output.push({type:'system',subtype:'init',session_id:'s'});}})();return {close(){output.end();},async interrupt(){return {still_queued:[]};},async stopTask(){},async *[Symbol.asyncIterator](){yield* output;}};};
 const transport=new AgentSdkClaudeTransport({environment:{},cwd:'/synthetic',toolPermissionPolicy:'auto_allow',queryImpl,createSendFileMcpServerImpl:async()=>({type:'sdk'}),
  importSessionToStoreImpl:async(id,store)=>store.append({sessionId:id},transcript.map(e=>({...e})))});
 const host=await transport.openPersistentSession({authorize:async()=>true,onBackgroundResult:async()=>{}});t.after(()=>host.close());
 const pending=host.submit('first',{id:'a'});await new Promise(r=>setTimeout(r,0));
 const said=uuid=>({type:'assistant',uuid,session_id:'s',parent_tool_use_id:null,message:{content:[{type:'text',text:'x'}]}});
 const events=[{type:'assistant',uuid:'sub',session_id:'s',parent_tool_use_id:'tool',message:{content:[]}},
  {type:'assistant',uuid:'agent',session_id:'s',parent_agent_id:'subagent',message:{content:[]}},said('a1')];
 // Not yet written: a bounded wait, then refused.
 await assert.rejects(host.verifyCheckpoint({events,timeoutMs:30,pollMs:5}),/durably/);
 transcript.push({type:'user',uuid:'u1',parentUuid:null},{type:'assistant',uuid:'a1',parentUuid:'u1'});
 assert.equal(await host.verifyCheckpoint({events,timeoutMs:30,pollMs:5}),'a1','top-level assistant, not the subagent record');
 // Persisted UUIDs must identify a unique top-level assistant, not a user
 // echo, another session's record or a duplicated provider transcript entry.
 transcript.push({type:'user',uuid:'wrong-type',parentUuid:'a1'});
 await assert.rejects(host.verifyCheckpoint({events:[said('wrong-type')],parentCheckpointId:'a1',timeoutMs:30,pollMs:5}),/top-level assistant/);
 transcript.push({type:'assistant',uuid:'wrong-session',parentUuid:'a1',sessionId:'elsewhere'});
 await assert.rejects(host.verifyCheckpoint({events:[said('wrong-session')],parentCheckpointId:'a1',timeoutMs:30,pollMs:5}),/top-level assistant/);
 transcript.push({type:'assistant',uuid:'duplicated',parentUuid:'a1'},{type:'assistant',uuid:'duplicated',parentUuid:'a1'});
 await assert.rejects(host.verifyCheckpoint({events:[said('duplicated')],parentCheckpointId:'a1',timeoutMs:30,pollMs:5}),/top-level assistant/);
 await assert.rejects(host.verifyCheckpoint({events:[{...said('agent'),parent_agent_id:'subagent'}],timeoutMs:30,pollMs:5}),/no new/);
 // Written while we wait.
 setTimeout(()=>transcript.push({type:'user',uuid:'u2',parentUuid:'a1'},{type:'assistant',uuid:'a2',parentUuid:'u2'}),10);
 assert.equal(await host.verifyCheckpoint({events:[said('a2')],parentCheckpointId:'a1',timeoutMs:500,pollMs:5}),'a2');
 // A record on another branch does not continue the committed checkpoint.
 transcript.push({type:'assistant',uuid:'b1',parentUuid:'u1'});
 await assert.rejects(host.verifyCheckpoint({events:[said('b1')],parentCheckpointId:'a2',timeoutMs:30,pollMs:5}),/continue/);
 await assert.rejects(host.verifyCheckpoint({events:[said('a2')],parentCheckpointId:'a2'}),/no new/);
 await assert.rejects(host.verifyCheckpoint({events:[]}),/no new/);
 output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'a'});await pending;
});

test('only explicit human /loop dispatches the native skill; composed input stays literal', async t => {
 const f=fixture();const host=await f.open();t.after(()=>host.close());
 for(const [text,source] of [['/loop 5m synthetic','human'],['ordinary @private/path','human'],['/loop injected','task-notification'],['/loop injected','unclassified'],['/loopback','human']]) await host.submit(text,{source});
 assert.equal(f.options.verbatimPrompts,false);
 assert.deepEqual(f.inputs.map(x=>x.client_composed),[undefined,true,true,true,true]);
 assert.equal(f.calls,1);
});

const scheduledInput=(id,extra={})=>({hook_event_name:'UserPromptSubmit',source:'schedule_wakeup',session_id:'s',prompt_id:id,prompt:'synthetic',...extra});
const isBlocked=value=>value.decision==='block';
test('native scheduled input gets fresh admission before inference, not just before a tool', async t => {
 const contexts=[];let allow=true;
 const f=fixture();const host=await f.open({authorize:async context=>{contexts.push(context);return context.phase!=='scheduled'||allow;}});t.after(()=>host.close());
 await host.submit('first',{source:'human'});
 const hook=f.options.hooks.UserPromptSubmit?.[0].hooks[0];assert.equal(typeof hook,'function');
 allow=false;assert.equal(isBlocked(await hook(scheduledInput('denied'))),true);
 assert.equal(contexts.at(-1).phase,'scheduled');assert.equal(contexts.at(-1).inputId,null);
 assert.equal(contexts.at(-1).providerSessionId,'s');
});
test('scheduled admission fails closed for malformed, foreign and repeated deliveries', async t => {
 const f=fixture();const host=await f.open();t.after(()=>host.close());await host.submit('first');
 const hook=f.options.hooks.UserPromptSubmit?.[0].hooks[0];assert.equal(typeof hook,'function');
 for(const extra of [{session_id:'foreign'},{prompt_id:undefined},{agent_id:'child'},{source:'unrecognized'}]) assert.equal(isBlocked(await hook(scheduledInput('bad',extra))),true);
 assert.equal(isBlocked(await hook(scheduledInput('once'))),false);
 assert.equal(isBlocked(await hook(scheduledInput('once'))),true);
});
test('scheduled admission rechecks foreground ownership after awaiting the server', async t => {
 let entered,release;const started=new Promise(r=>{entered=r;}),barrier=new Promise(r=>{release=r;});
 const f=fixture({manualResults:true});const host=await f.open({authorize:async context=>{if(context.phase==='scheduled'){entered();await barrier;}return true;}});t.after(()=>host.close());
 const boot=host.submit('boot',{id:'boot'});await new Promise(r=>host.events.once('event',r));
 f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'boot'});await boot;
 const hook=f.options.hooks.UserPromptSubmit?.[0].hooks[0];assert.equal(typeof hook,'function');
 const admission=hook(scheduledInput('racing'));await started;
 const next=host.submit('next',{id:'next'});next.catch(()=>{});release();
 assert.equal(isBlocked(await admission),true);
 f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'next'});await next;
});
test('scheduled execution has a minimum interval, finite budget and lifetime', async t => {
 let now=1_800_000_000_000;t.mock.method(Date,'now',()=>now);
 const f=fixture();const host=await f.open();t.after(()=>host.close());await host.submit('first');
 const hook=f.options.hooks.UserPromptSubmit?.[0].hooks[0];assert.equal(typeof hook,'function');
 for(let n=0;n<64;n++){assert.equal(isBlocked(await hook(scheduledInput(`fire-${n}`))),false);assert.equal(isBlocked(await hook(scheduledInput(`burst-${n}`))),true);now+=60_000;}
 assert.equal(isBlocked(await hook(scheduledInput('over-budget'))),true);
 const other=fixture();const otherHost=await other.open();t.after(()=>otherHost.close());await otherHost.submit('first');
 now+=7*24*60*60*1_000;
 assert.equal(isBlocked(await other.options.hooks.UserPromptSubmit[0].hooks[0](scheduledInput('expired'))),true);
});
test('scheduled guard cannot block ordinary input or resurrect a closed writer', async t => {
 const f=fixture();const host=await f.open();t.after(()=>host.close());await host.submit('first');
 const hook=f.options.hooks.UserPromptSubmit?.[0].hooks[0];assert.equal(typeof hook,'function');
 const next=host.submit('second',{id:'second'});await next;
 assert.equal(isBlocked(await hook(scheduledInput('valid'))),false);
 await host.close();assert.equal(isBlocked(await hook(scheduledInput('late'))),true);
 assert.equal(f.calls,1);
});

test('scheduled authorization timeout does not block foreground input or retry a lost admission', async t => {
 t.mock.timers.enable({apis:['setTimeout']});let scheduled=0;
 const f=fixture();const host=await f.open({authorize:async context=>{if(context.phase==='scheduled'){scheduled++;return new Promise(()=>{});}return true;}});t.after(()=>host.close());await host.submit('first');
 const hook=f.options.hooks.UserPromptSubmit[0].hooks[0];
 const pending=hook(scheduledInput('timeout'));t.mock.timers.tick(2_000);
 assert.equal(isBlocked(await pending),true);assert.equal(scheduled,1);
 assert.equal(isBlocked(await hook(scheduledInput('timeout'))),true);assert.equal(scheduled,1);
 await host.submit('cancel scheduled work',{source:'human'});
 assert.equal((await f.options.canUseTool('CronDelete',{id:'synthetic'},{})).behavior,'allow');
});

test('ordinary SDK input and background task notifications retain their existing admission paths', async t => {
 const f=fixture({onInput:input=>{void f.options.hooks.UserPromptSubmit[0].hooks[0]({source:'sdk',session_id:'s',prompt:input.message.content[0].text});}});const host=await f.open();t.after(()=>host.close());
 const hook=f.options.hooks.UserPromptSubmit[0].hooks[0];
 for(const source of ['user','sdk','system','poll_event']) assert.deepEqual(await hook({source}),{});
 await host.submit('ordinary',{source:'human'});
 assert.equal((await f.options.canUseTool('CronCreate',{cron:'*/5 * * * *',prompt:'synthetic'},{})).behavior,'allow');
 assert.equal((await f.options.canUseTool('CronList',{},{})).behavior,'allow');
 assert.equal((await f.options.canUseTool('ScheduleWakeup',{stop:true},{})).behavior,'allow');
});

test('legacy unstamped foreground and mid-turn input use normal durable tool admission', async t => {
 const f=fixture({manualResults:true});const host=await f.open();t.after(()=>host.close());
 const initialized=new Promise(resolve=>host.events.once('event',resolve));
 const pending=host.submit('legacy chat',{id:'legacy'});pending.catch(()=>{});await initialized;
 const hook=f.options.hooks.UserPromptSubmit[0].hooks[0];
 const legacy=scheduledInput('ordinary',{source:undefined,prompt:'legacy chat'});
 assert.deepEqual(await hook(legacy),{});
 assert.equal(isBlocked(await hook(legacy)),true,'a callback overtaking the preceding result cannot reuse the foreground ticket');
 assert.equal((await f.options.canUseTool('CronCreate',{prompt:'synthetic'},{})).behavior,'allow');
 await host.sendUserMessage('supplement',{uuid:'supplement'});
 assert.deepEqual(await hook({...legacy,prompt:'supplement'}),{});
 for(const [name,input] of [['CronList',{}],['CronDelete',{id:'synthetic'}],['ScheduleWakeup',{stop:true}]]) assert.equal((await f.options.canUseTool(name,input,{})).behavior,'allow');
 f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuids:['legacy','supplement']});await pending;
 assert.equal(isBlocked(await hook({...legacy,prompt_id:'unknown-idle'})),false);
 assert.equal((await f.options.canUseTool('CronCreate',{prompt:'synthetic'},{})).behavior,'allow');
});


test('legacy idle task notification without source cannot bypass durable tool admission', async t => {
 let admitted=true;const contexts=[];
 const f=fixture();const host=await f.open({authorize:async c=>{contexts.push(c);return c.phase==='tool'?false:c.phase!=='scheduled'||admitted;}});t.after(()=>host.close());
 await host.submit('first');
 const hook=f.options.hooks.UserPromptSubmit[0].hooks[0];
 const notification={hook_event_name:'UserPromptSubmit',session_id:'s',prompt:'synthetic task notification'};
 assert.deepEqual(await hook(notification),{});
 assert.deepEqual(await hook({...notification,prompt_id:'generic-correlation'}),{});
 assert.equal(contexts.at(-1).phase,'scheduled','legacy autonomous inference still checks durable ownership');
 assert.equal((await f.options.canUseTool('CronCreate',{prompt:'synthetic'},{})).behavior,'deny');
 assert.equal((await f.options.canUseTool('ScheduleWakeup',{wake_at:'synthetic'},{})).behavior,'deny');
 admitted=false;assert.equal(isBlocked(await hook(notification)),true);
 for(const extra of [{session_id:'foreign'},{agent_id:'child'},{source:'unknown'},{source:'schedule_wakeup'}]) assert.equal(isBlocked(await hook({...notification,...extra})),true);
 await host.close();assert.equal(isBlocked(await hook(notification)),true);
});


test('unstamped autonomous admission is bounded and cannot borrow a later foreground turn', async t => {
 let entered,release;const barrier=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const f=fixture({manualResults:true});const host=await f.open({authorize:async c=>{if(c.phase==='scheduled'){entered();await barrier;}return true;}});t.after(()=>host.close());
 const boot=host.submit('boot',{id:'boot'});await new Promise(r=>host.events.once('event',r));
 f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'boot'});await boot;
 const hook=f.options.hooks.UserPromptSubmit[0].hooks[0];
 const pending=hook({session_id:'s',prompt:'synthetic notification'});await started;
 const next=host.submit('next',{id:'next'});next.catch(()=>{});release();
 assert.equal(isBlocked(await pending),true);
 f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'next'});await next;
});


test('unclassified autonomous input has finite attempts, lifetime, and synchronous concurrency fencing', async t => {
 const {createScheduledInputGuard}=await import('../src/agent-sdk-scheduled-input.mjs');
 const {EventEmitter}=await import('node:events');let now=1000,calls=0,release;
 const host={state:'idle',sessionId:'s',events:new EventEmitter(),backgroundGeneration:0};
 let gate=new Promise(r=>{release=r;});
 const guard=createScheduledInputGuard({getHost:()=>host,now:()=>now,admit:async()=>{calls++;await gate;}});
 const input={session_id:'s',prompt:'synthetic',prompt_id:'generic-reused-correlation'};
 const one=guard(input);assert.equal(isBlocked(await guard(input)),true);assert.equal(calls,1);
 release();await one;gate=Promise.resolve();
 for(let n=1;n<64;n++)assert.deepEqual(await guard(input),{});
 assert.equal(isBlocked(await guard(input)),true);assert.equal(calls,64);
 const lifetime=createScheduledInputGuard({getHost:()=>host,now:()=>now,admit:async()=>{calls++;}});
 now+=7*24*60*60*1000;assert.equal(isBlocked(await lifetime(input)),true);assert.equal(calls,64);
});

test('partial hook source rollout does not replace fresh durable scheduling tool admission', async t => {
 let owner=true,checks=0;
 const f=fixture({onInput:input=>{void f.options.hooks.UserPromptSubmit[0].hooks[0]({source:'sdk',session_id:'s',prompt:input.message.content[0].text});}});
 const host=await f.open({authorize:async c=>{if(c.phase==='tool'){checks++;return owner;}return true;}});t.after(()=>host.close());await host.submit('synthetic');
 assert.equal((await f.options.canUseTool('CronCreate',{},{})).behavior,'allow');const before=checks;
 assert.deepEqual(await f.options.hooks.UserPromptSubmit[0].hooks[0]({session_id:'s',prompt:'synthetic notification',prompt_id:'correlation'}),{});
 assert.equal((await f.options.canUseTool('CronCreate',{},{})).behavior,'allow');assert.ok(checks>before);
 owner=false;
 for(const name of ['CronCreate','ScheduleWakeup','CronDelete'])assert.equal((await f.options.canUseTool(name,{},{})).behavior,'deny');
});

test('unstamped autonomous timeout does not poison later authorized foreground tools', async t => {
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 const f=fixture();const host=await f.open({authorize:async c=>{if(c.phase==='scheduled'){calls++;return new Promise(()=>{});}return true;}});t.after(()=>host.close());await host.submit('first');
 const hook=f.options.hooks.UserPromptSubmit[0].hooks[0];
 const pending=hook({session_id:'s',prompt_id:'correlation',prompt:'synthetic notification'});
 t.mock.timers.tick(2000);const verdict=await pending;
 assert.equal(isBlocked(verdict),true);assert.match(verdict.reason,/ADMISSION_TIMEOUT/);assert.equal(calls,1);
 await host.submit('foreground after timeout',{source:'human'});
 assert.equal((await f.options.canUseTool('CronCreate',{},{})).behavior,'allow');
});

test('missing source on a later exact foreground hook preserves normal scheduling tool admission', async t => {
 let n=0;
 const f=fixture({onInput:input=>{void f.options.hooks.UserPromptSubmit[0].hooks[0]({...(n++===0?{source:'sdk'}:{}),session_id:'s',prompt:input.message.content[0].text,prompt_id:'correlation'});}});
 const host=await f.open();t.after(()=>host.close());await host.submit('first');
 assert.equal((await f.options.canUseTool('CronCreate',{},{})).behavior,'allow');
 await host.submit('second');
 assert.equal((await f.options.canUseTool('CronCreate',{},{})).behavior,'allow');
});

test('unstamped owned foreground can create a native timer only while durable tool admission remains valid', async t => {
 let allowed=true;const phases=[];
 const f=fixture({manualResults:true});const host=await f.open({authorize:async c=>{phases.push(c.phase);return c.phase!=='tool'||allowed;}});t.after(()=>host.close());
 const initialized=new Promise(r=>host.events.once('event',r));
 const running=host.submit('synthetic timer request',{id:'timer-input',source:'human'});running.catch(()=>{});await initialized;
 assert.deepEqual(await f.options.hooks.UserPromptSubmit[0].hooks[0]({session_id:'s',prompt_id:'correlation',prompt:'synthetic timer request'}),{});
 const pre=f.options.hooks.PreToolUse[0].hooks[0];
 const input={tool_name:'CronCreate',tool_use_id:'native-cron',tool_input:{cron:'* * * * *',prompt:'synthetic',recurring:false}};
 assert.deepEqual(await pre(input),{});
 assert.equal(phases.at(-1),'tool');
 allowed=false;
 assert.equal((await f.options.canUseTool('CronCreate',input.tool_input,{toolUseID:'native-cron'})).behavior,'deny','recheck ownership after cached pre-tool admission');
 assert.equal((await pre({...input,tool_use_id:'revoked'})).hookSpecificOutput.permissionDecision,'deny');
 f.output.push({type:'result',subtype:'success',session_id:'s',user_message_uuid:'timer-input'});await running;
});

for (const boundary of ['pre-tool', 'authorization', 'permission', 'post-permission']) {
 for (const replacement of ['foreground', 'another-cron']) test(`native tool ${boundary} refuses same-slot selection rotation to ${replacement}`, async t => {
  let entered, release, received;
  const waiting = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const input = new Promise(resolve => { received = resolve; });
  let checks = 0;
  const f = fixture({ manualResults: true, onInput: () => received() });
  f.transport.toolPermissionPolicy = 'ask';
  const host = await f.open({ authorize: async context => {
   if (context.phase === 'tool' && ++checks === (boundary === 'post-permission' ? 2 : 1)
     && boundary !== 'permission') { entered(); await barrier; }
   return true;
  }, permissionHandler: async () => {
   if (boundary === 'permission') { entered(); await barrier; }
   return { decision: 'allow' };
  } });
  t.after(async () => { release(); await host.close(); });
  host.submit('queued foreground', { id: 'foreground', source: 'human' }).catch(() => {}); await input;
  const emit = async id => {
   const observed = new Promise(resolve => host.events.once('command-started', resolve));
   f.output.push({ type: 'command_lifecycle', state: 'started', command_uuid: id, session_id: 's' });
   await observed;
  };
  await emit('cron-one');
  const pending = boundary === 'pre-tool'
   ? f.options.hooks.PreToolUse[0].hooks[0]({ tool_use_id: 'native-tool' })
   : f.options.canUseTool('Write', {}, { toolUseID: 'native-tool' });
  await waiting;
  await emit(replacement === 'foreground' ? 'foreground' : 'cron-two');
  release();
  const verdict = await pending;
  assert.equal(boundary === 'pre-tool' ? verdict.hookSpecificOutput?.permissionDecision : verdict.behavior, 'deny');
 });
}

test('native PreToolUse grant cannot be reused by another Cron UUID under the same queued foreground', async t => {
 let received, permissions = 0;
 const input = new Promise(resolve => { received = resolve; });
 const f = fixture({ manualResults: true, onInput: () => received() }); f.transport.toolPermissionPolicy = 'ask';
 const host = await f.open({ permissionHandler: async () => { permissions++; return { decision: 'allow' }; } });
 t.after(() => host.close());
 host.submit('queued foreground', { id: 'foreground', source: 'human' }).catch(() => {}); await input;
 const emit = async id => {
  const observed = new Promise(resolve => host.events.once('command-started', resolve));
  f.output.push({ type: 'command_lifecycle', state: 'started', command_uuid: id, session_id: 's' }); await observed;
 };
 await emit('cron-one');
 assert.deepEqual(await f.options.hooks.PreToolUse[0].hooks[0]({ tool_use_id: 'shared-tool' }), {});
 await emit('cron-two');
 assert.equal((await f.options.canUseTool('Write', {}, { toolUseID: 'shared-tool' })).behavior, 'deny');
 assert.equal(permissions, 0, 'stale native grant is rejected before invoking permission');
});

test('queued foreground arriving during native Cron permission cannot inherit the old tool grant', async t => {
 let received, entered, release;
 const input = new Promise(resolve => { received = resolve; });
 const waiting = new Promise(resolve => { entered = resolve; });
 const barrier = new Promise(resolve => { release = resolve; });
 const f = fixture({ manualResults: true, onInput: () => received() }); f.transport.toolPermissionPolicy = 'ask';
 const host = await f.open({ permissionHandler: async () => { entered(); await barrier; return { decision: 'allow' }; } });
 t.after(async () => { release(); await host.close(); });
 const boot = host.submit('boot', { id: 'boot' }); await input;
 f.output.push({ type: 'result', subtype: 'success', session_id: 's', user_message_uuid: 'boot' }); await boot;
 const observed = new Promise(resolve => host.events.once('command-started', resolve));
 f.output.push({ type: 'command_lifecycle', state: 'started', command_uuid: 'cron-one', session_id: 's' }); await observed;
 assert.deepEqual(await f.options.hooks.PreToolUse[0].hooks[0]({ tool_use_id: 'native-tool' }), {});
 const verdict = f.options.canUseTool('Write', {}, { toolUseID: 'native-tool' }); await waiting;
 host.submit('queued foreground', { id: 'foreground', source: 'human' }).catch(() => {});
 release(); assert.equal((await verdict).behavior, 'deny');
});

test('a close during query creation preserves the shutdown cause through the startup claim',async()=>{
 const diagnostics=[];const f=fixture();const query=f.transport.queryImpl;
 f.transport.queryImpl=args=>{const value=query(args);queueMicrotask(()=>f.transport.closePersistentSession(Object.assign(new Error('closed'),{sessionCloseReason:'DAEMON_SHUTDOWN'})));return value;};
 await assert.rejects(f.open({onCloseDiagnostic:value=>diagnostics.push(value)}),/abort/i);
 assert.deepEqual(diagnostics.map(x=>[x.phase,x.reasonCode]),[['requested','DAEMON_SHUTDOWN'],['completed','DAEMON_SHUTDOWN']]);
});

test('a reasonless first startup cancellation cannot be relabelled by later cleanup',async()=>{
 const diagnostics=[];const f=fixture();const query=f.transport.queryImpl;
 f.transport.queryImpl=args=>{const value=query(args);queueMicrotask(()=>{
   void f.transport.closePersistentSession();
   void f.transport.closePersistentSession(Object.assign(new Error('later cleanup'),{sessionCloseReason:'DAEMON_SHUTDOWN'}));
 });return value;};
 await assert.rejects(f.open({onCloseDiagnostic:value=>diagnostics.push(value)}),/abort/i);
 assert.deepEqual(diagnostics.map(x=>[x.phase,x.reasonCode]),[['requested','STARTUP_ABORTED'],['completed','STARTUP_ABORTED']]);
});
