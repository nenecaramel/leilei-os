import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacBackgroundModelExecutor,
} from "../src/domains/bridge/native-live-mac-background-model-executor.js";

const taskId = "11111111-1111-4111-8111-111111111111";

function command() {
  return {
    protocol_version: 1,
    task_id: taskId,
    task_kind: "proactivity_deliberate",
    prompt_contract_version: "topic-resurface-deliberation-v1",
    prompt: "deliberate",
  };
}

test("Mac background executor returns final pure text without exposing provider/session events", async () => {
  const prompts: string[] = [];
  const executor = new NativeLiveMacBackgroundModelExecutor({
    async sendNew(prompt: string) {
      prompts.push(prompt);
      return {
        providerSessionId: "provider-private",
        normalizedEvents: [{
          type: "result" as const,
          payload: {
            status: "success",
            final_text: '{"decision":"quiet"}',
          },
        }],
      };
    },
  });

  assert.deepEqual(await executor.execute(command()), {
    protocol_version: 1,
    task_id: taskId,
    task_kind: "proactivity_deliberate",
    status: "success",
    final_text: '{"decision":"quiet"}',
  });
  assert.deepEqual(prompts, ["deliberate"]);
});

test("Mac background executor fails closed on tool use", async () => {
  const executor = new NativeLiveMacBackgroundModelExecutor({
    async sendNew() {
      return {
        providerSessionId: "provider-private",
        normalizedEvents: [
          {
            type: "tool_use" as const,
            payload: { name: "anything" },
          },
          {
            type: "result" as const,
            payload: {
              status: "success",
              final_text: '{"decision":"quiet"}',
            },
          },
        ],
      };
    },
  });

  assert.deepEqual(await executor.execute(command()), {
    protocol_version: 1,
    task_id: taskId,
    task_kind: "proactivity_deliberate",
    status: "failure",
    error_code: "TOOL_USE_FORBIDDEN",
  });
});

test("Mac background executor fails closed on empty or error runtime output", async () => {
  const empty = new NativeLiveMacBackgroundModelExecutor({
    async sendNew() {
      return {
        providerSessionId: "provider-private",
        normalizedEvents: [],
      };
    },
  });
  assert.equal(
    (await empty.execute(command())).status,
    "failure",
  );

  const runtimeError = new NativeLiveMacBackgroundModelExecutor({
    async sendNew() {
      return {
        providerSessionId: "provider-private",
        normalizedEvents: [{
          type: "result" as const,
          payload: { status: "error" },
        }],
      };
    },
  });
  assert.deepEqual(await runtimeError.execute(command()), {
    protocol_version: 1,
    task_id: taskId,
    task_kind: "proactivity_deliberate",
    status: "failure",
    error_code: "RUNTIME_OUTPUT_ERROR",
  });
});

test("Mac background executor maps Claude runtime failure without fabricating model output", async () => {
  const executor = new NativeLiveMacBackgroundModelExecutor({
    async sendNew() {
      throw Object.assign(new Error("aborted"), {
        runtimeCode: "ABORTED",
      });
    },
  });

  assert.deepEqual(await executor.execute(command()), {
    protocol_version: 1,
    task_id: taskId,
    task_kind: "proactivity_deliberate",
    status: "failure",
    error_code: "ABORTED",
  });
});


test("Mac background executor runs Proactivity deliberation through the same pure-model contract", async () => {
  const taskId =
    "44444444-4444-4444-8444-444444444444";
  const prompts: string[] = [];
  const executor = new NativeLiveMacBackgroundModelExecutor({
    async sendNew(prompt: string) {
      prompts.push(prompt);
      return {
        providerSessionId: "provider-private",
        normalizedEvents: [{
          type: "result" as const,
          payload: {
            status: "success",
            final_text: '{"outcome":"reflect"}',
          },
        }],
      };
    },
  });

  assert.deepEqual(
    await executor.execute({
      protocol_version: 1,
      task_id: taskId,
      task_kind: "proactivity_deliberate",
      prompt_contract_version:
        "proactivity-wake-deliberation-v1",
      prompt: "pure deliberation",
    }),
    {
      protocol_version: 1,
      task_id: taskId,
      task_kind: "proactivity_deliberate",
      status: "success",
      final_text: '{"outcome":"reflect"}',
    },
  );
  assert.deepEqual(prompts, ["pure deliberation"]);
});
