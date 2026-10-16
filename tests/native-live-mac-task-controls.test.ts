import assert from "node:assert/strict";
import test from "node:test";
import { executeNativeLiveMacTaskControl } from "../src/domains/bridge/mac/native-live-mac-task-controls.js";
import type { NativeLiveMacSessionRegistry } from "../src/domains/bridge/mac/native-live-mac-session-registry.js";
const deferred=()=>{let resolve!:(value:unknown)=>void;const promise=new Promise(resolve_=>{resolve=resolve_;});return {promise,resolve};};
function fixture(){
  const gate=deferred();let live=true,calls=0;
  const binding={conversationId:"conversation",generationId:"generation",session:{sessionId:"session",listTasks:()=>[{taskId:"sdk-task",handle:"opaque",status:"running",active:true}],readTaskOutput:async()=>{calls++;return await gate.promise;},stopTask:async(id:string,expected:{handle:string})=>{calls++;assert.equal(id,"sdk-task");assert.equal(expected.handle,"opaque");return {accepted:true};}}};
  const registry={get:()=>live?binding:null} as unknown as NativeLiveMacSessionRegistry;
  const control={controlId:"control",prepareId:"source",payload:{action:"list",conversationId:"conversation",providerSessionId:"session",generationId:"generation"}};
  return {registry,control,gate,retire:()=>{live=false;},calls:()=>calls};
}
test("background task list does not submit a prompt and stop uses the opaque handle",async()=>{
 const f=fixture();assert.deepEqual(await executeNativeLiveMacTaskControl(f.registry,f.control,new AbortController().signal),{generationId:"generation",tasks:[{taskId:"sdk-task",handle:"opaque",status:"running",active:true,description:null,summary:null}]});
 assert.deepEqual(await executeNativeLiveMacTaskControl(f.registry,{...f.control,payload:{...f.control.payload,action:"stop",taskId:"sdk-task",handle:"opaque"}},new AbortController().signal),{generationId:"generation",accepted:true});assert.equal(f.calls(),1);
});
test("a read response arriving after Rewind or handoff is discarded",async()=>{
 const f=fixture();const read=executeNativeLiveMacTaskControl(f.registry,{...f.control,payload:{...f.control.payload,action:"output",taskId:"sdk-task",handle:"opaque"}},new AbortController().signal);
 f.retire();f.gate.resolve({output:"synthetic",totalBytes:9,truncated:false});await assert.rejects(read,/retired/);assert.equal(f.calls(),1);
});
test("task control rejects another session or generation before calling SDK",async()=>{
 const f=fixture();await assert.rejects(executeNativeLiveMacTaskControl(f.registry,{...f.control,payload:{...f.control.payload,providerSessionId:"other"}},new AbortController().signal));assert.equal(f.calls(),0);
});

test("lost task completion acknowledgement never repeats the SDK command",async()=>{
 const {runNativeLiveMacTaskControls}=await import("../src/domains/bridge/mac/native-live-mac-task-controls.js");
 const f=fixture(),cancel=new AbortController();let waits=0,completions=0;
 const first=f.control.payload;
 const registry={...f.registry,snapshot:()=>[{conversationId:"conversation",generationId:"generation",session:{sessionId:"session"}}]};
 await runNativeLiveMacTaskControls({registry:registry as unknown as NativeLiveMacSessionRegistry,signal:cancel.signal,listenerInstanceId:"listener",relay:{
   async waitTaskControl(){waits++;if(waits>1){cancel.abort();return null;}return {...f.control,payload:{...first,action:"stop",taskId:"sdk-task",handle:"opaque"}};},
   async completeRuntimeControl(){completions++;throw Error("response lost");}
 }});
 assert.equal(f.calls(),1);assert.equal(completions,1);assert.equal(waits,2);
});
