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
test('without actual per-task stop capability declaration, interrupt refuses to strand background work',async t=>{
 const f=await fixture({perTaskStopAffordance:false});t.after(()=>f.host.close());const turn=f.host.submit('synthetic');await f.event(tasks());await assert.rejects(f.host.interruptTurn(),/stop/i);assert.equal(f.interrupts,0);await f.event({...result(),user_message_uuid:f.host.active?.id});await turn;
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
