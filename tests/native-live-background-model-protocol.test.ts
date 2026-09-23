import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBackgroundModelResultMatchesCommand,
  parseNativeLiveBackgroundModelCommand,
  parseNativeLiveBackgroundModelExecutionResult,
} from "../src/domains/bridge/native-live-background-model-protocol.js";

const taskId = "11111111-1111-4111-8111-111111111111";

function command() {
  return {
    protocol_version: 1,
    task_id: taskId,
    task_kind: "topic_resurface_evaluate",
    prompt_contract_version: "topic-resurface-eval-v1",
    prompt: "evaluate",
  };
}

test("background model command is identity-free and strictly bounded", () => {
  assert.deepEqual(
    parseNativeLiveBackgroundModelCommand(command()),
    command(),
  );

  assert.throws(
    () => parseNativeLiveBackgroundModelCommand({
      ...command(),
      user_id: "22222222-2222-4222-8222-222222222222",
    }),
    /Unexpected background model protocol field: user_id/,
  );
  assert.throws(
    () => parseNativeLiveBackgroundModelCommand({
      ...command(),
      task_kind: "arbitrary_model_job",
    }),
    /task kind is invalid/,
  );
});

test("background model result carries only task identity and bounded pure text", () => {
  const result = parseNativeLiveBackgroundModelExecutionResult({
    protocol_version: 1,
    task_id: taskId,
    task_kind: "topic_resurface_evaluate",
    status: "success",
    final_text: '{"decision":"quiet"}',
  });
  assert.deepEqual(result, {
    protocol_version: 1,
    task_id: taskId,
    task_kind: "topic_resurface_evaluate",
    status: "success",
    final_text: '{"decision":"quiet"}',
  });

  assert.throws(
    () => parseNativeLiveBackgroundModelExecutionResult({
      ...result,
      normalized_events: [],
    }),
    /Unexpected background model protocol field: normalized_events/,
  );
});

test("background model result must match command task identity", () => {
  const parsed = parseNativeLiveBackgroundModelCommand(command());
  const result = parseNativeLiveBackgroundModelExecutionResult({
    protocol_version: 1,
    task_id: taskId,
    task_kind: "topic_resurface_evaluate",
    status: "failure",
    error_code: "RUNTIME_UNAVAILABLE",
  });
  assert.doesNotThrow(
    () => assertBackgroundModelResultMatchesCommand(parsed, result),
  );

  const wrong = parseNativeLiveBackgroundModelExecutionResult({
    protocol_version: 1,
    task_id: taskId,
    task_kind: "topic_resurface_retention",
    status: "failure",
    error_code: "RUNTIME_UNAVAILABLE",
  });
  assert.throws(
    () => assertBackgroundModelResultMatchesCommand(parsed, wrong),
    /does not match command identity/,
  );
});
