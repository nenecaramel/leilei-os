import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeLiveMacSessionRegistry } from "../src/domains/bridge/mac/native-live-mac-session-registry.js";
import type { NativeLiveMacClaudeTransport, NativeLiveMacPersistentSessionOptions } from "../src/domains/bridge/mac/native-live-mac-claude-transport.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const options = (): NativeLiveMacPersistentSessionOptions => ({
  authorize: async () => true, onBackgroundResult: async () => {},
});
async function fixture(t: test.TestContext, config: { limit?: number; opening?: ReturnType<typeof deferred>; failClose?: boolean; rejectOpen?: boolean; reuseRuntime?: boolean; delayedInit?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "session-registry-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const transports: NativeLiveMacClaudeTransport[] = [];
  const calls: Array<{ cwd: string; options?: NativeLiveMacPersistentSessionOptions; closed: number; inputs: string[]; fork?: {sessionId:string;checkpointId:string} | null }> = [];
  const registry = new NativeLiveMacSessionRegistry({}, root, async (_env, cwd) => {
    if (config.reuseRuntime && transports[0]) return { kind: "agent_sdk" as const, runtime: transports[0] };
    const call = { cwd: cwd!, closed: 0, inputs: [] as string[],
      options: undefined as NativeLiveMacPersistentSessionOptions | undefined,
      fork: null as {sessionId:string;checkpointId:string} | null };
    calls.push(call);
    const completion = deferred();
    const host = { state: "idle", sessionId: config.delayedInit ? null : `session-${calls.length}`, tasks: new Map(), events: new EventEmitter(), completion: completion.promise,
      async submit(text: string) { if (!await call.options!.authorize({ phase: "input", inputId: "input", source: "human", providerSessionId: this.sessionId })) throw Error("denied"); call.inputs.push(text); return { providerSessionId: this.sessionId, inputId: "input", result: {}, events: [] }; },
      async interruptTurn() { return null; }, async stopTask() {},
      async close() { call.closed++; if (config.failClose) { config.failClose = false; throw Error("close failed"); } this.state = "closed"; completion.resolve(); },
    };
    const runtime = { abort() {}, async deleteSession() {},
      async openPersistentSession(opts: NativeLiveMacPersistentSessionOptions) { call.options = opts; await config.opening?.promise; if (config.rejectOpen) throw Error("startup failed"); return host; },
      async forkPersistentSession(fork: {sessionId:string;checkpointId:string}, opts: NativeLiveMacPersistentSessionOptions) {
        call.fork = {...fork}; call.options=opts; await config.opening?.promise;
        if (config.rejectOpen) throw Error("startup failed"); return host;
      },
      async closePersistentSession() { await host.close(); } };
    transports.push(runtime);
    return { kind: "agent_sdk" as const, runtime };
  }, () => null, null, config.limit ?? 4);
  t.after(() => registry.closeAll());
  return { root, registry, calls };
}

test("different conversations in the same directory own distinct persistent SDK transports", async t => {
  const f = await fixture(t);
  const a = await f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: options() });
  const b = await f.registry.openNew({ conversationId: "b", expectedWorkingDirectory: null, options: options() });
  assert.notEqual(a.session, b.session); assert.equal(f.calls.length, 2);
  await a.session.submit("one"); await a.session.submit("two");
  assert.deepEqual(f.calls.map(c => c.inputs), [["one", "two"], []]);
  assert.equal(f.registry.get("a", a.generationId), a);
});
test("edited branch forks into a new OWNED persistent session with exact source checkpoint", async t => {
  const f = await fixture(t);
  const fork = {sessionId:"parent-session",checkpointId:"parent-checkpoint"};
  const binding = await f.registry.openFork({conversationId:"edit",expectedWorkingDirectory:null,
    options:options(),fork});
  assert.deepEqual(f.calls[0]!.fork,fork);
  assert.equal(binding.session.sessionId,"session-1");
  assert.notEqual(binding.session.sessionId,fork.sessionId,
    "the fork must never claim to be the old branch's writer");
  await binding.session.submit("after edited message");
  assert.deepEqual(f.calls[0]!.inputs,["after edited message"]);
  assert.equal(f.calls[0]!.closed,0,"native scheduling survives the foreground boundary");
});

test("duplicate opens cannot replace callbacks or launch a second query", async t => {
  const opening = deferred(); const f = await fixture(t, { opening });
  const first = f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: options() });
  await assert.rejects(f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: options() }), /already/);
  opening.resolve(); await first; assert.equal(f.calls.length, 1);
});
test("retirement revokes admission before waiting for a pending launch", async t => {
  const opening = deferred(); const f = await fixture(t, { opening });
  const first = f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: options() });
  const rejected = assert.rejects(first, /retired/);
  const closing = f.registry.closeAll(); opening.resolve(); await closing; await rejected;
  assert.equal(f.registry.size, 0); assert.ok(f.calls.every(c => c.closed > 0));
});
test("failed close retains capacity and ownership; retry cannot affect a newer generation", async t => {
  const f = await fixture(t, { failClose: true, limit: 1 });
  const a = await f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: options() });
  await assert.rejects(f.registry.close("a", a.generationId), /close failed/);
  assert.equal(f.registry.get("a", a.generationId), null);
  await assert.rejects(a.session.submit("late"), /retired/);
  await assert.rejects(f.registry.openNew({ conversationId: "b", expectedWorkingDirectory: null, options: options() }), /capacity/);
  await f.registry.close("a", a.generationId);
  const next = await f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: options() });
  assert.notEqual(next.generationId, a.generationId);
  await f.registry.close("a", a.generationId); assert.equal(f.registry.get("a", next.generationId), next);
});
test("retirement during authorization denies late input without sending it", async t => {
  const f = await fixture(t); const entered = deferred(), release = deferred();
  const a = await f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: { ...options(), authorize: async () => { entered.resolve(); await release.promise; return true; } } });
  const pending = a.session.submit("late"), rejected = assert.rejects(pending, /retired/); await entered.promise;
  await f.registry.close("a", a.generationId); release.resolve(); await rejected;
  assert.deepEqual(f.calls[0]!.inputs, []);
});
test("retired background callbacks cannot enter the durable sink", async t => {
  const f = await fixture(t); let received = 0;
  const a = await f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: { ...options(), onBackgroundResult: async () => { received++; } } });
  await f.registry.close("a", a.generationId);
  await assert.rejects(f.calls[0]!.options!.onBackgroundResult({ result: {}, events: [] }), /retired/);
  assert.equal(received, 0);
});
test("paths canonicalize per session and missing/relative directories never launch", async t => {
  const f = await fixture(t); const path = join(f.root, "work"), alias = join(f.root, "alias");
  await mkdir(path); await symlink(path, alias);
  const a = await f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: alias, options: options() }); assert.equal(a.workingDirectory, path);
  for (const expectedWorkingDirectory of ["relative", join(f.root, "missing")]) await assert.rejects(f.registry.openNew({ conversationId: "bad", expectedWorkingDirectory, options: options() }), /directory/);
  assert.equal(f.calls.length, 1);
});
test("capacity includes pending opens; no idle eviction or automatic task replay", async t => {
  const opening = deferred(); const f = await fixture(t, { opening, limit: 1 });
  const first = f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: options() });
  await assert.rejects(f.registry.openNew({ conversationId: "b", expectedWorkingDirectory: null, options: options() }), /capacity/);
  opening.resolve(); await first;
  await assert.rejects(f.registry.openNew({ conversationId: "b", expectedWorkingDirectory: null, options: options() }), /capacity/);
  assert.equal(f.calls.length, 1);
});
test("shutdown revokes admission immediately and refuses concurrent new opens", async t => {
  const opening = deferred(); const f = await fixture(t, { opening });
  const first = f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: options() });
  const rejected = assert.rejects(first, /retired/); const closing = f.registry.closeAll();
  const extra = f.registry.openNew({ conversationId: "b", expectedWorkingDirectory: null, options: options() });
  extra.catch(() => {}); opening.resolve();
  await assert.rejects(extra, /shut down/);
  await closing; await rejected;
});
test("real configured factory keeps two same-directory sessions and their inputs isolated", async t => {
  const { createNativeLiveMacClaudeTransport } = await import("../src/domains/bridge/mac/native-live-mac-claude-transport.js");
  const root = await realpath(await mkdtemp(join(tmpdir(), "session-registry-factory-")));
  const inputs: string[][] = []; let launches = 0;
  const registry = new NativeLiveMacSessionRegistry({}, root, async (...args) => {
    const transport = await createNativeLiveMacClaudeTransport(...args);
    const index = inputs.length; inputs.push([]);
    (transport.runtime as unknown as { queryImpl: unknown }).queryImpl = ({ prompt }: { prompt: AsyncIterable<{ uuid: string; message: { content: { text: string }[] } }> }) => {
      launches++;
      return { close() {}, async *[Symbol.asyncIterator]() {
        let initialized = false;
        for await (const input of prompt) {
          if (!initialized) { initialized = true; yield { type: "system", subtype: "init", session_id: `s-${index}` }; }
          inputs[index]!.push(input.message.content[0]!.text);
          yield { type: "result", subtype: "success", session_id: `s-${index}`, user_message_uuid: input.uuid };
        }
      } };
    };
    return transport;
  });
  t.after(async () => { await registry.closeAll(); await rm(root, { recursive: true, force: true }); });
  const a = await registry.openNew({ conversationId: "a", expectedWorkingDirectory: root, options: options() });
  const b = await registry.openNew({ conversationId: "b", expectedWorkingDirectory: root, options: options() });
  const [one, other] = await Promise.all([a.session.submit("a1", { source: "human" }), b.session.submit("b1", { source: "human" })]);
  const next = await a.session.submit("a2", { source: "task-notification" });
  assert.equal(next.providerSessionId, one.providerSessionId); assert.notEqual(one.providerSessionId, other.providerSessionId);
  assert.equal(launches, 2); assert.deepEqual(inputs, [["a1", "a2"], ["b1"]]);
  await registry.close("a", a.generationId); await b.session.submit("b2"); assert.deepEqual(inputs[1], ["b1", "b2"]);
});

test("failed startup with failed cleanup exposes a local generation for targeted close retry", async t => {
  const f = await fixture(t, { rejectOpen: true, failClose: true, limit: 1 });
  await assert.rejects(f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: options() }), /startup failed/);
  assert.equal(f.registry.size, 1);
  const generation = f.registry.getGenerationId("a"); assert.ok(generation);
  await f.registry.close("a", generation!); assert.equal(f.registry.size, 0);
});
test("a cached factory runtime cannot be reused by another conversation or close its owner", async t => {
  const config = { reuseRuntime: false }; const f = await fixture(t, config);
  const first = await f.registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: options() });
  config.reuseRuntime = true;
  await assert.rejects(f.registry.openNew({ conversationId: "b", expectedWorkingDirectory: null, options: options() }), /already owned/);
  await first.session.submit("still owned by a"); assert.equal(f.calls[0]!.closed, 0);
});
test("retirement during real SDK loading cancels startup before any late query is created", async t => {
  const { createNativeLiveMacClaudeTransport } = await import("../src/domains/bridge/mac/native-live-mac-claude-transport.js");
  const root = await realpath(await mkdtemp(join(tmpdir(), "session-registry-loading-")));
  const loading = deferred<unknown>(), entered = deferred(); let queries = 0;
  const registry = new NativeLiveMacSessionRegistry({}, root, async (...args) => {
    const transport = await createNativeLiveMacClaudeTransport(...args);
    (transport.runtime as unknown as { loadQuery: unknown }).loadQuery = () => { entered.resolve(); return loading.promise; };
    return transport;
  });
  t.after(async () => { await registry.closeAll(); await rm(root, { recursive: true, force: true }); });
  const first = registry.openNew({ conversationId: "a", expectedWorkingDirectory: null, options: options() });
  const rejected = assert.rejects(first, /abort|retired/); await entered.promise;
  const closing = registry.closeAll();
  loading.resolve(() => { queries++; return { close() {}, async *[Symbol.asyncIterator]() {} }; });
  await closing; await rejected; assert.equal(queries, 0); assert.equal(registry.size, 0);
});

test("a close RPC cannot release ownership before the SDK output stream actually finishes",async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),"registry-drain-")));t.after(()=>rm(root,{recursive:true,force:true}));
 const closed=deferred(),stream=deferred();const session={state:"idle",sessionId:"synthetic",tasks:new Map(),events:new EventEmitter(),completion:stream.promise};
 const registry=new NativeLiveMacSessionRegistry({},root,async()=>({kind:"agent_sdk",runtime:{abort(){},async openPersistentSession(){return session;},async closePersistentSession(){closed.resolve();}}}) as never);
 t.after(()=>registry.closeAll());
 const binding=await registry.openNew({conversationId:"a",expectedWorkingDirectory:null,options:options()});
 const closing=registry.close("a",binding.generationId);await closed.promise;
 await new Promise(resolve=>setImmediate(resolve));
 try {assert.equal(registry.size,1);await assert.rejects(registry.openNew({conversationId:"a",expectedWorkingDirectory:null,options:options()}),/already/);}
 finally {stream.resolve();await closing;}
 assert.equal(registry.size,0);
});

for (const preclaimed of [false,true]) test(`task control pump wakes after delayed init (identity preclaimed=${preclaimed})`,async t=>{
 const f=await fixture(t,{delayedInit:true});
 const {runNativeLiveMacTaskControls}=await import("../src/domains/bridge/mac/native-live-mac-task-controls.js");
 const cancel=new AbortController(),empty=deferred();let waits=0,emptyWaits=0;
 const wait=f.registry.waitForChange.bind(f.registry);
 f.registry.waitForChange=signal=>{const result=wait(signal);if(++emptyWaits===2)empty.resolve();return result;};
 const pump=runNativeLiveMacTaskControls({registry:f.registry,listenerInstanceId:"listener",signal:cancel.signal,relay:{async waitTaskControl(){waits++;cancel.abort();return null;},async completeRuntimeControl(){}}});
 t.after(async()=>{cancel.abort();await pump;});
 const binding=await f.registry.openNew({conversationId:"a",expectedWorkingDirectory:null,options:options()});
 await empty.promise;
 (binding.session as {sessionId:string|null}).sessionId="delayed-session";
 if(preclaimed)await f.calls[0]!.options!.authorize({phase:"input",inputId:"synthetic",source:"human",providerSessionId:"delayed-session"});
 (binding.session.events as EventEmitter).emit("event",{type:"system",subtype:"init",session_id:"delayed-session"});
 await new Promise(setImmediate);assert.equal(waits,1);
});

test('retiring during an open with a live SDK host preserves the initiating reason through abort',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'registry-close-reason-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const entered=deferred(),release=deferred();t.after(()=>release.resolve());const diagnostics:any[]=[];
 const {createNativeLiveMacClaudeTransport}=await import('../src/domains/bridge/mac/native-live-mac-claude-transport.js');
 let stop!:()=>void;
 const registry=new NativeLiveMacSessionRegistry({},root,async(...args)=>{
   const configured=await createNativeLiveMacClaudeTransport(...args);
   (configured.runtime as any).queryImpl=()=>({async *[Symbol.asyncIterator](){yield {type:'system',subtype:'init',session_id:'12345678-1234-4123-8123-123456789012'};await new Promise<void>(resolve=>{stop=resolve;});},close(){stop?.();}});
   const open=configured.runtime.openPersistentSession!.bind(configured.runtime);
   configured.runtime.openPersistentSession=async options=>{const host=await open(options);entered.resolve();await release.promise;return host;};
   return configured;
 });t.after(()=>registry.closeAll());
 const opening=registry.openNew({conversationId:'startup',expectedWorkingDirectory:null,options:{...options(),onCloseDiagnostic:frame=>diagnostics.push(frame)}});
 const rejected=assert.rejects(opening,/retired|abort/);await entered.promise;
 const closing=registry.close('startup',registry.getGenerationId('startup')!,'HANDOFF_DRAIN');
 release.resolve();await rejected;await closing;
 assert.deepEqual(diagnostics.map(x=>[x.phase,x.reasonCode]),[['requested','HANDOFF_DRAIN'],['completed','HANDOFF_DRAIN']]);
});

for (const mode of ["exit", "failure", "failed-close"] as const) test(`idle SDK ${mode} releases only verified closed ownership without replay`, async t => {
  const { createNativeLiveMacClaudeTransport } = await import("../src/domains/bridge/mac/native-live-mac-claude-transport.js");
  const root = await realpath(await mkdtemp(join(tmpdir(), "registry-idle-failure-")));
  const end = deferred(); let launches = 0, closes = 0, refuseClose = mode === "failed-close";
  const registry = new NativeLiveMacSessionRegistry({}, root, async (...args) => {
    const transport = await createNativeLiveMacClaudeTransport(...args);
    (transport.runtime as unknown as { queryImpl: unknown }).queryImpl = () => {
      launches++;
      return { async close() { closes++; if (refuseClose) throw Error("close unconfirmed"); }, async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", session_id: "idle-session" };
        await end.promise;
        if (mode !== "exit") throw Error("idle stream failed");
      } };
    };
    return transport;
  }, () => null, null, 1);
  t.after(async () => { refuseClose = false; await registry.closeAll(); await rm(root, { recursive: true, force: true }); });
  const binding = await registry.openNew({ conversationId: "idle", expectedWorkingDirectory: null, options: options() });
  end.resolve(); await binding.session.completion.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(registry.snapshot().length, 0, "terminal stream must not appear in live task inventory");
  assert.equal(registry.get("idle", binding.generationId), null);
  assert.equal(registry.size, mode === "failed-close" ? 1 : 0, "only verified query close releases capacity");
  assert.equal(launches, 1, "failure never reruns models or launches a replacement");
  assert.ok(closes >= 1);
  if (mode === "failed-close") {
    await assert.rejects(registry.openNew({ conversationId: "other", expectedWorkingDirectory: null, options: options() }), /capacity/);
    refuseClose = false; await registry.close("idle", binding.generationId);
    assert.equal(registry.size, 0);
  }
});
