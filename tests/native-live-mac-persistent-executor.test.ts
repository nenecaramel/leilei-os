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
  const run = await f.executor.execute(command({ operation: "wake", canonical_user_message_id: null }), { async commit() { return { canonicalOutcome: "wake_quiet" }; } });
  assert.equal(run.delivery, "committed"); assert.equal(run.result.status, "success"); assert.equal(run.canonicalOutcome, "wake_quiet");
  assert.equal(f.executor.canRoute(command()), true, "the retired router is gone; a new one may restore");
  await f.executor.execute(command(), { async commit() { return { canonicalOutcome: "completed" }; } });
  assert.equal(f.routers.length, 2);
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
