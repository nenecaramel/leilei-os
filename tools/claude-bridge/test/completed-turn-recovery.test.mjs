import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverCompletedNativeTurn } from '../src/completed-turn-recovery.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const session=id(1), input=id(3), parent=id(2), checkpoint=id(4);
const entries=()=>[
 {type:'assistant',uuid:parent,parentUuid:null,sessionId:session,message:{content:[{type:'text',text:'old'}],stop_reason:'end_turn'}},
 {type:'user',uuid:input,parentUuid:parent,sessionId:session,message:{role:'user',content:[{type:'text',text:'synthetic input'}]}},
 {type:'assistant',uuid:checkpoint,parentUuid:input,sessionId:session,message:{role:'assistant',content:[{type:'text',text:'synthetic complete reply'}],stop_reason:'end_turn'}},
];
const read=e=>recoverCompletedNativeTurn({entries:e,sessionId:session,inputId:input,parentCheckpointId:parent});
test('recover exact completed native input without model replay or other turn text',()=>{
 const r=read(entries());assert.equal(r.providerCheckpointId,checkpoint);assert.equal(r.result.inputId,input);
 assert.equal(r.result.providerSessionId,session);assert.deepEqual(r.result.normalizedEvents.filter(e=>e.type==='text').map(e=>e.payload.text),['synthetic complete reply']);
});
for(const mode of ['partial','tool','wrong-input','foreign-session','new-user','sidechain','duplicate','cycle','missing-parent','wrong-parent','oversize'])test(`completed recovery refuses ${mode}`,()=>{
 const e=entries();let options={};
 if(mode==='partial')e[2].message.stop_reason=null;
 if(mode==='tool')e[2].message.content=[{type:'tool_use',id:'call'}];
 if(mode==='wrong-input')e[1].uuid=id(8);
 if(mode==='foreign-session')e[2].sessionId=id(8);
 if(mode==='new-user')e.push({type:'user',uuid:id(8),parentUuid:checkpoint,sessionId:session,message:{content:'other'}});
 if(mode==='sidechain')e[2].isSidechain=true;
 if(mode==='duplicate')e.push({...e[2]});
 if(mode==='cycle')e[1].parentUuid=checkpoint;
 if(mode==='missing-parent')e[1].parentUuid=id(8);
 if(mode==='wrong-parent')options.parentCheckpointId=id(8);
 if(mode==='oversize')e[2].message.content[0].text='x'.repeat(2*1024*1024);
 assert.equal(recoverCompletedNativeTurn({entries:e,sessionId:session,inputId:input,parentCheckpointId:parent,...options}),null);
});
test('tool output and unrelated same-text branches never become the recovered response',()=>{
 const e=entries();e.splice(2,0,{type:'assistant',uuid:id(6),parentUuid:input,sessionId:session,message:{content:[{type:'tool_use',id:'t',name:'Bash',input:{}}],stop_reason:'tool_use'}},
 {type:'user',uuid:id(7),parentUuid:id(6),sessionId:session,message:{content:[{type:'tool_result',tool_use_id:'t',content:'synthetic tool'}]}});
 e.at(-1).parentUuid=id(7);
 const r=read(e);assert.ok(r);assert.equal(r.providerCheckpointId,checkpoint);
});
for (const mode of ['blocked-stop','unknown-tail','second-input','sidechain-collision','unanswered-tool']) test(`completed recovery handles ambiguous ${mode}`,()=>{
 const e=entries();
 if(mode==='blocked-stop')e.push({type:'system',subtype:'stop_hook_summary',uuid:id(9),parentUuid:checkpoint,sessionId:session,preventedContinuation:true});
 if(mode==='unknown-tail')e.push({type:'attachment',uuid:id(9),parentUuid:checkpoint,sessionId:session,attachment:{type:'unknown'}});
 if(mode==='second-input'){e.splice(2,0,{type:'user',uuid:id(9),parentUuid:input,sessionId:session,message:{content:'same text'}});e.at(-1).parentUuid=id(9);}
 if(mode==='sidechain-collision'){e.push({...e[2],isSidechain:true});}
 if(mode==='unanswered-tool'){e[2].message.content.unshift({type:'tool_use',id:'pending'});}
 const r=read(e);if(mode==='sidechain-collision')assert.ok(r);else assert.equal(r,null);
});

test('native null stop_reason needs a clean durable Stop on the exact branch',()=>{
 const e=entries();e[2].message.stop_reason=null;e.push({type:'system',subtype:'stop_hook_summary',uuid:id(9),parentUuid:checkpoint,sessionId:session,preventedContinuation:false,hookErrors:[]});assert.ok(read(e));
 e.at(-1).hookErrors=['synthetic failure'];assert.equal(read(e),null);
});
test('native prior Stop trailers can join the exact committed checkpoint to the owned input',()=>{
 const e=entries();e.splice(1,0,{type:'system',subtype:'stop_hook_summary',uuid:id(9),parentUuid:parent,sessionId:session,preventedContinuation:false});e[2].parentUuid=id(9);assert.ok(read(e));e[1].preventedContinuation=true;assert.equal(read(e),null);
});
test('a missing tool result cannot masquerade as complete native output',()=>{
 const e=entries();e.splice(2,0,{type:'assistant',uuid:id(9),parentUuid:input,sessionId:session,message:{content:[{type:'tool_use',id:'missing'}],stop_reason:'tool_use'}});e.at(-1).parentUuid=id(9);assert.equal(read(e),null);
});

test('parallel tool results retain the uniquely verified sibling response within this input',()=>{
 const e=entries(),callA=id(6),callB=id(7),resultA=id(8),resultB=id(9);
 e.splice(2,0,{type:'assistant',uuid:callA,parentUuid:input,sessionId:session,message:{content:[{type:'tool_use',id:'a',name:'Bash',input:{}}],stop_reason:'tool_use'}},
 {type:'assistant',uuid:callB,parentUuid:callA,sessionId:session,message:{content:[{type:'tool_use',id:'b',name:'Bash',input:{}}],stop_reason:'tool_use'}},
 {type:'user',uuid:resultA,parentUuid:callA,sessionId:session,message:{content:[{type:'tool_result',tool_use_id:'a',content:'synthetic A'}]}},
 {type:'user',uuid:resultB,parentUuid:callB,sessionId:session,message:{content:[{type:'tool_result',tool_use_id:'b',content:'synthetic B'}]}});
 e.at(-1).parentUuid=resultB;
 const r=read(e);assert.ok(r);assert.deepEqual(r.result.events.filter(e=>e.type==='user').map(e=>e.uuid),[resultA,resultB]);
});

test('bounded recovery does not reject a short current reply because older history exceeds two MiB',()=>{
 const e=entries();e[0].message.content[0].text='x'.repeat(3*1024*1024);assert.ok(read(e));
});
