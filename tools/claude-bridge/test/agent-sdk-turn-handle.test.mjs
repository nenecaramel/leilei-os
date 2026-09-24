import assert from "node:assert/strict";
import test from "node:test";
import {
  startAgentSdkTurn,
} from "../src/agent-sdk-turn-handle.mjs";

function successMessages(sessionId = "provider-turn") {
  return [
    {
      type: "system",
      subtype: "init",
      session_id: sessionId,
    },
    {
      type: "assistant",
      session_id: sessionId,
      message: {
        content: [{ type: "text", text: "READY" }],
      },
    },
    {
      type: "result",
      subtype: "success",
      session_id: sessionId,
      result: "READY",
    },
  ];
}

test("turn handle completes a normal SDK turn without changing the phase-1 transport", async () => {
  let call;
  const handle = await startAgentSdkTurn({
    prompt: "hello",
    environment: {},
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const message of successMessages()) {
            yield message;
          }
        },
      };
    },
  });

  assert.equal(
    typeof call.prompt?.[Symbol.asyncIterator],
    "function",
  );
  const result = await handle.completion;
  assert.equal(
    result.providerSessionId,
    "provider-turn",
  );
  assert.deepEqual(
    result.normalizedEvents.map((event) => event.type),
    ["session", "text", "result"],
  );
});

test("turn handle maps a successful graceful interrupt to INTERRUPTED", async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const startedGate = new Promise((resolve) => {
    started = resolve;
  });

  const handle = await startAgentSdkTurn({
    prompt: "long task",
    environment: {},
    queryImpl: () => ({
      close() {},
      async interrupt() {
        release();
        return { still_queued: [] };
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-interrupt",
        };
        started();
        await gate;
        yield {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          session_id: "provider-interrupt",
          errors: ["interrupt diagnostic"],
        };
        throw new Error(
          "Claude Code returned an error result: interrupt diagnostic",
        );
      },
    }),
  });

  await startedGate;
  const receipt = await handle.interrupt();
  assert.deepEqual(receipt, { still_queued: [] });

  await assert.rejects(
    handle.completion,
    (error) =>
      error.runtimeCode === "INTERRUPTED"
      && error.providerSessionId === "provider-interrupt"
      && error.interruptReceipt?.still_queued?.length === 0,
  );
});

test("turn handle hard abort remains separate from graceful interrupt", async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const startedGate = new Promise((resolve) => {
    started = resolve;
  });

  const handle = await startAgentSdkTurn({
    prompt: "long task",
    environment: {},
    queryImpl: () => ({
      close() {
        release();
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-abort",
        };
        started();
        await gate;
      },
    }),
  });

  await startedGate;
  handle.abort();

  await assert.rejects(
    handle.completion,
    (error) => error.runtimeCode === "ABORTED",
  );
});
