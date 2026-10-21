import assert from "node:assert/strict";
import test from "node:test";
import { createConservativeLeaseClock, NativeLiveMacExecutionLease } from "../src/domains/bridge/mac/native-live-mac-execution-lease.js";
function fixture(){let next=0,renewals=0,revocations=0;const timers=new Map<number,()=>Promise<void>>();let response=async()=>true;
 const lease=new NativeLiveMacExecutionLease({renew:()=>{renewals++;return response();},onRevoked:async()=>{revocations++;},scheduler:{schedule(work,delay){assert.equal(delay,20000);timers.set(++next,work);return next;},cancel(token){timers.delete(token as number);}}});
 return {lease,timers,get renewals(){return renewals;},get revocations(){return revocations;},respond(fn:()=>Promise<boolean>){response=fn;},async tick(){const [key,work]=timers.entries().next().value!;timers.delete(key);await work();}};
}
test("execution heartbeat renews before work and serially every twenty seconds",async()=>{const f=fixture();await f.lease.start();assert.equal(f.renewals,1);assert.equal(f.timers.size,1);await f.tick();assert.equal(f.renewals,2);assert.equal(f.timers.size,1);f.lease.stop();assert.equal(f.timers.size,0);});
test("denied or failed renewal revokes the writer once without reacquiring a lease",async()=>{for(const failed of [false,true]){const f=fixture();await f.lease.start();f.respond(async()=>{if(failed)throw Error("synthetic network failure");return false;});await f.tick();assert.equal(f.revocations,1);assert.equal(f.timers.size,0);assert.equal(f.renewals,2);}});
test("late heartbeat response after stop cannot revoke or re-arm a newer turn",async()=>{const f=fixture();await f.lease.start();let resolve!:(value:boolean)=>void;f.respond(()=>new Promise(r=>resolve=r));const pending=f.tick();f.lease.stop();resolve(false);await pending;assert.equal(f.revocations,0);assert.equal(f.timers.size,0);});
test("initial denial refuses provider work",async()=>{const f=fixture();f.respond(async()=>false);await assert.rejects(f.lease.start());assert.equal(f.revocations,1);assert.equal(f.timers.size,0);});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function sessionFixture() {
  let time = 0, next = 0, revocations = 0;
  const requests: number[] = [];
  let response = async () => true;
  const timers = new Map<number, { at: number; work: () => Promise<void> }>();
  const lease = new NativeLiveMacExecutionLease({
    renew: () => { requests.push(time); return response(); },
    onRevoked: async () => { revocations++; },
    transientRetry: { validForMs: 60_000, retryMs: 5_000 },
    now: () => time,
    scheduler: {
      schedule(work, delay) { timers.set(++next, { at: time + delay, work }); return next; },
      cancel(token) { timers.delete(token as number); },
    },
  });
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return {
    lease, requests, timers, flush,
    get revocations() { return revocations; },
    respond(fn: () => Promise<boolean>) { response = fn; },
    async advance(to: number) {
      for (;;) {
        const due = [...timers.entries()].filter(([, task]) => task.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at; timers.delete(due[0]); void due[1].work(); await flush();
      }
      time = to; await flush();
    },
  };
}

test("session heartbeat tolerates a transient error and recovers before its known deadline", async () => {
  const f = sessionFixture(); await f.lease.start();
  f.respond(async () => { throw Error("offline"); });
  await f.advance(20_000);
  assert.equal(f.revocations, 0);
  f.respond(async () => true);
  await f.advance(25_000);
  assert.deepEqual(f.requests, [0, 20_000, 25_000]);
  assert.equal(f.revocations, 0);
  f.lease.stop(); assert.equal(f.timers.size, 0);
});

test("session transport errors never extend validity or retry at the expiry boundary", async () => {
  const f = sessionFixture(); await f.lease.start();
  f.respond(async () => { throw Error("offline"); });
  await f.advance(59_999); assert.equal(f.revocations, 0);
  await f.advance(60_000);
  assert.equal(f.revocations, 1);
  assert.deepEqual(f.requests, [0, 20_000, 25_000, 30_000, 35_000, 40_000, 45_000, 50_000, 55_000]);
  assert.equal(f.timers.size, 0);
});

test("session explicit denial revokes immediately despite remaining validity", async () => {
  const f = sessionFixture(); await f.lease.start(); f.respond(async () => false);
  await f.advance(20_000); assert.equal(f.revocations, 1); assert.equal(f.timers.size, 0);
});

test("session initial transport failure cannot grant grace", async () => {
  const f = sessionFixture(); f.respond(async () => { throw Error("offline"); });
  await assert.rejects(f.lease.start()); assert.equal(f.revocations, 1); assert.equal(f.timers.size, 0);
});

test("session validity is measured from successful request start, including initial latency", async () => {
  const f = sessionFixture(), initial = deferred<boolean>(); f.respond(() => initial.promise);
  const starting = f.lease.start(); await f.advance(15_000); initial.resolve(true); await starting;
  f.respond(async () => { throw Error("offline"); });
  await f.advance(59_999); assert.equal(f.revocations, 0);
  await f.advance(60_000); assert.equal(f.revocations, 1); assert.equal(f.timers.size, 0);
});

test("session expiry revokes a hung renewal and fences its late successful response", async () => {
  const f = sessionFixture(); await f.lease.start(); const renewal = deferred<boolean>(); f.respond(() => renewal.promise);
  await f.advance(20_000); await f.advance(60_000);
  assert.equal(f.revocations, 1); assert.equal(f.timers.size, 0);
  renewal.resolve(true); await f.flush(); await f.advance(100_000);
  assert.equal(f.revocations, 1); assert.equal(f.timers.size, 0); assert.deepEqual(f.requests, [0, 20_000]);
});

test("a delayed successful session renewal only extends validity from that request start", async () => {
  const f = sessionFixture(); await f.lease.start(); const renewal = deferred<boolean>(); f.respond(() => renewal.promise);
  await f.advance(20_000); await f.advance(50_000); renewal.resolve(true); await f.flush();
  f.respond(async () => { throw Error("offline"); });
  await f.advance(79_999); assert.equal(f.revocations, 0);
  await f.advance(80_000); assert.equal(f.revocations, 1); assert.equal(f.timers.size, 0);
});

test("stopping session heartbeat fences pending renewal and already queued timer callbacks", async () => {
  const f = sessionFixture(); await f.lease.start();
  const stale = [...f.timers.values()].map(task => task.work);
  const renewal = deferred<boolean>(); f.respond(() => renewal.promise); await f.advance(20_000);
  f.lease.stop(); renewal.reject(Error("late failure")); await f.flush();
  for (const work of stale) await work();
  await f.advance(100_000);
  assert.equal(f.revocations, 0); assert.equal(f.timers.size, 0); assert.deepEqual(f.requests, [0, 20_000]);
});

test("an initial success received after its conservative validity cannot admit work", async () => {
  const f = sessionFixture(), initial = deferred<boolean>(); f.respond(() => initial.promise);
  const starting = f.lease.start(); await f.advance(60_000); initial.resolve(true);
  await assert.rejects(starting); assert.equal(f.revocations, 1); assert.equal(f.timers.size, 0);
});

test("a queued obsolete expiry callback cannot revoke a renewed session", async () => {
  const f = sessionFixture(); await f.lease.start();
  const expiry = [...f.timers.values()].find(task => task.at === 60_000);
  assert.ok(expiry);
  await f.advance(20_000); await f.advance(60_000); await expiry.work();
  assert.equal(f.revocations, 0); f.lease.stop();
});


test("conservative lease clock counts sleep and never rolls elapsed time backward", () => {
  let monotonic = 100, wall = 1_000;
  const now = createConservativeLeaseClock({ monotonicNow: () => monotonic, wallNow: () => wall });
  assert.equal(now(), 0);
  monotonic = 110; wall = 41_000;
  assert.equal(now(), 40_000);
  monotonic = 120; wall = 500;
  assert.equal(now(), 40_000);
  monotonic = 50_100;
  assert.equal(now(), 50_000);
});
