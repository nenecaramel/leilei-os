import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeLiveMacSessionRegistry } from "../src/domains/bridge/mac/native-live-mac-session-registry.js";
import type { NativeLiveMacPersistentSession, NativeLiveMacPersistentSessionOptions } from "../src/domains/bridge/mac/native-live-mac-claude-transport.js";
const sid = "11111111-1111-4111-8111-111111111111", checkpointId = "22222222-2222-4222-8222-222222222222", inputId = "44444444-4444-4444-8444-444444444444";
const restore = { sessionId: sid, checkpointId, inputId, source: "task-notification" as const };
const options = (): NativeLiveMacPersistentSessionOptions => ({ authorize: async () => true, onBackgroundResult: async () => {} });
async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "persistent-restore-registry-")));
  let opens = 0, restores = 0, closes = 0;
  const observed: unknown[] = [];
  const registry = new NativeLiveMacSessionRegistry({}, root, async () => {
    let host: NativeLiveMacPersistentSession | undefined;
    let state = "idle";
    let complete!: () => void; const completion = new Promise<void>(resolve => { complete = resolve; });
    const runtime = { abort() {}, async deleteSession() {}, async openPersistentSession() { opens++; throw Error("must use restore path"); },
      async restorePersistentSession(spec: unknown, opts: NativeLiveMacPersistentSessionOptions) { restores++; observed.push(spec); host = { get state() { return state; }, sessionId: sid, events: new EventEmitter(), tasks: new Map(), completion,
        async submit(_text: string, submit: { id: string; source: "task-notification" }) { assert.equal(await opts.authorize({ phase: "input", inputId: submit.id, source: submit.source, providerSessionId: sid }), true); return { providerSessionId: sid, inputId: submit.id, result: {}, events: [] }; }, async interruptTurn() { return null; }, async stopTask() {}, async close() { closes++; state = "closed"; complete(); } }; return host; },
      async closePersistentSession() { await host?.close(); } };
    return { kind: "agent_sdk" as const, runtime };
  });
  t.after(async () => { await registry.closeAll(); await rm(root, { recursive: true, force: true }); });
  return { root, registry, observed, get opens() { return opens; }, get restores() { return restores; }, get closes() { return closes; } };
}
test("registry explicitly restores an existing session instead of opening a new query", async t => {
  const f = await fixture(t);
  const binding = await f.registry.openExisting({ conversationId: "a", expectedWorkingDirectory: null, restore, options: options() });
  assert.equal(f.opens, 0); assert.equal(f.restores, 1); assert.deepEqual(f.observed, [restore]);
  assert.equal((await binding.session.submit("synthetic wake", { id: inputId, source: "task-notification" })).providerSessionId, sid);
});
test("two conversations cannot restore the same native writer and stale close cannot release its new owner", async t => {
  const f = await fixture(t); const a = await f.registry.openExisting({ conversationId: "a", expectedWorkingDirectory: null, restore, options: options() });
  await assert.rejects(f.registry.openExisting({ conversationId: "b", expectedWorkingDirectory: null, restore, options: options() }), /already owned/); assert.equal(f.restores, 1);
  await f.registry.close("a", a.generationId);
  const b = await f.registry.openExisting({ conversationId: "b", expectedWorkingDirectory: null, restore, options: options() });
  await f.registry.close("a", a.generationId); assert.equal(f.registry.get("b", b.generationId), b); assert.equal(f.closes, 1);
});
test("configured factory and registry resume two turns with the original local SDK identity", async t => {
  const { createNativeLiveMacClaudeTransport } = await import("../src/domains/bridge/mac/native-live-mac-claude-transport.js");
  const root = await realpath(await mkdtemp(join(tmpdir(), "configured-native-restore-")));
  let launches = 0; const submitted: string[] = [];
  const registry = new NativeLiveMacSessionRegistry({}, root, async (...args) => {
    const configured = await createNativeLiveMacClaudeTransport(...args);
    Object.assign(configured.runtime, {
      sessionMessagesImpl: async () => [{}],
      importSessionToStoreImpl: async (_id: string, store: { append(key: unknown, entries: unknown[]): Promise<void> }) => store.append({ sessionId: sid }, [
        { type: "user", uuid: "33333333-3333-4333-8333-333333333333", parentUuid: null, sessionId: sid },
        { type: "assistant", uuid: checkpointId, parentUuid: "33333333-3333-4333-8333-333333333333", sessionId: sid },
      ]),
      queryImpl: ({ prompt, options: sdk }: { prompt: AsyncIterable<{ uuid: string }>; options: { resume: string; resumeSessionAt: string; settings: { hooks: { SessionStart: { hooks: { command: string }[] }[] } } } }) => {
        launches++; assert.equal(sdk.resume, sid); assert.equal(sdk.resumeSessionAt, checkpointId);
        const receipt = sdk.settings.hooks.SessionStart[0]!.hooks[0]!.command.match(/'([^']+)'$/)![1];
        return { close() {}, async *[Symbol.asyncIterator]() {
          yield { type: "system", subtype: "hook_response", hook_event: "SessionStart", stdout: receipt, session_id: sid, outcome: "success", exit_code: 0 };
          for await (const input of prompt) {
            submitted.push(input.uuid);
            yield { type: "command_lifecycle", state: "queued", command_uuid: input.uuid, session_id: sid };
            yield { type: "system", subtype: "init", session_id: sid };
            yield { type: "result", subtype: "success", session_id: sid, user_message_uuid: input.uuid };
          }
        } };
      },
    });
    return configured;
  });
  t.after(async () => { await registry.closeAll(); await rm(root, { recursive: true, force: true }); });
  const binding = await registry.openExisting({ conversationId: "configured", expectedWorkingDirectory: root, restore, options: options() });
  const one = await binding.session.submit("synthetic wake", { id: inputId, source: "task-notification" });
  const two = await binding.session.submit("synthetic user", { id: "55555555-5555-4555-8555-555555555555", source: "human" });
  assert.equal(one.providerSessionId, sid); assert.equal(two.providerSessionId, sid); assert.equal(launches, 1); assert.equal(submitted.length, 2);
});
