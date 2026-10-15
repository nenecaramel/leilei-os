import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeLiveMacPersistentTurnRouter, type NativeLiveMacPersistentAcknowledgement } from "../src/domains/bridge/mac/native-live-mac-persistent-turn-router.js";
import { NativeLiveMacSessionRegistry } from "../src/domains/bridge/mac/native-live-mac-session-registry.js";
import { createNativeLiveMacClaudeTransport } from "../src/domains/bridge/mac/native-live-mac-claude-transport.js";
import type { NativeLiveMacPersistentSessionOptions } from "../src/domains/bridge/mac/native-live-mac-claude-transport.js";
import type { NativeLiveRuntimeCommand } from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const acknowledged = (providerCheckpointId = id(101)): NativeLiveMacPersistentAcknowledgement => ({ status: "applied", providerCheckpointId });
const sid = id(100), checkpoint = id(101), conversation = id(102);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function queue<T>() {
  const items: T[] = []; let waiting: ((value: IteratorResult<T>) => void) | null = null, ended = false;
  return { push(value: T) { if (waiting) { const resolve = waiting; waiting = null; resolve({ value, done: false }); } else items.push(value); },
    end() { ended = true; waiting?.({ value: undefined, done: true }); waiting = null; },
    [Symbol.asyncIterator]() { return this; }, async next(): Promise<IteratorResult<T>> { if (items.length) return { value: items.shift()!, done: false }; if (ended) return { value: undefined, done: true }; return new Promise(resolve => { waiting = resolve; }); } };
}
function command(n: number, wake = false): NativeLiveRuntimeCommand {
  return { protocol_version: 4, dispatch_target: "claude_code", prepare_id: id(n), request_id: id(n + 10), conversation_id: conversation,
    operation: wake ? "wake" : "send", runtime_mode: n === 1 ? "new" : "resume", canonical_user_message_id: wake ? null : id(n + 20),
    parent_provider_session_id: n === 1 ? null : sid, parent_provider_checkpoint_id: n === 1 ? null : id(99 + n), expected_working_directory: null, prompt: "synthetic" };
}
async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "persistent-turn-router-")));
  const output = queue<Record<string, unknown>>(), inputs = queue<{ uuid: string; origin: { kind: string } }>();
  const backgroundObserved = queue<string>();
  let launches = 0, closes = 0, nextCheckpoint = 101;
  const restored = [{ type: "user", uuid: id(500), parentUuid: null, sessionId: sid }, { type: "assistant", uuid: id(102), parentUuid: id(500), sessionId: sid }];
  let transcript: Array<Record<string, unknown>> | null = null;
  let writeTranscript = true;
  const resumes: unknown[] = [], submitted: string[] = [];
  let sdk!: { canUseTool: (name: string, input: unknown, context: unknown) => Promise<unknown> };
  const registry = new NativeLiveMacSessionRegistry({}, root, async (...args) => {
    const configured = await createNativeLiveMacClaudeTransport(...args);
    const open = configured.runtime.openPersistentSession!.bind(configured.runtime);
    configured.runtime.openPersistentSession = (options: NativeLiveMacPersistentSessionOptions) => open({ ...options, onBackgroundResult: frame => {
      backgroundObserved.push(frame.result.user_message_uuid as string);
      return options.onBackgroundResult(frame);
    } });
    Object.assign(configured.runtime, {
      sessionMessagesImpl: async () => [{}],
      importSessionToStoreImpl: async (_id: string, store: { append(key: unknown, entries: unknown[]): Promise<void> }) => store.append({ sessionId: sid }, (transcript ?? restored).map(entry => ({ ...entry }))),
      queryImpl: ({ prompt, options }: { prompt: AsyncIterable<{ uuid: string; origin: { kind: string } }>; options: typeof sdk }) => {
      launches++; sdk = options; resumes.push((options as { resume?: string }).resume ?? null); if ((options as { resume?: string }).resume) nextCheckpoint = 103;
      transcript = (options as { resume?: string }).resume ? [...restored] : [];
      void (async () => { for await (const item of prompt) { submitted.push(item.uuid); inputs.push(item); } })();
      output.push({ type: "system", subtype: "init", session_id: sid });
      return { [Symbol.asyncIterator]: () => output, close() { closes++; output.end(); inputs.end(); }, async interrupt() { return { still_queued: [] }; } };
    } });
    return configured;
  });
  const admissions: string[] = [], background: string[] = [], results: string[] = [];
  let backgroundSink: (() => Promise<NativeLiveMacPersistentAcknowledgement>) | null = null;
  let allow = true;
  let admissionSink: ((command: NativeLiveRuntimeCommand) => Promise<boolean>) | null = null;
  const router = new NativeLiveMacPersistentTurnRouter({ registry, listenerInstanceId: "listener", relay: { async checkExecutionAdmission(input) { admissions.push(input.command.prepare_id); return admissionSink ? admissionSink(input.command) : allow; } },
    async onBackgroundResult(owner, frame) { assert.equal(owner.conversationId, conversation); assert.ok(owner.generationId); background.push(frame.result.user_message_uuid as string); return backgroundSink ? backgroundSink() : acknowledged(frame.events.findLast(event => event.type === "assistant")?.uuid as string); } });
  const run = (c: NativeLiveRuntimeCommand, extra = {}) => router.execute({ command: c, async onResult(frame) { results.push(frame.command.prepare_id); return acknowledged(frame.result.events.findLast(event => event.type === "assistant")?.uuid as string); }, ...extra });
  const finish = (uuid: string) => {
    const checkpoint = id(nextCheckpoint++);
    if (writeTranscript) transcript?.push({ type: "assistant", uuid: checkpoint, parentUuid: transcript.at(-1)?.uuid ?? null, sessionId: sid });
    output.push({ type: "assistant", session_id: sid, uuid: checkpoint, message: { role: "assistant", content: [{ type: "text", text: "synthetic" }] } });
    output.push({ type: "result", subtype: "success", session_id: sid, user_message_uuid: uuid });
  };
  t.after(async () => { await router.close(); await registry.closeAll(); await rm(root, { recursive: true, force: true }); });
  return { router, registry, run, finish, output, inputs, admissions, background, results, backgroundObserved, resumes, submitted, get sdk() { return sdk; }, get launches() { return launches; }, holdTranscript() { writeTranscript = false; }, get closes() { return closes; }, setAdmission(sink: (command: NativeLiveRuntimeCommand) => Promise<boolean>) { admissionSink = sink; }, setBackground(sink: () => Promise<NativeLiveMacPersistentAcknowledgement>) { backgroundSink = sink; }, deny() { allow = false; } };
}

test("two reservations and wake reuse one SDK query and rotate execution admission", async t => {
  const f = await fixture(t);
  for (const [n, wake] of [[1, false], [2, false], [3, true]] as const) {
    const running = f.run(command(n, wake));
    const input = (await f.inputs.next()).value!;
    assert.equal(input.uuid, id(wake ? n : n + 20)); assert.equal(input.origin.kind, wake ? "task-notification" : "human");
    f.finish(input.uuid); assert.equal((await running).providerSessionId, sid);
  }
  assert.equal(f.launches, 1); assert.deepEqual(f.results, [id(1), id(2), id(3)]);
  assert.ok(f.admissions.includes(id(2))); assert.ok(f.admissions.includes(id(3)));
});

test("next reservation waits for durable result acknowledgement and idle tools are denied", async t => {
  const f = await fixture(t), started = deferred<void>(), release = deferred<NativeLiveMacPersistentAcknowledgement>();
  const one = f.run(command(1), { async onResult() { started.resolve(); return release.promise; } });
  const input = (await f.inputs.next()).value!; f.finish(input.uuid); await started.promise;
  await assert.rejects(f.run(command(2)), /active|acknowledg/i);
  assert.deepEqual(await f.sdk.canUseTool("Read", { file_path: "/synthetic" }, { signal: new AbortController().signal, toolUseID: id(50) }), { behavior: "deny", message: "LeileiOS session admission denied.", interrupt: true });
  release.resolve(acknowledged()); await one;
  const two = f.run(command(2)); f.finish((await f.inputs.next()).value!.uuid); await two;
});

test("question callbacks rotate per turn instead of retaining first reservation", async t => {
  const f = await fixture(t); const asked: number[] = [];
  for (const n of [1, 2]) {
    const running = f.run(command(n), { async questionHandler() { asked.push(n); return { decision: "answer", answers: { synthetic: String(n) } }; } });
    const input = (await f.inputs.next()).value!;
    const verdict = await f.sdk.canUseTool("AskUserQuestion", { questions: [{ question: "synthetic", header: "test", options: [{ label: "one", description: "one" }, { label: "two", description: "two" }], multiSelect: false }] }, { signal: new AbortController().signal, toolUseID: id(50) });
    assert.equal((verdict as { behavior: string }).behavior, "allow");
    f.finish(input.uuid); await running;
  }
  assert.deepEqual(asked, [1, 2]);
});

test("retirement during a question revokes its late answer and cannot target a new turn", async t => {
  const f = await fixture(t), entered = deferred<void>(), release = deferred<Record<string, unknown>>();
  const running = f.run(command(1), { async questionHandler() { entered.resolve(); return release.promise; } });
  const rejected = assert.rejects(running, /closed|retired/i); await f.inputs.next();
  const question = f.sdk.canUseTool("AskUserQuestion", { questions: [{ question: "synthetic", header: "test", options: [{ label: "one", description: "one" }, { label: "two", description: "two" }], multiSelect: false }] }, { signal: new AbortController().signal, toolUseID: id(50) });
  await entered.promise; await f.router.close(); release.resolve({ decision: "answer", answers: { synthetic: "one" } });
  assert.equal((await question as { behavior: string }).behavior, "deny"); await rejected;
  await assert.rejects(f.run(command(2)), /retired|closed/i); assert.deepEqual(f.results, []);
});

test("retirement during result acknowledgement never reports old result as current success", async t => {
  const f = await fixture(t), entered = deferred<void>(), release = deferred<NativeLiveMacPersistentAcknowledgement>();
  const running = f.run(command(1), { async onResult() { entered.resolve(); return release.promise; } });
  f.finish((await f.inputs.next()).value!.uuid); await entered.promise;
  await f.router.close(); release.resolve(acknowledged());
  await assert.rejects(running, /retired|closed/i); assert.equal(f.closes, 1);
});

test("rejected or uncertain finalization retires the writer without replay", async t => {
  for (const fail of [false, true]) await t.test(String(fail), async t => {
    const f = await fixture(t); const running = f.run(command(1), { async onResult() { if (fail) throw Error("synthetic lost response"); return { status: "rejected" }; } });
    const rejected = assert.rejects(running, /rejected|lost response/); f.finish((await f.inputs.next()).value!.uuid); await rejected;
    await assert.rejects(f.run(command(2)), /retired|closed/); assert.equal(f.launches, 1); assert.equal(f.closes, 1);
  });
});

test("autonomous result uses session sink even while a foreground reservation awaits its result", async t => {
  const f = await fixture(t), running = f.run(command(1));
  const input = (await f.inputs.next()).value!; f.finish(id(77)); f.finish(input.uuid); await running;
  assert.deepEqual(f.background, [id(77)]); assert.deepEqual(f.results, [id(1)]);
});

test("stale server admission rejects the next input without executing it", async t => {
  const f = await fixture(t), one = f.run(command(1)); f.finish((await f.inputs.next()).value!.uuid); await one;
  f.deny(); await assert.rejects(f.run(command(2)), /admission denied/); assert.deepEqual(f.results, [id(1)]); assert.equal(f.closes, 1);
});

test("unsupported fork, attachments and wrong conversation cannot enter the persistent query", async t => {
  const f = await fixture(t);
  for (const c of [{ ...command(2), runtime_mode: "fork" as const }, { ...command(1), attachments: [{ attachment_id: id(300), kind: "image", mime_type: "image/png", filename: "a.png", size_bytes: 1, sha256: "0".repeat(64) }] } as NativeLiveRuntimeCommand]) await assert.rejects(f.run(c), /unsupported|not support/i);
  assert.equal(f.launches, 0);
  const one = f.run(command(1)); f.finish((await f.inputs.next()).value!.uuid); await one;
  await assert.rejects(f.run({ ...command(2), conversation_id: id(999) }), /conversation/i);
  await assert.rejects(f.run({ ...command(2), parent_provider_session_id: id(999) }), /identity|session/i);
  assert.equal(f.launches, 1);
});


test("a second router cannot close another router's live writer on duplicate ownership", async t => {
  const f = await fixture(t), first = f.run(command(1));
  const input = (await f.inputs.next()).value!;
  const other = new NativeLiveMacPersistentTurnRouter({ registry: f.registry, listenerInstanceId: "other", relay: { async checkExecutionAdmission() { return true; } }, async onBackgroundResult() { return acknowledged(); } });
  await assert.rejects(other.execute({ command: command(1), async onResult() { return acknowledged(); } }), /already|owned/);
  assert.equal(f.closes, 0);
  f.finish(input.uuid); await first;
});

test("foreground and autonomous durable acknowledgements are serialized", async t => {
  const f = await fixture(t), entered = deferred<void>(), release = deferred<NativeLiveMacPersistentAcknowledgement>(), backgroundEntered = deferred<void>();
  f.setBackground(async () => { backgroundEntered.resolve(); return acknowledged(); });
  const first = f.run(command(1), { async onResult() { entered.resolve(); return release.promise; } });
  f.finish((await f.inputs.next()).value!.uuid); await entered.promise;
  f.finish(id(88));
  // Observe arrival at the real transport sink before asserting it is queued.
  assert.equal((await f.backgroundObserved.next()).value, id(88));
  assert.deepEqual(f.background, []);
  release.resolve(acknowledged()); await first; await backgroundEntered.promise;
  assert.deepEqual(f.background, [id(88)]);
});

test("caller mutation cannot retarget a pending reservation or its durable result", async t => {
  const f = await fixture(t), c = command(1), running = f.run(c);
  c.prepare_id = id(999); c.conversation_id = id(999);
  f.finish((await f.inputs.next()).value!.uuid); await running;
  assert.deepEqual(f.results, [id(1)]); assert.ok(f.admissions.every(value => value === id(1)));
});

test("idempotent durable acknowledgement succeeds without replaying provider input", async t => {
  const f = await fixture(t), running = f.run(command(1), { async onResult() { return { status: "idempotent", providerCheckpointId: checkpoint }; } });
  f.finish((await f.inputs.next()).value!.uuid); await running;
  assert.equal(f.launches, 1); assert.equal(f.closes, 0);
});


test("initial wake restores the original checkpoint and a later human turn reuses that writer", async t => {
  const f = await fixture(t), wake = f.run(command(3, true));
  const input = (await f.inputs.next()).value!; assert.equal(input.uuid, id(3)); assert.equal(input.origin.kind, "task-notification");
  f.finish(input.uuid); await wake;
  const human = f.run(command(4)); f.finish((await f.inputs.next()).value!.uuid); await human;
  assert.equal(f.launches, 1); assert.deepEqual(f.resumes, [sid]); assert.deepEqual(f.results, [id(3), id(4)]);
});

test("rejected autonomous acknowledgement fails the host without using foreground result sink", async t => {
  const f = await fixture(t); f.setBackground(async () => ({ status: "rejected" }));
  const running = f.run(command(1)); const rejected = assert.rejects(running, /background finalization was rejected/);
  await f.inputs.next(); f.finish(id(90)); await rejected;
  assert.deepEqual(f.background, [id(90)]); assert.deepEqual(f.results, []); assert.equal(f.closes, 1);
  await assert.rejects(f.run(command(2)), /retired|closed/);
});

test("duplicate input is not executed twice even after its reservation finalized", async t => {
  const f = await fixture(t), first = f.run(command(1)); f.finish((await f.inputs.next()).value!.uuid); await first;
  await assert.rejects(f.run({ ...command(2), canonical_user_message_id: id(21) }), /Duplicate/);
  assert.deepEqual(f.results, [id(1)]); assert.equal(f.closes, 1);
});

test("a resume aimed at a different checkpoint cannot reuse the current writer", async t => {
  const f = await fixture(t), first = f.run(command(1)); f.finish((await f.inputs.next()).value!.uuid); await first;
  const attempt = f.run({ ...command(2), parent_provider_checkpoint_id: id(99) });
  const rejected = assert.rejects(attempt, /checkpoint/i);
  void f.inputs.next().then(input => { if (input.value) f.finish(input.value.uuid); });
  await rejected; assert.deepEqual(f.results, [id(1)]);
});


test("background checkpoint advancement during admission rejects the now-stale queued input", async t => {
  const f = await fixture(t), first = f.run(command(1)); f.finish((await f.inputs.next()).value!.uuid); await first;
  const entered = deferred<void>(), release = deferred<boolean>();
  f.setAdmission(async c => { assert.equal(c.prepare_id, id(2)); entered.resolve(); return release.promise; });
  const running = f.run(command(2)); const rejected = assert.rejects(running, /admission denied/); await entered.promise;
  const generation = f.registry.getGenerationId(conversation)!;
  const host = f.registry.get(conversation, generation)!.session;
  const acknowledgedBackground = new Promise<void>(resolve => host.events.once("background-result", () => resolve()));
  f.finish(id(90)); await acknowledgedBackground; release.resolve(true); await rejected;
  assert.deepEqual(f.submitted, [id(21)]); assert.deepEqual(f.results, [id(1)]);
});

test("missing committed checkpoint cannot release the next reservation", async t => {
  const f = await fixture(t), running = f.run(command(1), { async onResult() { return { status: "applied", providerCheckpointId: "invalid" }; } });
  const rejected = assert.rejects(running, /committed provider checkpoint/); f.finish((await f.inputs.next()).value!.uuid); await rejected;
  await assert.rejects(f.run(command(2)), /retired|closed/); assert.equal(f.closes, 1);
});

test("each turn streams its own live output and returns the normalized events it owns", async t => {
  const f = await fixture(t);
  const live: string[][] = [[], []];
  for (const [index, n] of [1, 2].entries()) {
    const running = f.run({ ...command(n), output_attachments_enabled: true }, { onNormalizedEvent: (event: { event_id: string }) => { live[index]!.push(event.event_id); } });
    const input = (await f.inputs.next()).value!;
    f.output.push({ type: "assistant", session_id: sid, uuid: id(110 + n), parent_tool_use_id: null, user_message_uuid: input.uuid, user_message_uuids: [input.uuid], message: { role: "assistant", content: [{ type: "text", text: `turn-${n}` }] } });
    f.finish(input.uuid);
    const result = await running;
    assert.ok(live[index]!.length > 0);
    assert.deepEqual(result.normalizedEvents.map(event => event.event_id), live[index]);
  }
  assert.equal(new Set([...live[0]!, ...live[1]!]).size, live[0]!.length + live[1]!.length, "no event is delivered to two turns");
});

test("output attachment handlers require explicit capability opt-in", async t => {
 for (const enabled of [undefined, false, true]) await t.test(String(enabled), async t => {
  const f = await fixture(t), forwarded: string[] = [];
  const commandWithOutput = { ...command(1), ...(enabled === undefined ? {} : { output_attachments_enabled: enabled }) };
  const running = f.run(commandWithOutput, { toolImageHandler: async (image: { mimeType: string }) => { forwarded.push(image.mimeType); } });
  const input = (await f.inputs.next()).value!;
  f.output.push({ type: "assistant", session_id: sid, user_message_uuid: input.uuid, user_message_uuids: [input.uuid],
    message: { role: "assistant", content: [{ type: "text", text: "owned" }] } });
  f.output.push({ type: "user", session_id: sid, parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: id(310),
    content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } }] }] } });
  f.finish(input.uuid);
  await running;
  assert.deepEqual(forwarded, enabled === true ? ["image/png"] : []);
 });
});

test("only a durably verified checkpoint reaches the sink, and the acknowledgement must name it", async t => {
  const f = await fixture(t); const seen: Array<string | undefined> = [];
  const one = f.run(command(1), { async onResult(frame: { providerCheckpointId?: string }) { seen.push(frame.providerCheckpointId); return acknowledged(id(999)); } });
  const rejected = assert.rejects(one, /checkpoint/i); f.finish((await f.inputs.next()).value!.uuid); await rejected;
  assert.deepEqual(seen, [id(101)]);
  const g = await fixture(t); g.holdTranscript(); let reached = false;
  const two = g.run(command(1), { async onResult() { reached = true; return acknowledged(); } });
  const refused = assert.rejects(two, /durably/i); g.finish((await g.inputs.next()).value!.uuid); await refused;
  assert.equal(reached, false, "an unwritten checkpoint is never committed");
});

test("matches only the committed continuation, and a materialized prompt carries attachments", async t => {
  const f = await fixture(t);
  assert.equal(f.router.matches(command(1)), true, "a fresh router may open");
  const attachment = { attachment_id: id(300), kind: "image", mime_type: "image/png", filename: "a.png", size_bytes: 1, sha256: "0".repeat(64) };
  const one = f.run({ ...command(1), attachments: [attachment] } as NativeLiveRuntimeCommand, { prompt: "synthetic\n[local attachment]" });
  const input = (await f.inputs.next()).value! as unknown as { uuid: string; message: { content: Array<{ text: string }> } };
  assert.equal(input.message.content[0]!.text, "synthetic\n[local attachment]");
  f.finish(input.uuid); await one;
  assert.equal(f.router.matches(command(2)), true);
  assert.equal(f.router.matches({ ...command(2), parent_provider_checkpoint_id: id(555) }), false);
  assert.equal(f.router.matches({ ...command(2), runtime_mode: "fork" }), false);
  assert.equal(f.router.workingDirectory !== null, true);
  await f.router.close(); assert.equal(f.router.matches(command(2)), false);
});
