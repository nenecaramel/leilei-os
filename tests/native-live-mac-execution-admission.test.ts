import assert from "node:assert/strict";
import test from "node:test";
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

for (const operation of ["edit", "retry"] as const) for (const runtime_mode of ["new", "fork"] as const) {
  test(`${operation}/${runtime_mode} pins the admitted child session and rejects parent/foreign callbacks`, async () => {
    let calls = 0;
    const replacement = { ...command, operation, runtime_mode,
      parent_provider_session_id: runtime_mode === "fork" ? "parent" : null,
      parent_provider_checkpoint_id: runtime_mode === "fork" ? "checkpoint" : null };
    const gate = createNativeLiveMacExecutionAdmission({ listenerInstanceId: "listener", command: replacement,
      relay: { async checkExecutionAdmission() { calls++; return true; } } });
    assert.equal(await gate({ phase: "input", inputId: "user-input", source: "human", providerSessionId: "child" }), true);
    assert.equal(await gate({ phase: "tool", inputId: "user-input", source: null, providerSessionId: "child" }), true);
    for (const providerSessionId of ["parent", "foreign"])
      assert.equal(await gate({ phase: "tool", inputId: "user-input", source: null, providerSessionId }), false);
    assert.equal(calls, 2);
  });
}
