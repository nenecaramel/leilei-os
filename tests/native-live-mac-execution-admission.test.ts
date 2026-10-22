import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createNativeLiveMacExecutionAdmission } from "../src/domains/bridge/mac/native-live-mac-execution-admission.js";
import type { NativeLiveRuntimeCommand } from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";
const command: NativeLiveRuntimeCommand = { protocol_version: 4, dispatch_target: "claude_code", prepare_id: "prepare", request_id: "request", conversation_id: "conversation", operation: "send", runtime_mode: "new", canonical_user_message_id: "user-input", parent_provider_session_id: null, parent_provider_checkpoint_id: null, expected_working_directory: null, prompt: "synthetic" };
test("admission rechecks relay on every input/tool callback without caching", async () => {
  let calls = 0;
  const gate = createNativeLiveMacExecutionAdmission({ listenerInstanceId: "listener", command, relay: { async checkExecutionAdmission() { return ++calls === 1; } } });
  assert.equal(await gate({ phase: "input", inputId: "user-input", source: "human", providerSessionId: null }), true);
  assert.equal(await gate({ phase: "tool", inputId: "user-input", source: null, providerSessionId: "sdk-session" }), false);
  assert.equal(calls, 2);
});
test("wrong input attribution, idle tools and unsupported forks do not reach relay", async () => {
  let calls = 0; const relay = { async checkExecutionAdmission() { calls++; return true; } };
  const gate = createNativeLiveMacExecutionAdmission({ listenerInstanceId: "listener", command, relay });
  for (const context of [ { phase: "input" as const, inputId: "other", source: "human" as const, providerSessionId: null }, { phase: "input" as const, inputId: "user-input", source: "task-notification" as const, providerSessionId: null }, { phase: "tool" as const, inputId: null, source: null, providerSessionId: "sdk" } ]) assert.equal(await gate(context), false);
  const fork = createNativeLiveMacExecutionAdmission({ listenerInstanceId: "listener", command: { ...command, runtime_mode: "fork" }, relay });
  assert.equal(await fork({ phase: "input", inputId: "user-input", source: "human", providerSessionId: null }), false); assert.equal(calls, 0);
});
test("wake preserves nonhuman source and must match existing provider session", async () => {
  let calls = 0;
  const gate = createNativeLiveMacExecutionAdmission({ listenerInstanceId: "listener", command: { ...command, operation: "wake", runtime_mode: "resume", parent_provider_session_id: "existing", parent_provider_checkpoint_id: "checkpoint", canonical_user_message_id: null }, relay: { async checkExecutionAdmission() { calls++; return true; } } });
  assert.equal(await gate({ phase: "input", inputId: "prepare", source: "task-notification", providerSessionId: "existing" }), true);
  assert.equal(await gate({ phase: "input", inputId: "prepare", source: "human", providerSessionId: "existing" }), false);
  assert.equal(await gate({ phase: "tool", inputId: "prepare", source: null, providerSessionId: "foreign" }), false); assert.equal(calls, 1);
});
test("unavailable relay never authorizes and caller mutation cannot retarget captured identity", async () => {
  const original = { ...command }; let captured: unknown;
  const gate = createNativeLiveMacExecutionAdmission({ listenerInstanceId: "listener", command: original, relay: { async checkExecutionAdmission(input) { captured = input.command.conversation_id; throw Error("synthetic unavailable"); } } });
  original.conversation_id = "changed";
  assert.equal(await gate({ phase: "input", inputId: "user-input", source: "human", providerSessionId: null }), false); assert.equal(captured, "conversation");
});

for (const [failure, reasonCode] of [
  [new DOMException("private token", "TimeoutError"), "RELAY_TIMEOUT"],
  [new DOMException("private token", "AbortError"), "RELAY_ABORTED"],
  [Object.assign(new TypeError("private token"), { cause: { code: "ECONNRESET" } }), "RELAY_CONNECTION_RESET"],
  [Object.assign(new Error("private token"), { relayCode: "RELAY_RESPONSE_BODY_UNAVAILABLE", httpStatus: 200 }), "RELAY_RESPONSE_BODY_UNAVAILABLE"],
  [Object.assign(new Error("private token"), { relayCode: "RELAY_RESPONSE_INVALID_JSON", httpStatus: 200 }), "RELAY_RESPONSE_INVALID_JSON"],
  [Object.assign(new Error("private token"), { httpStatus: 503 }), "RELAY_HTTP_ERROR"],
  [new Error("private token"), "RELAY_UNAVAILABLE"],
] as const) {
  test(`failed admission reports ${reasonCode} without exposing relay exception content`, async () => {
    const events: Array<Record<string, unknown>> = [];
    const gate = createNativeLiveMacExecutionAdmission({ listenerInstanceId: "listener", command,
      relay: { async checkExecutionAdmission() { throw failure; } },
      onDenied: event => events.push(event),
    });
    assert.equal(await gate({phase:"input",inputId:"user-input",source:"human",providerSessionId:null}),false);
    assert.equal(events.length,1);
    assert.equal(events[0]!.reasonCode,reasonCode);
    assert.equal(JSON.stringify(events).includes("private token"),false);
    assert.equal(JSON.stringify(events).includes("synthetic"),false,"do not log prompt text");
  });
}

test("relay false and local identity denial have distinct reason codes; diagnostics cannot authorize or throw",async()=>{
  const reasons: string[]=[];
  const gate=createNativeLiveMacExecutionAdmission({listenerInstanceId:"listener",command,
    relay:{async checkExecutionAdmission(){return false;}},onDenied:event=>{reasons.push(event.reasonCode);throw Error("logging unavailable");}});
  assert.equal(await gate({phase:"input",inputId:"other",source:"human",providerSessionId:null}),false);
  assert.equal(await gate({phase:"input",inputId:"user-input",source:"human",providerSessionId:null}),false);
  assert.deepEqual(reasons,["INPUT_ID_MISMATCH","ADMISSION_NOT_GRANTED"]);
});

for (const closeStderr of [false, true]) {
  test(`default diagnostic sink ${closeStderr ? "survives asynchronous fd failure" : "logs only bounded metadata"}`, () => {
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
      import { closeSync } from "node:fs";
      import { createNativeLiveMacExecutionAdmission } from "./src/domains/bridge/mac/native-live-mac-execution-admission.ts";
      if (${closeStderr}) closeSync(2);
      const gate = createNativeLiveMacExecutionAdmission({ listenerInstanceId: "private token",
        command: ${JSON.stringify({ ...command, prepare_id: "private token" })},
        relay: { async checkExecutionAdmission() { return false; } } });
      const admitted = await gate({ phase: "private token", inputId: "user-input", source: null, providerSessionId: null });
      // Let asynchronous write failures surface before reporting survival.
      setTimeout(() => console.log(JSON.stringify({ admitted })), 30);
    `], { encoding: "utf8", timeout: 10_000 });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { admitted: false });
    if (closeStderr) return;
    const event = JSON.parse(child.stderr.trim());
    assert.equal(event.outcome, "execution_admission_denied");
    assert.equal(event.prepareId, null);
    assert.equal(event.phase, "unknown");
    assert.equal(event.reasonCode, "ADMISSION_NOT_GRANTED");
    assert.equal(child.stderr.includes("private token"), false);
    assert.ok(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0);
  });
}

for (const operation of ["edit", "retry"] as const) for (const runtime_mode of ["new", "fork"] as const) {
  test(`${operation}/${runtime_mode} pins the admitted child session and rejects parent/foreign callbacks`, async () => {
    let calls = 0;
    const replacement = { ...command, operation, runtime_mode,
      parent_provider_session_id: runtime_mode === "fork" ? "parent" : null,
      parent_provider_checkpoint_id: runtime_mode === "fork" ? "checkpoint" : null };
    const gate = createNativeLiveMacExecutionAdmission({ listenerInstanceId: "listener", command: replacement,
      relay: { async checkExecutionAdmission() { calls++; return true; } } });
    // A retry's native input is its preparation id (see nativeInputId).
    const inputId = operation === "retry" ? "prepare" : "user-input";
    assert.equal(await gate({ phase: "input", inputId, source: "human", providerSessionId: "child" }), true);
    assert.equal(await gate({ phase: "tool", inputId, source: null, providerSessionId: "child" }), true);
    for (const providerSessionId of ["parent", "foreign"])
      assert.equal(await gate({ phase: "tool", inputId, source: null, providerSessionId }), false);
    assert.equal(calls, 2);
  });
}

// Edit and Retry rewind their own session in place (resume), as Desktop does.
test("edit/resume is admitted only for its own session", async () => {
  let calls = 0;
  const rewind = { ...command, operation: "edit" as const, runtime_mode: "resume" as const,
    parent_provider_session_id: "parent", parent_provider_checkpoint_id: "checkpoint" };
  const gate = createNativeLiveMacExecutionAdmission({ listenerInstanceId: "listener", command: rewind,
    relay: { async checkExecutionAdmission() { calls++; return true; } } });
  assert.equal(await gate({ phase: "input", inputId: "user-input", source: "human", providerSessionId: "parent" }), true);
  assert.equal(await gate({ phase: "tool", inputId: "user-input", source: null, providerSessionId: "foreign" }), false);
  assert.equal(calls, 1);
});

// The retried user message is already in the transcript under its canonical
// id, so the resent native input is identified by the fresh preparation id.
test("retry/resume is admitted only for its fresh native input id", async () => {
  let calls = 0;
  const reasons: string[] = [];
  const retry = createNativeLiveMacExecutionAdmission({ listenerInstanceId: "listener", command: { ...command, operation: "retry",
    runtime_mode: "resume", parent_provider_session_id: "parent", parent_provider_checkpoint_id: "checkpoint" },
    relay: { async checkExecutionAdmission() { calls++; return true; } }, onDenied: event => reasons.push(event.reasonCode) });
  assert.equal(await retry({ phase: "input", inputId: "user-input", source: "human", providerSessionId: "parent" }), false);
  assert.deepEqual(reasons, ["INPUT_ID_MISMATCH"]);
  assert.equal(await retry({ phase: "input", inputId: "prepare", source: "human", providerSessionId: "parent" }), true);
  assert.equal(calls, 1);
});
