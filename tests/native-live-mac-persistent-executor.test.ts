import assert from "node:assert/strict";
import test from "node:test";
import { NativeLiveMacPersistentExecutor } from "../src/domains/bridge/mac/native-live-mac-persistent-executor.js";
import type { NativeLiveRuntimeCommand, NativeLiveRuntimeExecutionResult } from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const command = (extra: Partial<NativeLiveRuntimeCommand> = {}): NativeLiveRuntimeCommand => ({
  protocol_version: 4, dispatch_target: "claude_code", prepare_id: id(1), request_id: id(2), conversation_id: id(3),
  operation: "send", runtime_mode: "resume", canonical_user_message_id: id(4), parent_provider_session_id: id(5),
  parent_provider_checkpoint_id: id(6), expected_working_directory: null, prompt: "synthetic", ...extra,
} as NativeLiveRuntimeCommand);
type TurnInput = Record<string, any>;

function fixture(behavior: (input: TurnInput) => Promise<unknown>, { matches = true, materializer = null as any, sender = null as any } = {}) {
  const routers: Array<{ closed: number; inputs: TurnInput[] }> = [];
  const executor = new NativeLiveMacPersistentExecutor({
    attachmentMaterializer: materializer, outputAttachmentSender: sender,
    createRouter() {
      const state = { closed: 0, inputs: [] as TurnInput[] }; routers.push(state);
      return { workingDirectory: "/work", matches: () => matches, async close() { state.closed++; },
        async execute(input: TurnInput) { state.inputs.push(input); return behavior(input) as never; } } as never;
    },
  });
  return { executor, routers };
}
const frame = (input: TurnInput, events: unknown[] = [{ event_id: "e", type: "assistant_text" }]) =>
  input.onResult({ command: input.command, providerCheckpointId: id(9), result: { providerSessionId: id(5), inputId: id(4), result: {}, events: [], normalizedEvents: events } });

test("a completed commit acknowledges the verified checkpoint and is never resubmitted", async () => {
  const commits: NativeLiveRuntimeExecutionResult[] = []; let ack: unknown;
  const f = fixture(async input => { ack = await frame(input); return {}; });
  const run = await f.executor.execute(command(), { async commit(result) { commits.push(result); return { canonicalOutcome: "completed" }; } });
  assert.equal(run.delivery, "committed"); assert.equal(run.canonicalOutcome, "completed");
  assert.deepEqual(ack, { status: "applied", providerCheckpointId: id(9) });
  assert.equal(commits.length, 1);
  assert.equal(commits[0]!.status, "success");
  assert.deepEqual([commits[0]!.provider_checkpoint_id, commits[0]!.provider_session_id, commits[0]!.effective_working_directory], [id(9), id(5), "/work"]);
  assert.equal(f.routers.length, 1); assert.equal(f.routers[0]!.closed, 0);
});

test("a wake outcome that commits no checkpoint retires the writer; the submitted result stands", async () => {
  const f = fixture(async input => { const ack = await frame(input) as { status: string }; if (ack.status === "rejected") throw new Error("Persistent turn finalization was rejected."); return {}; });
  await f.executor.execute(command(), { async commit() { return { canonicalOutcome: "completed" }; } });
  const run = await f.executor.execute(command({ operation: "wake", canonical_user_message_id: null }), { async commit() { return { canonicalOutcome: "wake_quiet" }; } });
  assert.equal(run.delivery, "committed"); assert.equal(run.result.status, "success"); assert.equal(run.canonicalOutcome, "wake_quiet");
  assert.equal(f.executor.canRoute(command()), true, "the retired router is gone; a new one may restore");
  await f.executor.execute(command(), { async commit() { return { canonicalOutcome: "completed" }; } });
  assert.equal(f.routers.length, 2);
});

test("a stale Wake with a durably reconciled native cursor keeps its SDK writer and Cron", async () => {
  const f=fixture(async input=>{
    const ack=await frame(input) as {status:string;providerCheckpointId:string;continuationOnly?:boolean};
    assert.equal(ack.status,"applied");
    if(input.command.operation==="wake")assert.equal(ack.continuationOnly,true,
      "visible Wake was stale but its native checkpoint was committed");
    return {};
  });
  await f.executor.execute(command(),{async commit(){return {canonicalOutcome:"completed"};}});
  const stale=await f.executor.execute(command({operation:"wake",canonical_user_message_id:null}),{
    async commit(){return {canonicalOutcome:"wake_stale",nativeResumeCheckpointId:id(9)};}
  });
  assert.equal(stale.delivery,"committed");assert.equal(stale.canonicalOutcome,"wake_stale");
  assert.equal(f.routers[0]!.closed,0,"no fork, no Cron owner retired");
  const next=await f.executor.execute(command(),{async commit(){return {canonicalOutcome:"completed"};}});
  assert.equal(next.result.status,"success");
  assert.equal(f.routers.length,1,"later send stays on same live writer");
});

test("a stale Wake without server cursor proof closes the uncertain SDK writer",async()=>{
  const f=fixture(async input=>{
    const ack=await frame(input) as {status:string};
    if(ack.status==="rejected")throw Error("stale Wake lacks verified continuation");
    return {};
  });
  await f.executor.execute(command(),{async commit(){return {canonicalOutcome:"completed"};}});
  const stale=await f.executor.execute(command({operation:"wake",canonical_user_message_id:null}),{
    async commit(){return {canonicalOutcome:"wake_stale"};}
  });
  assert.equal(stale.delivery,"committed");
  assert.equal(f.routers[0]!.closed,1,"never pretend a stale checkpoint is safe");
});

test("a lost commit response is delivery-unknown with the submitted result, not a failure to resubmit", async () => {
  const f = fixture(async input => { await frame(input); return {}; });
  const run = await f.executor.execute(command(), { async commit() { throw new Error("socket closed"); } });
  assert.equal(run.delivery, "unknown"); assert.equal(run.result.status, "success");
});

test("a failure before any commit is pending: the caller submits the failure result", async () => {
  const f = fixture(async () => { throw Object.assign(new Error("not durable"), { runtimeCode: "NO_PROVIDER_SESSION" }); });
  let commits = 0;
  const run = await f.executor.execute(command(), { async commit() { commits++; } });
  assert.equal(run.delivery, "pending"); assert.equal(commits, 0);
  assert.deepEqual([run.result.status, (run.result as { error_code?: string }).error_code], ["failure", "NO_PROVIDER_SESSION"]);
});

test("edit and retry own a persistent child across supported new/fork modes", async () => {
  for (const operation of ["edit", "retry"] as const) for (const runtime_mode of ["new", "fork"] as const) {
    const f = fixture(async input => { await frame(input); return {}; });
    const replacement = command({ operation, runtime_mode,
      ...(runtime_mode === "new" ? { parent_provider_session_id: null, parent_provider_checkpoint_id: null } : {}) });
    assert.equal(f.executor.canRoute(replacement), true);
    const result = await f.executor.execute(replacement, { async commit() { return { canonicalOutcome: "completed" }; } });
    assert.equal(result.delivery, "committed");
    assert.equal(f.routers.length, 1);
    assert.equal(f.routers[0]!.closed, 0, "reply completion preserves the new writer");
  }
});

test("Wake uses the current matching writer, or restores its original SID after restart; never forks", async () => {
  const wake = command({ operation:"wake", runtime_mode:"resume", canonical_user_message_id:null });
  const restored = fixture(async input => {
    assert.equal(input.command.operation, "wake");
    assert.equal(input.command.runtime_mode, "resume");
    assert.equal(input.command.parent_provider_session_id, id(5));
    await frame(input);
    return {};
  });
  assert.equal(restored.executor.canRoute(wake), true, "after daemon restart Wake can restore same session");
  const run = await restored.executor.execute(wake,{async commit(){return {canonicalOutcome:"completed"};}});
  assert.equal(run.canonicalOutcome, "completed");
  assert.equal(restored.routers[0]!.closed,0, "restored same-session writer survives Wake");
  assert.equal(restored.executor.canRoute({...wake,runtime_mode:"fork"}), false, "Wake must never fork");

  const mismatched = fixture(async input => { await frame(input); return {}; }, { matches: false });
  await mismatched.executor.execute(command(), {async commit(){return {canonicalOutcome:"completed"};}});
  assert.equal(mismatched.executor.canRoute(wake), false, "an existing mismatched writer cannot be replaced");
  await assert.rejects(mismatched.executor.execute(wake, {async commit(){}}),/cannot use the persistent writer/);
  assert.equal(mismatched.routers[0]!.closed,0, "a stale Wake cannot close an existing Cron writer");
});

test("only continuing send/wake commands route; a legacy operation retires the writer first", async () => {
  const f = fixture(async input => { await frame(input); return {}; }, { matches: false });
  assert.equal(f.executor.canRoute(command({ runtime_mode: "fork" })), false);
  assert.equal(f.executor.canRoute(command({ failed_user_message_uuids: [id(7)] } as never)), false);
  assert.equal(f.executor.canRoute({ nonsense: true }), false);
  assert.equal(f.executor.canRoute(command()), true, "no writer yet");
  await f.executor.execute(command(), { async commit() { return { canonicalOutcome: "completed" }; } });
  assert.equal(f.executor.canRoute(command()), false, "the current writer cannot continue it");
  await assert.rejects(f.executor.execute(command(), { async commit() {} }), /cannot use the persistent writer/);
  await f.executor.retire(id(3)); assert.equal(f.routers[0]!.closed, 1);
  assert.equal(f.executor.canRoute(command()), true);
});

test("attachments are materialized into the prompt and cleaned up; outputs are capped per turn", async () => {
  const cleaned: string[] = [], sent: string[] = [];
  const materializer = { async materialize() { return [{ localPath: "/tmp/a.png" }]; }, appendPrompt: (prompt: string) => `${prompt}\n[/tmp/a.png]`, async cleanup(c: NativeLiveRuntimeCommand) { cleaned.push(c.prepare_id); } };
  const sender = { async sendFile(input: { path: string; workingDirectory: string }) { sent.push(`${input.workingDirectory}:${input.path}`); return { attachmentId: id(50 + sent.length) }; } };
  let commitBody: NativeLiveRuntimeExecutionResult | null = null;
  const f = fixture(async input => {
    assert.equal(input.prompt, "synthetic\n[/tmp/a.png]");
    for (let i = 0; i < 8; i++) await input.sendFileHandler({ path: `f${i}`, displayName: null });
    await assert.rejects(input.sendFileHandler({ path: "f9", displayName: null }), /at most 8/);
    await frame(input); return {};
  }, { materializer, sender });
  const attachment = { attachment_id: id(30), kind: "image", mime_type: "image/png", filename: "a.png", size_bytes: 1, sha256: "0".repeat(64) };
  await f.executor.execute(command({ attachments: [attachment] } as never), { async commit(result) { commitBody = result; return { canonicalOutcome: "completed" }; } });
  assert.deepEqual(cleaned, [id(1)]); assert.equal(sent[0], "/work:f0");
  assert.equal((commitBody as { output_attachment_ids?: string[] } | null)?.output_attachment_ids?.length, 8);
});

test("verified quiet resume commits its exact cursor without retiring the same-session writer", async () => {
  const f = fixture(async input => { const ack = await frame(input); assert.deepEqual(ack,{status:"applied",providerCheckpointId:id(9),...(input.command.operation === "wake" ? {continuationOnly:true} : {})}); return {}; });
  await f.executor.execute(command(), { async commit() { return { canonicalOutcome: "completed" }; } });
  const run=await f.executor.execute(command({operation:"wake",canonical_user_message_id:null}),{async commit(){return {canonicalOutcome:"wake_quiet",nativeResumeCheckpointId:id(9)};}});
  assert.equal(run.delivery,"committed");assert.equal(run.canonicalOutcome,"wake_quiet");
  assert.equal(f.routers[0]!.closed,0);
  const next=await f.executor.execute(command(),{async commit(){return {canonicalOutcome:"completed"};}});
  assert.equal(next.result.status,"success"); assert.equal(next.canonicalOutcome,"completed");
  assert.equal(f.routers.length,1,"next foreground turn must retain this writer");
});

test("failed retirement retains ownership and retries close before another writer can route", async () => {
  let closes = 0;
  const executor = new NativeLiveMacPersistentExecutor({ attachmentMaterializer: null, outputAttachmentSender: null,
    createRouter: () => ({ workingDirectory: "/work", matches: () => false,
      async execute(input: TurnInput) { await frame(input); return {} as never; },
      async close() { if (++closes === 1) throw new Error("close unknown"); },
    }) as never });
  await executor.execute(command(), { async commit() { return { canonicalOutcome: "completed" }; } });
  await assert.rejects(executor.retire(id(3)), /close unknown/);
  assert.equal(executor.canRoute(command()), false, "failed close must not free ownership");
  await executor.retire(id(3));
  assert.equal(closes, 2); assert.equal(executor.canRoute(command()), true);
});

test("shutdown reports failed writers and allows a later close retry", async () => {
  let closes = 0;
  const executor = new NativeLiveMacPersistentExecutor({ attachmentMaterializer: null, outputAttachmentSender: null,
    createRouter: () => ({ workingDirectory: "/work", matches: () => true,
      async execute(input: TurnInput) { await frame(input); return {} as never; },
      async close() { if (++closes === 1) throw new Error("close unknown"); },
    }) as never });
  await executor.execute(command(), { async commit() { return { canonicalOutcome: "completed" }; } });
  await assert.rejects(executor.closeAll(), /could not all close/);
  assert.equal(executor.canRoute(command()), false, "shutdown never accepts new work");
  await executor.closeAll(); assert.equal(closes, 2);
});

test("full persistent capacity safely routes a fifth conversation to the existing fallback",async()=>{
 let routers=0;
 const executor=new NativeLiveMacPersistentExecutor({hasCapacity:()=>routers<4,attachmentMaterializer:null,outputAttachmentSender:null,createRouter(){routers++;return {workingDirectory:"/work",matches:()=>true,async close(){},async execute(input:TurnInput){await frame(input);return {} as never;}};}} as any);
 for(let n=0;n<4;n++)await executor.execute(command({conversation_id:id(100+n)}),{async commit(){return {canonicalOutcome:"completed"};}});
 assert.equal(executor.canRoute(command({conversation_id:id(104)})),false);assert.equal(routers,4);await executor.closeAll();
});

test("handoff suspension lifts when the conversation is attached back, but recovery fencing remains", async () => {
  const { executor } = fixture(async () => ({}));
  executor.suspend(id(3));
  assert.equal(executor.canRoute(command()), false);
  assert.throws(() => executor.assertAccepting(id(3)), /fenced for handoff/);
  executor.resumeHandoff(id(3));
  assert.equal(executor.canRoute(command()), true);
  assert.doesNotThrow(() => executor.assertAccepting(id(3)));
  executor.suspend(id(3), "recovery"); executor.suspend(id(3));
  executor.resumeHandoff(id(3));
  assert.equal(executor.canRoute(command()), false);
});

test("a persistent turn failure reports the same bounded diagnostics as the legacy executor, never the prompt", async () => {
  const reports: Array<Record<string, unknown>> = [];
  const executor = new NativeLiveMacPersistentExecutor({
    attachmentMaterializer: null, outputAttachmentSender: null,
    onRuntimeFailure: diagnostics => { reports.push({ ...diagnostics }); },
    createRouter() {
      return { workingDirectory: "/work", matches: () => true, async close() {},
        async execute() { throw Object.assign(new Error("Claude Code process exited with code 1"), { cause: Object.assign(new Error("spawn failed"), { code: "ENOENT" }) }); } } as never;
    },
  });
  const run = await executor.execute(command({ prompt: "PRIVATE_PROMPT" }), { commit: async () => assert.fail("must not commit") });
  assert.equal(run.result.status, "failure");
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.prepareId, id(1));
  assert.equal(reports[0]!.runtimeCode, "RUNTIME_UNAVAILABLE");
  assert.equal(reports[0]!.errorMessage, "Claude Code process exited with code 1");
  assert.equal(reports[0]!.causeCode, "ENOENT");
  assert.doesNotMatch(JSON.stringify(reports), /PRIVATE_PROMPT/);
});

test("persistent foreground waits for its pending output collector before committing immutable attachment receipt", async () => {
  let release!: () => void, upload!: Promise<unknown>, commits = 0;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async input => {
    upload = input.sendFileHandler({path:"late.wav",displayName:null});
    await frame(input);
    return {};
  }, {sender:{async sendFile(){await hold;return {attachmentId:id(50),durationSeconds:3.25};}}});
  let body!: NativeLiveRuntimeExecutionResult;
  const running = f.executor.execute(command(), {async commit(result){commits++;body=result;return {canonicalOutcome:"completed"};}});
  await new Promise(setImmediate);
  assert.equal(commits,0,"a terminal receipt cannot omit an already admitted pending upload");
  release();await upload;await running;
  assert.deepEqual(body.output_attachment_ids,[id(50)]);
  assert.deepEqual(body.output_attachment_metadata,[{attachment_id:id(50),duration_seconds:3.25}]);
});
