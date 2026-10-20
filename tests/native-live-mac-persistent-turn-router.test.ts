import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeLiveMacPersistentTurnRouter, type NativeLiveMacPersistentAcknowledgement } from "../src/domains/bridge/mac/native-live-mac-persistent-turn-router.js";
import { NativeLiveMacPersistentExecutor } from "../src/domains/bridge/mac/native-live-mac-persistent-executor.js";
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
type BindInput = (input: { phase: "queued" | "started"; commandUuid: string;
  command: NativeLiveRuntimeCommand }) => Promise<{ userMessageId: string; parentProviderCheckpointId: string | null } | null>;
async function fixture(t: test.TestContext, idleAdmission?: () => Promise<boolean>, bindInput?: BindInput,
  callbacks?: Partial<Pick<ConstructorParameters<typeof NativeLiveMacPersistentTurnRouter>[0], "onForegroundCoverage" | "onForegroundPublished" | "onForegroundUnpublished" | "hasUnpublishedDeferred" | "outputAttachmentSender" | "onSessionClose">>,
  captureSendFileTool?: (callback: (input: {path: string; displayName: string | null}) => Promise<unknown>) => void, forkChild?: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "persistent-turn-router-")));
  const output = queue<Record<string, unknown>>(), inputs = queue<{ uuid: string; origin: { kind: string } }>();
  const backgroundObserved = queue<string>();
  let launches = 0, closes = 0, nextCheckpoint = 101;
  const activeSid = forkChild ?? sid;
  let sessionOptions!: NativeLiveMacPersistentSessionOptions;
  const restored = [{ type: "user", uuid: id(500), parentUuid: null, sessionId: sid }, { type: "assistant", uuid: id(102), parentUuid: id(500), sessionId: sid }];
  let transcript: Array<Record<string, unknown>> | null = null;
  let writeTranscript = true;
  const resumes: unknown[] = [], submitted: string[] = [];
  let sdk!: { canUseTool: (name: string, input: unknown, context: unknown) => Promise<unknown>;
    hooks: { UserPromptSubmit: Array<{ hooks: Array<(input: Record<string, unknown>) => Promise<{ decision?: string }>> }>;
      PreToolUse: Array<{ hooks: Array<(input: Record<string, unknown>) => Promise<{ hookSpecificOutput?: { permissionDecision?: string } }>> }> } };
  const registry = new NativeLiveMacSessionRegistry({}, root, async (...args) => {
    const configured = await createNativeLiveMacClaudeTransport(...args);
    if (captureSendFileTool) {
      // Exercise the actual persistent SDK -> router -> output sink with a local
      // in-process MCP callback, but no real file, relay or provider process.
      (configured.runtime as any).createSendFileMcpServerImpl = async (
        handler: (input: {path: string; displayName: string | null}) => Promise<unknown>,
      ) => { captureSendFileTool(handler); return { type: "sdk", name: "test-files" }; };
    }
    const open = configured.runtime.openPersistentSession!.bind(configured.runtime);
    configured.runtime.openPersistentSession = (options: NativeLiveMacPersistentSessionOptions) => {sessionOptions=options;return open({ ...options, onBackgroundResult: frame => {
      backgroundObserved.push(frame.result.user_message_uuid as string);
      return options.onBackgroundResult(frame);
    } });};
    Object.assign(configured.runtime, {
      prepareLocalCheckpointForkImpl: async (fork: { sessionId: string; checkpointId: string }) => {
        assert.equal(fork.sessionId, sid); assert.equal(fork.checkpointId, id(102));
        return { sessionId: activeSid, async cleanup() {} };
      },
      sessionMessagesImpl: async () => [{}],
      importSessionToStoreImpl: async (_id: string, store: { append(key: unknown, entries: unknown[]): Promise<void> }) => store.append({ sessionId: sid }, (transcript ?? restored).map(entry => ({ ...entry, sessionId: _id }))),
      queryImpl: ({ prompt, options }: { prompt: AsyncIterable<{ uuid: string; origin: { kind: string } }>; options: typeof sdk }) => {
      launches++; sdk = options; resumes.push((options as { resume?: string }).resume ?? null); if ((options as { resume?: string }).resume) nextCheckpoint = 103;
      transcript = (options as { resume?: string }).resume ? restored.map(entry => ({ ...entry, sessionId: activeSid })) : [];
      void (async () => { for await (const item of prompt) { submitted.push(item.uuid); inputs.push(item); } })();
      output.push({ type: "system", subtype: "init", session_id: activeSid });
      return { [Symbol.asyncIterator]: () => output, close() { closes++; output.end(); inputs.end(); }, async interrupt() { return { still_queued: [] }; } };
    } });
    return configured;
  });
  const admissions: string[] = [], background: string[] = [], results: string[] = [], backgroundOwners: any[] = [], backgroundFrames: any[] = [];
  let backgroundSink: (() => Promise<NativeLiveMacPersistentAcknowledgement>) | null = null;
  let allow = true;
  let admissionSink: ((command: NativeLiveRuntimeCommand) => Promise<boolean>) | null = null;
  const relay = { renewExecutionLease: undefined as undefined | (() => Promise<boolean>), ...(idleAdmission ? { checkTaskAdmission:idleAdmission } : {}), ...(bindInput ? { bindInput } : {}), async checkExecutionAdmission(input: {command: NativeLiveRuntimeCommand}) { admissions.push(input.command.prepare_id); return admissionSink ? admissionSink(input.command) : allow; } };
  const router = new NativeLiveMacPersistentTurnRouter({ registry, listenerInstanceId: "listener", relay,
    async onBackgroundResult(owner, frame) { backgroundFrames.push(structuredClone(frame)); backgroundOwners.push(structuredClone(owner)); assert.equal(owner.conversationId, conversation); assert.ok(owner.generationId); background.push(frame.result.user_message_uuid as string); return backgroundSink ? backgroundSink() : acknowledged(frame.events.findLast(event => event.type === "assistant")?.uuid as string); }, ...callbacks });
  const run = (c: NativeLiveRuntimeCommand, extra = {}) => router.execute({ command: c, async onResult(frame) { results.push(frame.command.prepare_id); return acknowledged(frame.result.events.findLast(event => event.type === "assistant")?.uuid as string); }, ...extra });
  const finish = (uuid: string) => {
    const checkpoint = id(nextCheckpoint++);
    if (writeTranscript) transcript?.push({ type: "assistant", uuid: checkpoint, parentUuid: transcript.at(-1)?.uuid ?? null, sessionId: activeSid });
    output.push({ type: "assistant", session_id: activeSid, uuid: checkpoint, message: { role: "assistant", content: [{ type: "text", text: "synthetic" }] } });
    output.push({ type: "result", subtype: "success", session_id: activeSid, user_message_uuid: uuid });
  };
  t.after(async () => { await router.close(); await registry.closeAll(); await rm(root, { recursive: true, force: true }); });
  return { relay, workingDirectory: root, get sessionOptions(){return sessionOptions;}, router, registry, run, finish, output, inputs, admissions, background, backgroundOwners, backgroundFrames, results, backgroundObserved, resumes, submitted, get sdk() { return sdk; }, get launches() { return launches; }, holdTranscript() { writeTranscript = false; }, get closes() { return closes; }, setAdmission(sink: (command: NativeLiveRuntimeCommand) => Promise<boolean>) { admissionSink = sink; }, setBackground(sink: () => Promise<NativeLiveMacPersistentAcknowledgement>) { backgroundSink = sink; }, deny() { allow = false; } };
}

test("failed post-F background publication synchronously fences the next foreground send", async t => {
  const fenced: string[] = [];
  const f = await fixture(t, undefined, undefined, {
    onForegroundCoverage: async () => 1,
    onForegroundPublished: async () => { throw new Error("covered B delivery unknown"); },
    onForegroundUnpublished: conversationId => fenced.push(conversationId),
  });
  const active = f.run(command(1));
  const input = (await f.inputs.next()).value!;
  const failed = assert.rejects(active, /covered B delivery unknown/);
  f.finish(input.uuid);
  await failed;
  assert.deepEqual(fenced, [conversation], "committed F must not admit G while B publication is unknown");
  assert.deepEqual(f.results, [id(1)], "foreground F may already have committed");
});

test("foreground failure before coverage fences an already-queued native B receipt", async t => {
  const fenced: string[] = [];
  const f=await fixture(t,undefined,undefined,{
    onForegroundCoverage:async()=>0,
    hasUnpublishedDeferred:()=>true,
    onForegroundUnpublished:conversationId=>fenced.push(conversationId),
  });
  const run=f.run(command(1),{async onResult(){throw new Error("F died before covering B");}});
  const failed=assert.rejects(run,/F died before covering B/);
  f.finish((await f.inputs.next()).value!.uuid);
  await failed;
  assert.deepEqual(fenced,[conversation],"a queued B without F's proof must prevent the next send");
});

test("corrupted background outbox on F error fences the writer without skipping retirement",async t=>{
  const fenced:string[]=[];
  const f=await fixture(t,undefined,undefined,{
    hasUnpublishedDeferred:()=>{throw new Error("corrupt journal");},
    onForegroundUnpublished:id=>fenced.push(id),
  });
  const running=f.run(command(1),{async onResult(){throw new Error("F failed");}});
  const rejected=assert.rejects(running,/F failed/);
  f.finish((await f.inputs.next()).value!.uuid);
  await rejected;
  assert.deepEqual(fenced,[conversation]);
  assert.equal(f.closes,1,"outbox inspection failure cannot bypass safe writer retirement");
});

test("foreground failure after fsynced B coverage fences the session without publishing B", async t => {
  const fenced: string[] = [];
  let published = false;
  const f = await fixture(t, undefined, undefined, {
    onForegroundCoverage: async () => 1,
    onForegroundPublished: async () => { published = true; },
    onForegroundUnpublished: conversationId => fenced.push(conversationId),
  });
  const active = f.run(command(1), { async onResult() { throw new Error("foreground commit failed"); } });
  const input = (await f.inputs.next()).value!;
  const failed = assert.rejects(active, /foreground commit failed/);
  f.finish(input.uuid);
  await failed;
  assert.deepEqual(fenced, [conversation]);
  assert.equal(published, false, "B must remain in the outbox after F fails");
});

test("successful covered foreground and no-pending-background paths do not fence", async t => {
  const fenced: string[] = [];
  let published = 0;
  const f = await fixture(t, undefined, undefined, {
    onForegroundCoverage: async () => 1,
    onForegroundPublished: async () => { published++; },
    onForegroundUnpublished: conversationId => fenced.push(conversationId),
  });
  const active = f.run(command(1));
  f.finish((await f.inputs.next()).value!.uuid);
  await active;
  assert.equal(published, 1);
  assert.deepEqual(fenced, []);
});

test("started UUID binds an exact pre-start background advancement before foreground finalization", async t => {
  const bindings: Array<{ phase: string; inputId: string }> = [];
  const started = deferred<void>();
  const f = await fixture(t, undefined, async input => {
    bindings.push({ phase: input.phase, inputId: input.commandUuid });
    return { userMessageId: input.commandUuid, parentProviderCheckpointId: input.phase === "queued" ? checkpoint : id(102) };
  });
  const first = f.run(command(1));
  f.finish((await f.inputs.next()).value!.uuid); await first;
  f.setBackground(async () => { started.resolve(); return {status:"queued",providerCheckpointId:id(102)}; });
  const second = f.run(command(2)), pending = (await f.inputs.next()).value!;
  assert.equal(pending.uuid, id(22));
  f.finish(id(77)); await started.promise;
  for (let i = 0; i < 100 && (f.router as unknown as { providerCheckpointId: string | null }).providerCheckpointId !== id(102); i++) await new Promise(setImmediate);
  assert.equal((f.router as unknown as { providerCheckpointId: string | null }).providerCheckpointId, id(102), "earlier background must be acknowledged before the input starts");
  assert.equal(f.backgroundOwners.at(-1)?.executionStart, true, "background finished before the actual native start");
  assert.equal(f.backgroundOwners.at(-1)?.deferred,true,"B must remain queued until F commits, never reparent accepted U");
  f.output.push({ type: "command_lifecycle", state: "started", command_uuid: pending.uuid, session_id: sid });
  f.finish(pending.uuid);
  await second;
  assert.deepEqual(bindings, [
    { phase: "queued", inputId: id(22) },
    { phase: "started", inputId: id(22) },
  ]);
  assert.deepEqual(f.results, [id(1), id(2)]);
});

test("native started binding waits for earlier background acknowledgement without waiting for its own result", async t => {
  const stages: string[] = [], backgroundEntered = deferred<void>();
  const release = deferred<NativeLiveMacPersistentAcknowledgement>();
  const f = await fixture(t, undefined, async input => {
    stages.push(input.phase);
    return { userMessageId: input.commandUuid,
      parentProviderCheckpointId: input.phase === "queued" ? id(101) : id(102) };
  });
  const first = f.run(command(1));
  f.finish((await f.inputs.next()).value!.uuid); await first;
  f.setBackground(async () => { backgroundEntered.resolve(); return release.promise; });
  const second = f.run(command(2)), pending = (await f.inputs.next()).value!;
  f.finish(id(77)); await backgroundEntered.promise;
  f.output.push({ type: "command_lifecycle", state: "started", command_uuid: pending.uuid, session_id: sid });
  await new Promise(setImmediate);
  assert.deepEqual(stages, ["queued"], "cannot bind started before prior background checkpoint is acknowledged");
  release.resolve(acknowledged(id(102)));
  for (let i = 0; i < 100 && stages.length === 1; i++) await new Promise(setImmediate);
  assert.deepEqual(stages, ["queued", "started"]);
  f.finish(pending.uuid);
  await second;
  assert.deepEqual(f.results, [id(1),id(2)]);
});

test("native background after started foreground advances only queued provider evidence until F finishes",async t=>{
  const phases:string[]=[];
  const f=await fixture(t,undefined,async input=>{
    phases.push(input.phase);
    return{userMessageId:input.commandUuid,parentProviderCheckpointId:checkpoint};
  });
  const first=f.run(command(1));
  f.finish((await f.inputs.next()).value!.uuid);await first;
  f.setBackground(async()=>({status:"queued",providerCheckpointId:id(102)}));
  const second=f.run(command(2)),input=(await f.inputs.next()).value!;
  f.output.push({type:"command_lifecycle",state:"started",command_uuid:input.uuid,session_id:sid});
  for(let i=0;i<100&&phases.length<2;i++)await new Promise(setImmediate);
  assert.deepEqual(phases,["queued","started"]);
  f.finish(id(77));
  assert.equal((await f.backgroundObserved.next()).value,id(77));
  for(let i=0;i<100&&f.backgroundOwners.length===0;i++)await new Promise(setImmediate);
  assert.equal(f.backgroundOwners.at(-1)?.deferred,true);
  f.finish(input.uuid);
  await second;
  assert.equal((f.router as unknown as { providerCheckpointId: string | null }).providerCheckpointId,id(103),"F's verified descendant replaces the queued producer cursor");
  assert.deepEqual(f.results,[id(1),id(2)]);
});

test("post-start autonomous receipt waits for pending foreground bind", async t => {
  const pending = deferred<{ userMessageId:string; parentProviderCheckpointId:string|null }|null>();
  const phases:string[] = [];
  const f = await fixture(t,undefined,async input=>{
    phases.push(input.phase);
    return input.phase==="started" ? pending.promise :
      {userMessageId:input.commandUuid,parentProviderCheckpointId:checkpoint};
  });
  const first=f.run(command(1));
  f.finish((await f.inputs.next()).value!.uuid); await first;
  let reached=false;
  f.setBackground(async()=>{ reached=true; return {status:"queued",providerCheckpointId:id(102)}; });
  const second=f.run(command(2)), input=(await f.inputs.next()).value!;
  f.output.push({type:"command_lifecycle",state:"started",command_uuid:input.uuid,session_id:sid});
  for(let i=0;i<100&&phases.length<2;i++)await new Promise(setImmediate);
  assert.deepEqual(phases,["queued","started"]);
  f.finish(id(77));
  await f.backgroundObserved.next();
  await new Promise(setImmediate);
  assert.equal(reached,false);
  pending.resolve({userMessageId:input.uuid,parentProviderCheckpointId:checkpoint});
  for(let i=0;i<100&&!reached;i++)await new Promise(setImmediate);
  assert.equal(reached,true);
  assert.equal(f.backgroundOwners.at(-1)?.deferred,true);
  f.finish(input.uuid); await second;
});

test("queued transport acknowledgement cannot satisfy canonical foreground finalization", async t => {
  const f=await fixture(t);
  const running=f.run(command(1),{
    async onResult(){return {status:"queued",providerCheckpointId:id(101)};}
  });
  const failed=assert.rejects(running,/finalization was rejected/);
  f.finish((await f.inputs.next()).value!.uuid);
  await failed;
  assert.equal((f.router as unknown as { providerCheckpointId: string | null }).providerCheckpointId,null,"never advance to an uncommitted foreground cursor");
});

test("native started binding missing or disagreeing with live cursor rejects the foreground result", async t => {
  const f = await fixture(t, undefined, async input => ({
    userMessageId: input.commandUuid,
    parentProviderCheckpointId: input.phase === "queued" ? checkpoint : id(999),
  }));
  const first = f.run(command(1));
  f.finish((await f.inputs.next()).value!.uuid); await first;
  const second = f.run(command(2)), pending = (await f.inputs.next()).value!;
  const rejected = assert.rejects(second, /latest checkpoint/);
  f.output.push({ type: "command_lifecycle", state: "started", command_uuid: pending.uuid, session_id: sid });
  f.finish(pending.uuid);
  await rejected;
  assert.deepEqual(f.results, [id(1)]);
});

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

test("Wake preflight failure before SDK submission leaves existing Cron-owning writer alive",async t=>{
  const f=await fixture(t);
  const first=f.run(command(1));
  f.finish((await f.inputs.next()).value!.uuid);await first;
  const bad={...command(2,true),expected_working_directory:"/dev/null/no-such-directory"};
  await assert.rejects(f.run(bad),/directory|working|path|not a/i);
  assert.equal(f.closes,0,"unstarted Wake cannot destroy a live SDK writer");
  const next=f.run(command(2));
  f.finish((await f.inputs.next()).value!.uuid);
  await next;
  assert.equal(f.launches,1);
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
  assert.equal(f.backgroundOwners.at(-1)?.deferred, undefined,
    "a background callback released after foreground F is fully acknowledged must bind as post-F, not in-flight B");
  assert.equal(f.backgroundOwners.at(-1)?.executionStart, undefined);
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

test("output attachment handlers default enabled and only explicit false disables them", async t => {
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
  assert.deepEqual(forwarded, enabled !== false ? ["image/png"] : []);
 });
});

test("send_file follows the production default-omitted flag through real persistent SDK and router", async t => {
 for (const flag of [undefined, false, true]) await t.test(String(flag), async t => {
  const toolCapture: { callback: ((input: {path:string;displayName:string|null})=>Promise<unknown>) | null } = { callback: null };
  const sent: string[] = [];
  const f = await fixture(t, undefined, undefined, undefined, callback => { toolCapture.callback = callback; });
  const cmd = { ...command(1), ...(flag === undefined ? {} : { output_attachments_enabled: flag }) };
  const running = f.run(cmd, { sendFileHandler: async (input: {path:string}) => {
    sent.push(input.path);
    return { attachmentId:id(900),filename:"photo.mp3",mimeType:"audio/mpeg",sizeBytes:32,sha256:"0".repeat(64),kind:"file" };
  } });
  const input = (await f.inputs.next()).value!;
  f.output.push({type:"command_lifecycle",state:"started",command_uuid:input.uuid,session_id:sid});
  await new Promise(setImmediate);
  assert.ok(toolCapture.callback, "the SDK session installed its one local send_file MCP server");
  const invoke = () => toolCapture.callback!({path:"audio/photo.mp3",displayName:null});
  if (flag === false) {
    await assert.rejects(invoke(),/only available to the turn/,"explicit disabled flag must prevent file delivery");
    assert.deepEqual(sent,[]);
  } else {
    await invoke();
    assert.deepEqual(sent,["audio/photo.mp3"],"default-on and explicit true must reach only this turn's sink");
  }
  f.finish(input.uuid); await running;
  await assert.rejects(invoke(),/only available to the turn/,"completed turn cannot reuse file capability");
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

test("background receipt binds the last completed visible source, not the original or quiet wake preparation",async t=>{
 const f=await fixture(t);
 const first=f.run(command(1));f.finish((await f.inputs.next()).value!.uuid);await first;
 const second=f.run(command(2));f.finish((await f.inputs.next()).value!.uuid);await second;
 const quiet=f.run(command(3,true),{async onResult(){return {...acknowledged(id(103)),continuationOnly:true};}});
 f.finish((await f.inputs.next()).value!.uuid);await quiet;
 const host=f.registry.get(conversation,f.registry.getGenerationId(conversation)!)!.session;
 const settled=new Promise<void>(resolve=>host.events.once("background-result",()=>resolve()));
 f.finish(id(99));await settled;
 assert.deepEqual(f.backgroundOwners.at(-1),{conversationId:conversation,generationId:f.registry.getGenerationId(conversation),source:{prepareId:id(2),requestId:id(12)},providerSessionId:sid,parentProviderCheckpointId:id(103),workingDirectory:f.router.workingDirectory});
});

test("persistent runtime control pump keeps supplemental input in this reservation and returns its queue receipt",{timeout:3000},async t=>{
 const f=await fixture(t), receipts:any[]=[], ready=deferred<{uuid:string}>();let called=false;
 const running=f.run(command(1),{async controlPump(controller:any){
  called=true;const first=await ready.promise;
  receipts.push(await controller.sendUserMessage("synthetic follow-up",{uuid:id(88)}));
  assert.equal((await f.inputs.next()).value!.uuid,id(88));
  f.finish(first.uuid);f.finish(id(88));
 }});running.catch(()=>{});
 const first=(await f.inputs.next()).value!;assert.equal(called,true,"the actual router must start its control pump");ready.resolve(first);
 assert.equal((await running).inputId,id(21));assert.deepEqual(receipts,[{status:"queued",command_uuid:id(88)}]);assert.deepEqual(f.results,[id(1)]);assert.equal(f.launches,1);
});

test("a wake without a model override inherits this session's existing selection",async t=>{
 const f=await fixture(t);const selection={model:"claude-opus-5-5",thinking:"adaptive",effort:"high"} as const;
 const first=f.run({...command(1),execution_selection:selection});f.finish((await f.inputs.next()).value!.uuid);await first;
 const wake={...command(2,true),execution_selection:null};assert.equal(f.router.matches(wake),true);
 const running=f.run(wake);f.finish((await f.inputs.next()).value!.uuid);await running;assert.equal(f.launches,1);
 assert.equal(f.router.matches({...command(3),execution_selection:{...selection,effort:"low"}}),false);
});

test("suspension revokes authorization already awaiting the server response",async t=>{
 const f=await fixture(t);const running=f.run(command(1));running.catch(()=>{});const input=(await f.inputs.next()).value!;
 const entered=deferred<void>(),release=deferred<boolean>();f.setAdmission(async()=>{entered.resolve();return release.promise;});
 const admitted=(f.router as any).authorize({phase:"tool",inputId:input.uuid,source:"human",providerSessionId:sid});
 await entered.promise;f.router.suspend();release.resolve(true);assert.equal(await admitted,false);
 await f.router.close();await running.catch(()=>{});
});

test("foreground stop with background work closes the owned session and returns an applied close receipt",async t=>{
 const f=await fixture(t),stop=deferred<void>(),receipt=deferred<Record<string,unknown>>();
 const running=f.run(command(1),{async controlPump(controller:any){await stop.promise;receipt.resolve(await controller.interrupt());}});running.catch(()=>{});
 await f.inputs.next();const host=f.registry.get(conversation,f.registry.getGenerationId(conversation)!)!.session;const seen=new Promise<void>(resolve=>host.events.once("event",()=>resolve()));
 f.output.push({type:"system",subtype:"background_tasks_changed",session_id:sid,tasks:[{task_id:"background",run_id:"r1"}]});await seen;stop.resolve();
 await assert.rejects(running,(error:any)=>error.runtimeCode==="INTERRUPTED");assert.equal((await receipt.promise).session_closed,true);assert.equal(f.closes,1);
});

test('background commit cannot block task observation or be overtaken by a later foreground commit', async t => {
  const f = await fixture(t);
  const first = f.run(command(1)); f.finish((await f.inputs.next()).value!.uuid); await first;
  const entered = deferred<void>(), release = deferred<NativeLiveMacPersistentAcknowledgement>();
  t.after(() => release.resolve(acknowledged(id(102))));
  f.setBackground(async () => { entered.resolve(); return release.promise; });
  const second = f.run(command(2)); second.catch(() => {});
  const input = (await f.inputs.next()).value!;
  f.finish(id(88)); await entered.promise;
  f.finish(input.uuid);
  const session = f.registry.snapshot()[0].session;
  let observed = false;
  const update = new Promise<void>(resolve => {
    const listen = (event: Record<string, unknown>) => { if (event.subtype === 'task_progress') { observed = true; session.events.off('event', listen); resolve(); } };
    session.events.on('event', listen);
  });
  f.output.push({ type: 'system', subtype: 'task_progress', session_id: sid, task_id: 'synthetic-task', run_id: '001' });
  await new Promise(setImmediate);
  const before = { observed, commits: [...f.results] };
  release.resolve(acknowledged(id(102))); await update; await second;
  assert.deepEqual(before, { observed: true, commits: [id(1)] });
  assert.deepEqual(f.results, [id(1), id(2)]); assert.deepEqual(f.background, [id(88)]); assert.equal(f.closes, 0);
});

test("idle background tools use a fresh session fence and cannot borrow permission across a new turn",async t=>{
 const gate=deferred<boolean>();let held=false;
 const f=await fixture(t,async()=>held?gate.promise:true);
 const one=f.run(command(1));f.finish((await f.inputs.next()).value!.uuid);await one;
 const tool=()=>f.sdk.canUseTool("Read",{file_path:"/synthetic"},{signal:new AbortController().signal,toolUseID:id(5000)});
 assert.equal((await tool() as {behavior:string}).behavior,"allow");
 held=true;const late=tool();const two=f.run(command(2));await f.inputs.next();gate.resolve(true);
 assert.equal((await late as {behavior:string}).behavior,"deny");
 f.finish(id(22));await two;
});

test("native scheduled prompt uses the real idle branch fence and existing durable background result path", async t => {
 let allow=true,checks=0;const f=await fixture(t,async()=>{checks++;return allow;});
 const one=f.run(command(1));f.finish((await f.inputs.next()).value!.uuid);await one;
 const hook=f.sdk.hooks.UserPromptSubmit[0].hooks[0];
 const trigger=(prompt:string)=>hook({hook_event_name:"UserPromptSubmit",session_id:sid,source:"schedule_wakeup",prompt_id:prompt,prompt:"synthetic"});
 assert.notEqual((await trigger("scheduled-one")).decision,"block");assert.equal(checks,1);
 const binding=f.registry.snapshot()[0];
 const settled=new Promise(resolve=>binding.session.events.once("background-result",resolve));
 f.finish(id(900));await settled;
 assert.deepEqual(f.background,[id(900)]);assert.deepEqual(f.results,[id(1)]);
 const next=f.run({...command(2),parent_provider_checkpoint_id:id(102)});
 f.finish((await f.inputs.next()).value!.uuid);await next;assert.equal(f.launches,1);
});

test("scheduled prompt cannot borrow an admission through foreground rotation or handoff", async t => {
 const entered=deferred<void>(),release=deferred<boolean>();
 const f=await fixture(t,async()=>{entered.resolve();return release.promise;});
 const one=f.run(command(1));f.finish((await f.inputs.next()).value!.uuid);await one;
 const hook=f.sdk.hooks.UserPromptSubmit[0].hooks[0];
 const pending=hook({session_id:sid,source:"loop_wakeup",prompt_id:"racing",prompt:"synthetic"});await entered.promise;
 f.router.suspend();release.resolve(true);assert.equal((await pending).decision,"block");
 assert.equal(f.launches,1);assert.deepEqual(f.background,[]);
});

test("scheduled prompt waits for the preceding durable foreground acknowledgement", async t => {
 const entered=deferred<void>(),release=deferred<NativeLiveMacPersistentAcknowledgement>();let checks=0;
 const f=await fixture(t,async()=>{checks++;return true;});
 const one=f.run(command(1),{async onResult(){entered.resolve();return release.promise;}});
 f.finish((await f.inputs.next()).value!.uuid);await entered.promise;
 const hook=f.sdk.hooks.UserPromptSubmit[0].hooks[0];
 const pending=hook({session_id:sid,source:"schedule_wakeup",prompt_id:"after-commit",prompt:"synthetic"});
 assert.equal(checks,0);
 release.resolve(acknowledged());await one;
 assert.notEqual((await pending).decision,"block");assert.equal(checks,1);
});


test("closed SDK writer is not eligible for another persistent reservation", async t => {
 const f=await fixture(t);
 const first=f.run(command(1));f.finish((await f.inputs.next()).value!.uuid);await first;
 const binding=f.registry.snapshot()[0]!;
 await binding.session.close();
 assert.equal(f.router.matches(command(2)),false);
});


test("executor preserves the real router's Cron writer only for proven unsubmitted Wake failure", async t => {
  const f = await fixture(t);
  let routers = 0;
  const executor = new NativeLiveMacPersistentExecutor({ attachmentMaterializer: null, outputAttachmentSender: null,
    createRouter() { routers++; return f.router; } });
  const commit = async () => ({ canonicalOutcome: "completed" });
  const first = executor.execute(command(1), { commit });
  f.finish((await f.inputs.next()).value!.uuid); await first;
  const failed = await executor.execute({ ...command(2, true), expected_working_directory: "/dev/null/no-such-directory" }, { commit });
  assert.equal(failed.delivery, "pending"); assert.equal(failed.result.status, "failure");
  assert.equal(f.closes, 0, "outer executor must retain the proven unstarted writer");
  const next = executor.execute(command(2), { commit });
  f.finish((await f.inputs.next()).value!.uuid); await next;
  assert.equal(routers, 1); assert.equal(f.launches, 1);
  f.deny();
  const uncertain = await executor.execute({ ...command(3, true), parent_provider_checkpoint_id: id(102) }, { commit });
  assert.equal(uncertain.result.status, "failure");
  assert.equal(f.closes, 1, "SDK submission attempt remains fail closed");
});

for (const cronFirst of [false, true]) test(`native Cron admission with queued foreground (Cron selected first: ${cronFirst})`, async t => {
  let checks = 0;
  const bindings: string[] = [];
  const f = await fixture(t, async () => { checks++; return true; }, async input => {
    bindings.push(input.phase);
    return { userMessageId: input.commandUuid,
      parentProviderCheckpointId: input.phase === "queued" ? id(101) : id(102) };
  });
  const first = f.run(command(1)); f.finish((await f.inputs.next()).value!.uuid); await first;
  const binding = f.registry.snapshot()[0]!;
  const emit = async (frame: Record<string, unknown>) => {
    const observed = new Promise(resolve => binding.session.events.once("event", resolve));
    f.output.push(frame); await observed;
  };
  const started = () => emit({ type: "command_lifecycle", state: "started", command_uuid: id(900), session_id: sid });
  if (cronFirst) await started();
  const foreground = f.run(command(2)); await f.inputs.next();
  if (!cronFirst) await started();
  const hook = f.sdk.hooks.UserPromptSubmit[0].hooks[0]!;
  const admission = await hook({ session_id: sid, source: "schedule_wakeup", prompt_id: "cron-selected", prompt: "synthetic" });
  assert.notEqual(admission.decision, "block", "queued foreground has not started and cannot block native-selected Cron");
  assert.equal(checks, 1);
  const foregroundChecks = f.admissions.length;
  const preTool = await f.sdk.hooks.PreToolUse[0].hooks[0]!({ tool_name: "mcp__leileios__get_health", tool_use_id: "cron-tool" });
  assert.deepEqual(preTool, {}, "native Cron tool must use its own durable task admission while foreground remains queued");
  assert.deepEqual(await f.sdk.canUseTool("mcp__leileios__get_health", {}, { toolUseID: "cron-tool" }), { behavior: "allow" });
  assert.equal(checks, 3, "prehook and fresh post-permission task checks are performed");
  assert.equal(f.admissions.length, foregroundChecks, "Cron must not borrow the queued foreground execution grant");
  const settled = new Promise(resolve => binding.session.events.once("background-result", resolve));
  f.finish(id(900)); await settled;
  assert.deepEqual(f.background, [id(900)]);
  assert.deepEqual(f.results, [id(1)], "background result cannot finalize queued foreground");
  await emit({ type: "command_lifecycle", state: "started", command_uuid: id(22), session_id: sid });
  f.finish(id(22)); await foreground;
  assert.deepEqual(bindings, ["queued", "started"], "Cron admission must not start or bind queued foreground early");
});


for (const nextNative of [id(22), id(901)]) test(`native scheduled admission refuses selected command rotation to ${nextNative}`, async t => {
  const entered = deferred<void>(), release = deferred<boolean>();
  const f = await fixture(t, async () => { entered.resolve(); return release.promise; });
  const first = f.run(command(1)); f.finish((await f.inputs.next()).value!.uuid); await first;
  const foreground = f.run(command(2)); await f.inputs.next();
  const binding = f.registry.snapshot()[0]!;
  const emit = async (uuid: string) => {
    const observed = new Promise(resolve => binding.session.events.once("event", resolve));
    f.output.push({ type: "command_lifecycle", state: "started", command_uuid: uuid, session_id: sid });
    await observed;
  };
  await emit(id(900));
  const pending = f.sdk.hooks.UserPromptSubmit[0].hooks[0]!({ session_id: sid,
    source: "schedule_wakeup", prompt_id: "stale-native", prompt: "synthetic" });
  await entered.promise;
  await emit(nextNative); release.resolve(true);
  assert.equal((await pending).decision, "block", "old native ID cannot grant a different selected command admission");
  f.finish(id(22)); await foreground;
});

for(const denied of [false,true]) test(`background attachment collectors use durable task admission around upload: denied=${denied}`,async t=>{
  let taskChecks=0,uploads=0;
  const f=await fixture(t,async()=>{taskChecks++;return !denied;},undefined,{
    outputAttachmentSender:{async sendFile(input){uploads++;assert.equal(input.workingDirectory, f.workingDirectory);return {attachmentId:id(750),filename:"out.txt",mimeType:"text/plain",sizeBytes:3,sha256:"0".repeat(64),kind:"file"};}},
  });
  const first=f.run(command(1));f.finish((await f.inputs.next()).value!.uuid);await first;
  const output=f.sessionOptions.createBackgroundOutput!({segmentId:id(700),commandUuid:id(701)});
  if(denied){await assert.rejects(output.sendFileHandler!({path:"out.txt",displayName:null}),/admission denied/);assert.equal(uploads,0);}
  else{
    await output.sendFileHandler!({path:"out.txt",displayName:null});
    assert.deepEqual((await output.seal()).outputAttachmentIds,[id(750)]);assert.equal(uploads,1);assert.equal(taskChecks,3);
  }
  assert.deepEqual(f.admissions,[id(1)],"autonomous output never borrows another foreground admission");
});

test("background attachment upload finishing after router retirement cannot seal or move to a later segment",async t=>{
  const entered=deferred<void>(),hold=deferred<void>();
  const f=await fixture(t,async()=>true,undefined,{outputAttachmentSender:{async sendFile(){entered.resolve();await hold.promise;return {attachmentId:id(750),filename:"out.txt",mimeType:"text/plain",sizeBytes:3,sha256:"0".repeat(64),kind:"file"};}}});
  const first=f.run(command(1));f.finish((await f.inputs.next()).value!.uuid);await first;
  const output=f.sessionOptions.createBackgroundOutput!({segmentId:id(700),commandUuid:id(701)});
  const upload=output.sendFileHandler!({path:"out.txt",displayName:null});const rejected=assert.rejects(upload,/abort|retired/i);
  await entered.promise;await f.router.close();hold.resolve();await rejected;await assert.rejects(output.seal(),/abort|retired/i);
});

test("background output enabled policy follows its durable source rather than a queued foreground",async t=>{
  let uploads=0;
  const f=await fixture(t,async()=>true,undefined,{outputAttachmentSender:{async sendFile(){uploads++;return {attachmentId:id(750),filename:"out.txt",mimeType:"text/plain",sizeBytes:3,sha256:"0".repeat(64),kind:"file"};}}});
  const first=f.run({...command(1),output_attachments_enabled:false});f.finish((await f.inputs.next()).value!.uuid);await first;
  const next=f.run({...command(2),output_attachments_enabled:true});const input=(await f.inputs.next()).value!;
  const background=f.sessionOptions.createBackgroundOutput!({segmentId:id(700),commandUuid:id(701)});
  assert.equal(background.sendFileHandler,undefined);assert.equal(background.toolImageHandler,undefined);assert.equal(uploads,0);
  f.finish(input.uuid);await next;
});

test("native autonomous file and image share one exact sealed receipt through the actual SDK router path",async t=>{
  const toolCapture:{callback:((input:{path:string;displayName:string|null})=>Promise<unknown>)|null}={callback:null};
  const sent:string[]=[];
  const f=await fixture(t,async()=>true,undefined,{outputAttachmentSender:{
    async sendFile(input){sent.push(input.path);return {attachmentId:id(750),filename:"out.wav",mimeType:"audio/wav",sizeBytes:3,sha256:"0".repeat(64),kind:"file",durationSeconds:1.25};},
    async sendInlineImage(input){sent.push(input.mimeType);return {attachmentId:id(751),filename:"image.png",mimeType:"image/png",sizeBytes:3,sha256:"0".repeat(64),kind:"image"};},
  }},callback=>{toolCapture.callback=callback;});
  const first=f.run(command(1));f.finish((await f.inputs.next()).value!.uuid);await first;
  const autonomous=id(700);
  f.output.push({type:"command_lifecycle",state:"started",command_uuid:autonomous,session_id:sid});
  await new Promise(setImmediate);
  assert.ok(toolCapture.callback);
  await toolCapture.callback!({path:"audio/out.wav",displayName:null});
  f.output.push({type:"user",session_id:sid,user_message_uuid:autonomous,parent_tool_use_id:null,
    message:{content:[{type:"tool_result",tool_use_id:id(710),content:[{type:"image",source:{type:"base64",media_type:"image/png",data:"aGk="}}]}]}});
  f.finish(autonomous);
  await f.backgroundObserved.next();await new Promise(setImmediate);
  assert.deepEqual(sent,["audio/out.wav","image/png"]);
  assert.deepEqual(f.backgroundFrames[0].outputAttachmentIds,[id(750),id(751)]);
  assert.deepEqual(f.backgroundFrames[0].outputAttachmentMetadata,[{attachment_id:id(750),duration_seconds:1.25}]);
  assert.equal(f.backgroundFrames[0].commandUuid,autonomous);assert.ok(f.backgroundFrames[0].segmentId);
  assert.deepEqual(f.backgroundOwners[0].source,{prepareId:id(1),requestId:id(11)});
});

test("source rotation during autonomous upload rejects the old segment instead of attributing it to the next foreground",async t=>{
  const entered=deferred<void>(),hold=deferred<void>();
  const f=await fixture(t,async()=>true,undefined,{outputAttachmentSender:{async sendFile(){entered.resolve();await hold.promise;return {attachmentId:id(750),filename:"out.txt",mimeType:"text/plain",sizeBytes:3,sha256:"0".repeat(64),kind:"file"};}}});
  const first=f.run(command(1));f.finish((await f.inputs.next()).value!.uuid);await first;
  const output=f.sessionOptions.createBackgroundOutput!({segmentId:id(700),commandUuid:id(701)});
  const pending=output.sendFileHandler!({path:"out.txt",displayName:null});const rejected=assert.rejects(pending,/owner changed/i);
  await entered.promise;
  const next=f.run(command(2));f.finish((await f.inputs.next()).value!.uuid);await next;
  hold.resolve();await rejected;
  assert.deepEqual((await output.seal()).outputAttachmentIds,[]);
});

for (const operation of ["edit", "retry"] as const) {
  test(`${operation} exact fork retains child background delivery and later sends through real registry/transport`, async t => {
    const child = id(700);
    const f = await fixture(t, async () => true, undefined, undefined, undefined, child);
    const replacement = { ...command(2), operation, runtime_mode: "fork" as const, parent_provider_checkpoint_id: id(102) };
    let admitted = 0;
    f.setAdmission(async raw => {
      const { parseNativeLiveExecutionAdmissionBody } = await import("../src/domains/bridge/protocol/native-live-execution-admission.js");
      const parsed = parseNativeLiveExecutionAdmissionBody({ listener_instance_id: id(800), request_id: raw.request_id,
        conversation_id: raw.conversation_id, runtime_mode: raw.runtime_mode, canonical_user_message_id: raw.canonical_user_message_id,
        parent_provider_session_id: raw.parent_provider_session_id, parent_provider_checkpoint_id: raw.parent_provider_checkpoint_id });
      assert.ok(parsed, "exercise production admission parser rather than assuming fork support");
      admitted++; return true;
    });
    const running = f.run(replacement);
    const first = (await f.inputs.next()).value!;
    assert.equal(first.uuid, replacement.canonical_user_message_id);
    f.finish(first.uuid); await running;
    assert.equal(f.router.providerSessionId, child);
    assert.equal(f.closes, 0);
    const backgroundDone = deferred<void>();
    f.setBackground(async () => { backgroundDone.resolve(); return acknowledged(id(104)); });
    f.finish(id(777)); await backgroundDone.promise;
    await f.router.settle();
    assert.equal(f.backgroundOwners.at(-1)?.providerSessionId, child);
    assert.equal(f.backgroundOwners.at(-1)?.source.prepareId, replacement.prepare_id);
    const later = f.run({ ...command(3), parent_provider_session_id: child, parent_provider_checkpoint_id: id(104) });
    f.finish((await f.inputs.next()).value!.uuid); await later;
    assert.equal(f.launches, 1, "ordinary continuation reuses the child writer");
    assert.equal(f.closes, 0);
    assert.ok(admitted >= 2);
  });
}


test("control receipt timeout records its cause before execute cleanup closes again", {timeout:5000}, async t=>{
 const diagnostics:any[]=[];const f=await fixture(t,undefined,undefined,{onSessionClose:value=>diagnostics.push(value)});
 const ready=deferred<void>();
 const active=f.run(command(1),{async controlPump(controller:any){await ready.promise;await controller.interrupt();}});
 const rejected=assert.rejects(active,/closed/);await f.inputs.next();
 const binding=f.registry.snapshot()[0]!;
 // The transport operation is the external boundary; timeout/retirement remain real.
 binding.session.interruptTurn=()=>new Promise(()=>{});ready.resolve();await rejected;
 assert.equal(f.closes,1);assert.deepEqual(diagnostics.map(x=>[x.phase,x.reasonCode]),[['requested','CONTROL_RECEIPT_TIMEOUT'],['completed','CONTROL_RECEIPT_TIMEOUT']]);
 assert.equal(diagnostics[0].prepareId,id(1));assert.equal(diagnostics[0].conversationId,conversation);
 assert.equal(diagnostics[0].generationId,binding.generationId);
});
test("revoked turn lease records a different cause from control timeout",async t=>{
 const diagnostics:any[]=[];const f=await fixture(t,undefined,undefined,{onSessionClose:value=>diagnostics.push(value)});
 f.relay.renewExecutionLease=async()=>false;
 await assert.rejects(f.run(command(1)),/lease was not renewed/);
 assert.equal(diagnostics[0]?.reasonCode,'EXECUTION_LEASE_REVOKED');assert.equal(f.closes,1);
});
