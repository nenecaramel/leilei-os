import assert from "node:assert/strict";
import test from "node:test";
import { NativeLiveMacExecutionLease } from "../src/domains/bridge/mac/native-live-mac-execution-lease.js";
function fixture(){let next=0,renewals=0,revocations=0;const timers=new Map<number,()=>Promise<void>>();let response=async()=>true;
 const lease=new NativeLiveMacExecutionLease({renew:()=>{renewals++;return response();},onRevoked:async()=>{revocations++;},scheduler:{schedule(work,delay){assert.equal(delay,20000);timers.set(++next,work);return next;},cancel(token){timers.delete(token as number);}}});
 return {lease,timers,get renewals(){return renewals;},get revocations(){return revocations;},respond(fn:()=>Promise<boolean>){response=fn;},async tick(){const [key,work]=timers.entries().next().value!;timers.delete(key);await work();}};
}
test("execution heartbeat renews before work and serially every twenty seconds",async()=>{const f=fixture();await f.lease.start();assert.equal(f.renewals,1);assert.equal(f.timers.size,1);await f.tick();assert.equal(f.renewals,2);assert.equal(f.timers.size,1);f.lease.stop();assert.equal(f.timers.size,0);});
test("denied or failed renewal revokes the writer once without reacquiring a lease",async()=>{for(const failed of [false,true]){const f=fixture();await f.lease.start();f.respond(async()=>{if(failed)throw Error("synthetic network failure");return false;});await f.tick();assert.equal(f.revocations,1);assert.equal(f.timers.size,0);assert.equal(f.renewals,2);}});
test("late heartbeat response after stop cannot revoke or re-arm a newer turn",async()=>{const f=fixture();await f.lease.start();let resolve!:(value:boolean)=>void;f.respond(()=>new Promise(r=>resolve=r));const pending=f.tick();f.lease.stop();resolve(false);await pending;assert.equal(f.revocations,0);assert.equal(f.timers.size,0);});
test("initial denial refuses provider work",async()=>{const f=fixture();f.respond(async()=>false);await assert.rejects(f.lease.start());assert.equal(f.revocations,1);assert.equal(f.timers.size,0);});
