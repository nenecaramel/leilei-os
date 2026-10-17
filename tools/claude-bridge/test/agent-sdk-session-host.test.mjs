import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentSdkSessionHost } from '../src/agent-sdk-session-host.mjs';
function queue(){const values=[];let waiter;let ended=false;return {push(v){if(waiter){const w=waiter;waiter=null;w({value:v,done:false});}else values.push(v);},end(){ended=true;waiter?.({done:true});},[Symbol.asyncIterator](){return {next(){return values.length?Promise.resolve({value:values.shift(),done:false}):ended?Promise.resolve({done:true}):new Promise(r=>{waiter=r;});}};}};}
async function fixture(options={}){
 const output=queue(),inputs=[];let calls=0,closed=0,interrupts=0;const stopped=[];
 const host=await createAgentSdkSessionHost({queryOptions:{perTaskStopAffordance:true,...options},queryImpl:({prompt})=>{
 calls++;(async()=>{for await(const input of prompt)inputs.push(input);})();
 return {async *[Symbol.asyncIterator](){yield* output;},close(){closed++;output.end();},async interrupt(){interrupts++;return {still_queued:[]};},async stopTask(id){stopped.push(id);}};
 }});
 const event=(value)=>new Promise(resolve=>{host.events.once('event',resolve);output.push(value);});
 await event({type:'system',subtype:'init',session_id:'s'});
 return {host,inputs,stopped,event,output,get calls(){return calls;},get closed(){return closed;},get interrupts(){return interrupts;}};
}
const result=()=>({type:'result',subtype:'success',session_id:'s',result:'synthetic'});
const tasks=(run='r2')=>({type:'system',subtype:'background_tasks_changed',session_id:'s',tasks:[{task_id:'task',run_id:run,status:'running'}]});
test('two turns use one query/session, with background events delivered during idle',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const first=f.host.submit('first',{id:'one'});await f.event(tasks());await f.event({...result(),user_message_uuid:f.host.active?.id});assert.equal((await first).providerSessionId,'s');assert.equal(f.host.state,'idle');
 await f.event({type:'system',subtype:'task_progress',session_id:'s',task_id:'task'});
 const second=f.host.submit('second',{id:'two'});await f.event({...result(),user_message_uuid:f.host.active?.id});assert.equal((await second).providerSessionId,'s');assert.equal(f.calls,1);assert.equal(f.closed,0);assert.equal(f.inputs.length,2);assert.equal(f.host.tasks.size,1);
});
test('concurrent user/wake requests serialize and duplicate ids reject',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const one=f.host.submit('user',{id:'one'}),two=f.host.submit('wake',{id:'two'});await assert.rejects(f.host.submit('duplicate',{id:'two'}),/duplicate/i);await f.event({...result(),user_message_uuid:f.host.active?.id});await one;await f.event({...result(),user_message_uuid:f.host.active?.id});await two;assert.deepEqual(f.inputs.map(x=>x.uuid),['one','two']);
});
test('interrupt and stopTask do not close the session; stop state waits for notification',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const turn=f.host.submit('synthetic');await f.event(tasks());await f.host.interruptTurn();assert.equal(f.interrupts,1);await f.host.stopTask('task');assert.deepEqual(f.stopped,['task']);assert.equal(f.host.tasks.size,1);await f.event({type:'system',subtype:'task_notification',session_id:'s',task_id:'task',run_id:'r2',status:'stopped'});assert.equal(f.host.tasks.size,1);await f.event({...tasks(),tasks:[]});assert.equal(f.host.tasks.size,0);await f.event({...result(),user_message_uuid:f.host.active?.id});await turn;assert.equal(f.closed,0);
});
test('late task notifications do not remove a newer run',async t=>{
 const f=await fixture();t.after(()=>f.host.close());await f.event(tasks('r2'));await f.event({type:'system',subtype:'task_notification',session_id:'s',task_id:'task',run_id:'r1',status:'completed'});assert.equal(f.host.tasks.size,1);
});
test('foreign-session output fails pending turns without replay',async()=>{
 const f=await fixture();const pending=f.host.submit('synthetic');const rejected=assert.rejects(pending,/session/i);f.output.push({type:'result',subtype:'success',session_id:'foreign'});await rejected;await assert.rejects(f.host.completion,/session/i);assert.equal(f.calls,1);assert.equal(f.closed,1);
});
test('process exit rejects active and queued work without retrying it',async()=>{
 const f=await fixture();const one=assert.rejects(f.host.submit('one'),/ended/i),two=assert.rejects(f.host.submit('two'),/ended/i);f.output.end();await Promise.all([one,two]);await assert.rejects(f.host.completion,/ended/i);assert.equal(f.calls,1);
});
test('without per-task UI, foreground interrupt stops the session and reports unresolved background tasks truthfully',async t=>{
 const f=await fixture({perTaskStopAffordance:false});t.after(()=>f.host.close());const turn=f.host.submit('synthetic');const interrupted=assert.rejects(turn,error=>error.runtimeCode==='INTERRUPTED');interrupted.catch(()=>{});await f.event(tasks());
 const receipt=await f.host.interruptTurn();await interrupted;await f.host.completion;
 assert.equal(receipt.session_closed,true);assert.deepEqual(receipt.still_queued,[]);assert.deepEqual(receipt.background_tasks,[{id:'task',status:'unknown'}]);assert.deepEqual(f.stopped,['task']);assert.equal(f.closed,1);assert.equal(f.interrupts,0);
});

test('native command start correlates exact CLI input UUID before provider output, not prompts or guesses',async t=>{
  const f=await fixture();t.after(()=>f.host.close());
  const started=[];
  f.host.events.on('command-started',frame=>started.push(frame));
  const foreground=f.host.submit('same text',{id:'owned-command'});
  await f.event({type:'command_lifecycle',state:'queued',command_uuid:'scheduled-command',session_id:'s'});
  assert.equal(started.length,0);
  await f.event({type:'command_lifecycle',state:'started',command_uuid:'scheduled-command',session_id:'s'});
  assert.deepEqual(started,[{inputId:'scheduled-command',source:'autonomous'}]);
  await f.event({type:'command_lifecycle',state:'started',command_uuid:'scheduled-command',session_id:'s'});
  assert.equal(started.length,1,'replayed start must not rebind the same native input');
  await f.event({type:'command_lifecycle',state:'started',command_uuid:'owned-command',session_id:'s'});
  assert.deepEqual(started.at(-1),{inputId:'owned-command',source:'foreground'});
  await f.event({type:'command_lifecycle',state:'started',command_uuid:'',session_id:'s'});
  await f.event({type:'command_lifecycle',state:'completed',command_uuid:'scheduled-command',session_id:'s'});
  assert.equal(started.length,2,'invalid or terminal lifecycle cannot bind another input');
  await f.event({...result(),user_message_uuid:'owned-command'});
  await foreground;
});

test('autonomous result during idle remains a session event',async t=>{
 const f=await fixture();t.after(()=>f.host.close());await Promise.race([f.event({...result(),user_message_uuid:'autonomous'}),f.host.completion.catch(()=>null)]);assert.equal(f.host.state,'idle');assert.equal(f.closed,0);
});
test('autonomous result cannot resolve a concurrently submitted user turn',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const pending=f.host.submit('user',{id:'owned'});
 await f.event({...result(),user_message_uuid:'autonomous'});assert.equal(f.host.state,'running');
 await f.event({...result(),user_message_uuids:['owned']});assert.equal((await pending).inputId,'owned');
});
test('initial input can trigger init instead of waiting for unsolicited startup init',async t=>{
 const host=await createAgentSdkSessionHost({queryImpl:({prompt})=>({close(){},async *[Symbol.asyncIterator](){for await(const input of prompt){yield {type:'system',subtype:'init',session_id:'s'};yield {...result(),user_message_uuid:input.uuid};}}})});
 t.after(()=>host.close());assert.equal(host.active,null);const pending=host.submit('first',{id:'boot'});pending.catch(()=>{});assert.equal(host.active?.id,'boot');assert.equal((await pending).providerSessionId,'s');
});

test('autonomous assistant content is not included in the submitted user result',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const pending=f.host.submit('user',{id:'owned'});
 await f.event({type:'assistant',session_id:'s',message:{content:[{type:'text',text:'background-only'}]}});
 await f.event({...result(),user_message_uuid:'background'});
 await f.event({type:'assistant',session_id:'s',message:{content:[{type:'text',text:'user-only'}]}});
 await f.event({...result(),user_message_uuid:'owned'});
 const owned=await pending;assert.equal(JSON.stringify(owned.events).includes('background-only'),false);
 assert.equal(JSON.stringify(owned.events).includes('user-only'),true);
});

// Live output belongs to a turn only once the SDK stamps that turn's input UUID.
const stamped=(id,text)=>({type:'stream_event',session_id:'s',parent_tool_use_id:null,user_message_uuid:id,user_message_uuids:[id],event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text}}});
const delta=(text)=>({type:'stream_event',session_id:'s',parent_tool_use_id:null,event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text}}});
const said=(text)=>({type:'assistant',session_id:'s',parent_tool_use_id:null,message:{content:[{type:'text',text}]}});
const texts=events=>JSON.stringify(events);
test('a stamped turn streams normalized events live and returns exactly what it streamed',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const live=[];
 const pending=f.host.submit('user',{id:'owned',onNormalizedEvent:e=>{live.push(e);}});
 await f.event(stamped('owned','hel'));await f.event(delta('lo'));await f.event(said('hello'));
 assert.equal(f.host.ownedInputId(),'owned');
 await f.event({...result(),user_message_uuid:'owned'});
 const owned=await pending;
 assert.ok(live.length>=3);assert.deepEqual(owned.normalizedEvents.map(e=>e.event_id),live.map(e=>e.event_id));
 assert.ok(texts(live).includes('hel')&&texts(live).includes('hello'));assert.equal(f.host.ownedInputId(),null);
});
test('background work before the turn is neither streamed to it nor returned with it',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const live=[];const background=[];
 f.host.events.on('background-result',frame=>background.push(frame));
 const pending=f.host.submit('user',{id:'owned',onNormalizedEvent:e=>{live.push(e);}});
 await f.event(delta('bg'));await f.event(said('background-only'));assert.equal(f.host.ownedInputId(),null);
 await f.event({...result(),user_message_uuid:'other'});
 assert.equal(live.length,0);assert.ok(texts(background[0].normalizedEvents).includes('background-only'));
 await f.event(stamped('owned','mine'));await f.event({...result(),user_message_uuid:'owned'});
 const owned=await pending;assert.ok(texts(live).includes('mine'));assert.equal(texts(owned.normalizedEvents).includes('background-only'),false);
});
test('a background turn that folds the queued input streams only from the fold onward',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const live=[];
 const pending=f.host.submit('user',{id:'owned',onNormalizedEvent:e=>{live.push(e);}});
 await f.event(said('before-fold'));await f.event(stamped('owned','after-fold'));
 await f.event({...result(),user_message_uuid:'owned',user_message_uuids:['owned']});
 const owned=await pending;assert.equal(texts(live).includes('before-fold'),false);assert.ok(texts(live).includes('after-fold'));
 assert.equal(texts(owned.normalizedEvents).includes('before-fold'),false);
});
test('tool images are forwarded only for the owning turn',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const images=[];
 const image=(id)=>({type:'user',session_id:'s',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:id,content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'aGk='}}]}]}});
 const pending=f.host.submit('user',{id:'owned',toolImageHandler:async input=>{images.push(input.mimeType);}});
 await f.event(said('background'));await f.event(image('bg'));await f.event({...result(),user_message_uuid:'other'});
 assert.equal(images.length,0);
 await f.event(stamped('owned','x'));await f.event(image('mine'));await f.event({...result(),user_message_uuid:'owned'});
 await pending;assert.deepEqual(images,['image/png']);
});
test('an unstamped frame that the result assigns to the turn is returned whole, not streamed early',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const live=[];
 const pending=f.host.submit('user',{id:'owned',onNormalizedEvent:e=>{live.push(e);}});
 await f.event(said('older-producer'));await f.event({...result(),user_message_uuid:'owned'});
 const owned=await pending;assert.equal(live.length,0);assert.ok(texts(owned.normalizedEvents).includes('older-producer'));
 assert.equal(owned.normalizedEvents.filter(e=>e.payload?.kind==='result'||e.type==='result').length<=1,true);
});

test('foreign result cannot steal stamped foreground output or its durable normalized events',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const live=[],background=[];
 f.host.events.on('background-result',frame=>background.push(frame));
 const pending=f.host.submit('user',{id:'owned',onNormalizedEvent:e=>{live.push(e);}});
 await f.event(stamped('owned','foreground-before'));
 await f.event({...result(),user_message_uuid:'other'});
 assert.equal(background.length,1);
 assert.equal(texts(background[0].normalizedEvents).includes('foreground-before'),false);
 assert.equal(texts(background[0].events).includes('foreground-before'),false);
 // After a foreign result boundary, a fresh SDK reply stamp reclaims the turn.
 await f.event(stamped('owned','foreground-after'));
 await f.event({...result(),user_message_uuid:'owned'});
 const owned=await pending;
 assert.deepEqual(owned.normalizedEvents.map(e=>e.event_id),live.map(e=>e.event_id));
 assert.ok(texts(owned.normalizedEvents).includes('foreground-before'));
 assert.ok(texts(owned.normalizedEvents).includes('foreground-after'));
 assert.equal(texts(owned.events).includes('foreground-before'),true);
 assert.equal(texts(owned.events).includes('foreground-after'),true);
});
test('an unrelated stamped reply and result cannot be streamed to the active user turn',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const live=[],background=[];
 f.host.events.on('background-result',frame=>background.push(frame));
 const pending=f.host.submit('user',{id:'owned',onNormalizedEvent:e=>{live.push(e);}});
 await f.event(stamped('owned','my-first'));
 await f.event(stamped('another','their-output'));
 await f.event({...result(),user_message_uuid:'another'});
 await f.event(stamped('owned','my-second'));
 await f.event({...result(),user_message_uuid:'owned'});
 const owned=await pending;
 assert.ok(texts(owned.normalizedEvents).includes('my-first'));
 assert.ok(texts(owned.normalizedEvents).includes('my-second'));
 assert.equal(texts(owned.normalizedEvents).includes('their-output'),false);
 assert.equal(texts(live).includes('their-output'),false);
 assert.ok(texts(background[0].normalizedEvents).includes('their-output'));
 assert.deepEqual(owned.normalizedEvents.map(e=>e.event_id),live.map(e=>e.event_id));
});
test('normalized task and compaction system events retain explicit background/foreground ownership',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const live=[],background=[];
 f.host.events.on('background-result',frame=>background.push(frame));
 const pending=f.host.submit('user',{id:'owned',onNormalizedEvent:e=>{live.push(e);}});
 await f.event({type:'system',subtype:'task_progress',session_id:'s',task_id:'background-task',summary:'before-stamp'});
 await f.event({...result(),user_message_uuid:'other'});
 await f.event(stamped('owned','answer'));
 await f.event({type:'system',subtype:'task_progress',session_id:'s',task_id:'owned-task',summary:'after-stamp'});
 await f.event({type:'system',subtype:'compact_boundary',session_id:'s',compact_metadata:{trigger:'auto'}});
 await f.event({...result(),user_message_uuid:'owned'});
 const owned=await pending;
 assert.ok(texts(background[0].normalizedEvents).includes('before-stamp'));
 assert.equal(texts(owned.normalizedEvents).includes('before-stamp'),false);
 assert.ok(texts(owned.normalizedEvents).includes('after-stamp'));
 assert.ok(owned.normalizedEvents.some(e=>e.type==='compaction'));
 assert.deepEqual(owned.normalizedEvents.map(e=>e.event_id),live.map(e=>e.event_id));
});
test('user echoes and ping stamps do not authorize an unstamped assistant reply to stream early',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const live=[];
 const pending=f.host.submit('user',{id:'owned',onNormalizedEvent:e=>{live.push(e);}});
 await f.event({type:'user',session_id:'s',user_message_uuid:'owned',message:{role:'user',content:[{type:'text',text:'echo'}]}});
 await f.event({type:'stream_event',session_id:'s',user_message_uuid:'owned',event:{type:'ping'}});
 await f.event(said('older-producer'));
 assert.equal(f.host.ownedInputId(),null);
 await f.event({...result(),user_message_uuid:'owned'});
 const owned=await pending;
 assert.equal(live.length,0);
 assert.ok(texts(owned.normalizedEvents).includes('older-producer'));
});

test('mid-turn input joins the active logical turn and waits for every accepted command result',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const live=[];
 const turn=f.host.submit('first',{id:'first',onNormalizedEvent:e=>live.push(e)});let settled=false;turn.then(()=>settled=true,()=>settled=true);
 assert.deepEqual(await f.host.sendUserMessage('follow-up',{uuid:'follow-up'}),{status:'queued',command_uuid:'follow-up'});
 await f.event(stamped('first','first-output'));await f.event({...result(),user_message_uuid:'first'});
 assert.equal(settled,false,'the accepted follow-up must not be lost at the first result');
 await f.event(stamped('follow-up','follow-up-output'));await f.event({...result(),user_message_uuid:'follow-up'});
 const done=await turn;assert.equal(done.inputId,'first');assert.ok(texts(done.normalizedEvents).includes('first-output'));assert.ok(texts(done.normalizedEvents).includes('follow-up-output'));assert.deepEqual(f.inputs.map(x=>x.uuid),['first','follow-up']);assert.equal(f.closed,0);
});
test('folded result can consume multiple accepted inputs without a duplicate submission',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const turn=f.host.submit('first',{id:'first'});turn.catch(()=>{});
 await f.host.sendUserMessage('follow-up',{uuid:'follow-up'});
 await assert.rejects(f.host.sendUserMessage('duplicate',{uuid:'follow-up'}),/duplicate/i);
 await f.event({...result(),user_message_uuid:'first',user_message_uuids:['first','follow-up']});await turn;assert.equal(f.inputs.length,2);
});

test('supplemental input cannot cross a turn boundary during asynchronous authorization',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const turn=f.host.submit('first',{id:'first'});let release;f.host.beforeSubmit=()=>new Promise(r=>release=r);
 const pending=f.host.sendUserMessage('late',{uuid:'late'});pending.catch(()=>{});
 await f.event({...result(),user_message_uuid:'first'});await turn;release();await assert.rejects(pending,/ownership changed/i);assert.deepEqual(f.inputs.map(x=>x.uuid),['first']);
});
test('interrupt receipts ignore SDK-internal cron ids without claiming them as user input; duplicates still reject',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const turn=f.host.submit('first',{id:'first'});turn.catch(()=>{});
 f.host.query.interrupt=async()=>({still_queued:['sdk-scheduled','first']});assert.deepEqual(await f.host.interruptTurn(),{still_queued:['first']});
 f.host.query.interrupt=async()=>({still_queued:['first','first']});await assert.rejects(f.host.interruptTurn(),/queued/i);
 await f.event({...result(),user_message_uuid:'first'});await turn;
});

function barrier(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
test('background acknowledgement does not block SDK task membership and progress consumption',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const entered=barrier(),release=barrier();t.after(()=>release.resolve());
 f.host.onBackgroundResult=async()=>{entered.resolve();await release.promise;};
 f.output.push({...result(),user_message_uuid:'autonomous'});await entered.promise;
 let seen=false;const update=f.event(tasks()).then(()=>{seen=true;});await new Promise(setImmediate);
 const visibleBeforeAck=seen;release.resolve();await update;
 assert.equal(visibleBeforeAck,true);assert.equal(f.host.tasks.size,1);
});
test('new input remains gated while task events keep flowing behind an uncommitted background frame',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const entered=barrier(),release=barrier();t.after(()=>release.resolve());
 f.host.onBackgroundResult=async()=>{entered.resolve();await release.promise;};
 f.output.push({...result(),user_message_uuid:'autonomous'});await entered.promise;
 const pending=f.host.submit('next',{id:'next'});pending.catch(()=>{});
 let seen=false;const update=f.event(tasks()).then(()=>{seen=true;});await new Promise(setImmediate);
 const before={seen,inputs:f.inputs.length};release.resolve();await update;
 // A deterministic task update proves the reader has resumed; the existing
 // input queue is released by the acknowledgement rather than another wake.
 await new Promise(setImmediate);assert.deepEqual(before,{seen:true,inputs:0});assert.equal(f.inputs.length,1);
 await f.event({...result(),user_message_uuid:'next'});await pending;
});
test('background sinks register in SDK frame order even while the first commit is pending',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const entered=barrier(),release=barrier();t.after(()=>release.resolve());const order=[];
 f.host.onBackgroundResult=frame=>{order.push(frame.result.user_message_uuid);if(order.length===1)entered.resolve();return release.promise;};
 f.output.push({...result(),user_message_uuid:'background-one'});await entered.promise;
 f.output.push({...result(),user_message_uuid:'background-two'});await new Promise(setImmediate);
 const registered=[...order];release.resolve();await new Promise(setImmediate);
 assert.deepEqual(registered,['background-one','background-two']);
});
test('asynchronous background commit failure rejects waiting input and closes without execution replay',async t=>{
 const f=await fixture();t.after(()=>f.host.close());const entered=barrier();let reject;
 f.host.onBackgroundResult=()=>{entered.resolve();return new Promise((_,no)=>{reject=no;});};
 f.output.push({...result(),user_message_uuid:'background'});await entered.promise;
 const pending=assert.rejects(f.host.submit('next',{id:'next'}),/synthetic commit failed/);
 const failed=assert.rejects(f.host.completion,/synthetic commit failed/);
 reject(new Error('synthetic commit failed'));await Promise.all([pending,failed]);
 assert.equal(f.closed,1);assert.equal(f.inputs.length,0);
});
