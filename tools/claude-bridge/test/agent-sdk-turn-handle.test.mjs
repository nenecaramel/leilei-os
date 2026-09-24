import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentSdkTurnHandle,
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
  const handle = await createAgentSdkTurnHandle({
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
  assert.equal(handle.completion, null);
  const result = await handle.start();
  assert.equal(
    result.providerSessionId,
    "provider-turn",
  );
  assert.deepEqual(
    result.normalizedEvents.map((event) => event.type),
    ["session", "text", "result"],
  );
});


test("turn handle emits nothing before explicit start", async () => {
  let iteratorStarted = false;
  const handle = await createAgentSdkTurnHandle({
    prompt: "hello",
    environment: {},
    queryImpl: () => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        iteratorStarted = true;
        for (const message of successMessages("provider-explicit-start")) {
          yield message;
        }
      },
    }),
  });

  const emitted = [];
  handle.events.on("normalized-event", (event) => {
    emitted.push(event);
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(iteratorStarted, false);
  assert.deepEqual(emitted, []);

  const result = await handle.start();
  assert.equal(iteratorStarted, true);
  assert.equal(
    result.providerSessionId,
    "provider-explicit-start",
  );
  assert.equal(emitted.length, 3);
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

  const handle = await createAgentSdkTurnHandle({
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

  const completion = handle.start();
  await startedGate;
  const receipt = await handle.interrupt();
  assert.deepEqual(receipt, { still_queued: [] });

  await assert.rejects(
    completion,
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

  const handle = await createAgentSdkTurnHandle({
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

  const completion = handle.start();
  await startedGate;
  handle.abort();

  await assert.rejects(
    completion,
    (error) => error.runtimeCode === "ABORTED",
  );
});
