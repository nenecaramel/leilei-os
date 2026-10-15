import assert from "node:assert/strict";
import test from "node:test";
import { drainNativeLiveMacSession } from "../src/domains/bridge/mac/native-live-mac-session-drain.js";
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
test("handoff fences inputs first, stops tasks, closes the writer and waits for its actual stream completion",async()=>{
 const done=deferred(),calls:string[]=[];const tasks=new Map([["task-a",{}]]);
 const running=drainNativeLiveMacSession({session:{tasks,async stopTask(id:string){calls.push(`stop:${id}`);tasks.delete(id);},completion:done.promise},
  fence(){calls.push("fence");},async close(){calls.push("close");},async settle(){calls.push("settle");},timeoutMs:1000});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,["fence","stop:task-a","close"]);
 let finished=false;void running.then(()=>finished=true);await Promise.resolve();assert.equal(finished,false);
 done.resolve();const report=await running;assert.equal(report.ready,true);assert.deepEqual(report.tasks,[{id:"task-a",status:"stopped"}]);assert.deepEqual(calls,["fence","stop:task-a","close","settle"]);
});
test("a stop RPC without an authoritative task removal never claims stopped or allows handoff",async()=>{
 const report=await drainNativeLiveMacSession({session:{tasks:new Map([["task-a",{}]]),async stopTask(){},completion:Promise.resolve()},fence(){},async close(){},async settle(){},timeoutMs:20});
 assert.equal(report.ready,false);assert.deepEqual(report.tasks,[{id:"task-a",status:"unknown"}]);
});
test("failed close and unacknowledged delivery are reported unknown",async()=>{
 for(const phase of ["close","settle"]){const report=await drainNativeLiveMacSession({session:{tasks:new Map(),async stopTask(){},completion:Promise.resolve()},fence(){},async close(){if(phase==="close")throw new Error("failed");},async settle(){if(phase==="settle")throw new Error("lost response");},timeoutMs:100});assert.equal(report.ready,false);}
});

test("tasks discovered while stopping the initial snapshot prevent a ready handoff",async()=>{
 const tasks=new Map([["initial",{}]]);
 const report=await drainNativeLiveMacSession({session:{tasks,async stopTask(id:string){tasks.delete(id);tasks.set("new-in-flight",{});},completion:Promise.resolve()},fence(){},async close(){},async settle(){},timeoutMs:20});
 assert.equal(report.ready,false);assert.ok(report.tasks.some(task=>task.id==="new-in-flight"&&task.status==="unknown"));
});
