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
async function fixture(t: test.TestContext, config: { limit?: number; opening?: ReturnType<typeof deferred>; failClose?: boolean; rejectOpen?: boolean; reuseRuntime?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "session-registry-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const transports: NativeLiveMacClaudeTransport[] = [];
  const calls: Array<{ cwd: string; options?: NativeLiveMacPersistentSessionOptions; closed: number; inputs: string[] }> = [];
  const registry = new NativeLiveMacSessionRegistry({}, root, async (_env, cwd) => {
    if (config.reuseRuntime && transports[0]) return { kind: "agent_sdk" as const, runtime: transports[0] };
    const call = { cwd: cwd!, closed: 0, inputs: [] as string[], options: undefined as NativeLiveMacPersistentSessionOptions | undefined };
    calls.push(call);
    const completion = deferred();
    const host = { state: "idle", sessionId: `session-${calls.length}`, tasks: new Map(), events: new EventEmitter(), completion: completion.promise,
      async submit(text: string) { if (!await call.options!.authorize({ phase: "input", inputId: "input", source: "human", providerSessionId: this.sessionId })) throw Error("denied"); call.inputs.push(text); return { providerSessionId: this.sessionId, inputId: "input", result: {}, events: [] }; },
      async interruptTurn() { return null; }, async stopTask() {},
      async close() { call.closed++; if (config.failClose) { config.failClose = false; throw Error("close failed"); } this.state = "closed"; completion.resolve(); },
    };
    const runtime = { abort() {}, async deleteSession() {}, async openPersistentSession(opts: NativeLiveMacPersistentSessionOptions) { call.options = opts; await config.opening?.promise; if (config.rejectOpen) throw Error("startup failed"); return host; }, async closePersistentSession() { await host.close(); } };
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
