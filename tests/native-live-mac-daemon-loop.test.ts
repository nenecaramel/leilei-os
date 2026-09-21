import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacDaemonLoop,
  type NativeLiveMacDaemonRelayClient,
  type NativeLivePreparedCommandExecutor,
} from "../src/domains/bridge/native-live-mac-daemon-loop.js";
import type {
  NativeLiveRuntimeCommand,
  NativeLiveRuntimeExecutionResult,
} from "../src/domains/bridge/native-live-runtime-protocol.js";

const listenerInstanceId = "11111111-1111-4111-8111-111111111111";
const reservationId = "22222222-2222-4222-8222-222222222222";
const prepareId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const conversationId = "55555555-5555-4555-8555-555555555555";
const userMessageId = "66666666-6666-4666-8666-666666666666";

function command(): NativeLiveRuntimeCommand {
  return {
    protocol_version: 1,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    prompt: "hello",
  };
}

function success(): NativeLiveRuntimeExecutionResult {
  return {
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-new",
    normalized_events: [],
  };
}

class FakeRelay implements NativeLiveMacDaemonRelayClient {
  lease: "acquired" | "renewed" | "busy" = "acquired";
  reservation: { reservationId: string; command: NativeLiveRuntimeCommand } | null = {
    reservationId,
    command: command(),
  };
  calls: Array<{ name: string; input: unknown }> = [];
  startError: Error | null = null;
  submitError: Error | null = null;

  async renewLease(input: unknown) {
    this.calls.push({ name: "renewLease", input });
    return this.lease;
  }

  async reserveNext(input: unknown) {
    this.calls.push({ name: "reserveNext", input });
    return this.reservation;
  }

  async markExecutionStarted(input: unknown) {
    this.calls.push({ name: "markExecutionStarted", input });
    if (this.startError) throw this.startError;
  }

  async submitResult(input: unknown) {
    this.calls.push({ name: "submitResult", input });
    if (this.submitError) throw this.submitError;
  }

  async markResultDeliveryUnknown(input: unknown) {
    this.calls.push({ name: "markResultDeliveryUnknown", input });
  }

  async rejectReservation(input: unknown) {
    this.calls.push({ name: "rejectReservation", input });
  }
}

class FakeExecutor implements NativeLivePreparedCommandExecutor {
  calls: unknown[] = [];
  value: NativeLiveRuntimeExecutionResult = success();
  error: Error | null = null;

  async execute(input: unknown) {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.value;
  }
}

function setup() {
  const relay = new FakeRelay();
  const executor = new FakeExecutor();
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
  );
  return { relay, executor, loop };
}

test("busy target lease prevents reservation and execution", async () => {
  const { relay, executor, loop } = setup();
  relay.lease = "busy";

  assert.deepEqual(await loop.runOnce(), { outcome: "busy" });
  assert.deepEqual(executor.calls, []);
  assert.deepEqual(relay.calls.map((entry) => entry.name), ["renewLease"]);
});

test("empty targeted queue returns idle without invoking Claude", async () => {
  const { relay, executor, loop } = setup();
  relay.reservation = null;

  assert.deepEqual(await loop.runOnce(), { outcome: "idle" });
  assert.deepEqual(executor.calls, []);
  assert.deepEqual(
    relay.calls.map((entry) => entry.name),
    ["renewLease", "reserveNext"],
  );
});

test("reserved command is marked started, executed once, then submitted once", async () => {
  const { relay, executor, loop } = setup();

  const outcome = await loop.runOnce();

  assert.deepEqual(outcome, {
    outcome: "completed",
    reservationId,
    result: success(),
  });
  assert.deepEqual(executor.calls, [command()]);
  assert.deepEqual(relay.calls.map((entry) => entry.name), [
    "renewLease",
    "reserveNext",
    "markExecutionStarted",
    "submitResult",
  ]);
  const submit = relay.calls.at(-1)?.input as {
    listenerInstanceId: string;
    reservationId: string;
    result: NativeLiveRuntimeExecutionResult;
  };
  assert.equal(submit.listenerInstanceId, listenerInstanceId);
  assert.equal(submit.reservationId, reservationId);
  assert.deepEqual(submit.result, success());
});

test("execution-start failure rejects reservation and never invokes Claude", async () => {
  const { relay, executor, loop } = setup();
  relay.startError = new Error("start callback failed");

  assert.deepEqual(await loop.runOnce(), {
    outcome: "rejected",
    reservationId,
    code: "EXECUTION_START_FAILED",
  });
  assert.deepEqual(executor.calls, []);
  assert.deepEqual(relay.calls.map((entry) => entry.name), [
    "renewLease",
    "reserveNext",
    "markExecutionStarted",
    "rejectReservation",
  ]);
});

test("invalid prepared command rejection never submits a fabricated runtime result", async () => {
  const { relay, executor, loop } = setup();
  executor.error = new Error("invalid command");

  assert.deepEqual(await loop.runOnce(), {
    outcome: "rejected",
    reservationId,
    code: "INVALID_COMMAND",
  });
  assert.deepEqual(relay.calls.map((entry) => entry.name), [
    "renewLease",
    "reserveNext",
    "markExecutionStarted",
    "rejectReservation",
  ]);
});

test("ambiguous result callback is quarantined and never blindly resubmitted", async () => {
  const { relay, executor, loop } = setup();
  relay.submitError = new Error("timeout after write");

  assert.deepEqual(await loop.runOnce(), {
    outcome: "delivery_unknown",
    reservationId,
    result: success(),
  });
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(relay.calls.map((entry) => entry.name), [
    "renewLease",
    "reserveNext",
    "markExecutionStarted",
    "submitResult",
    "markResultDeliveryUnknown",
  ]);
  assert.equal(
    relay.calls.filter((entry) => entry.name === "submitResult").length,
    1,
  );
});

test("runOnce rejects reentrant polling while an execution is in flight", async () => {
  const relay = new FakeRelay();
  let resolveExecute!: (value: NativeLiveRuntimeExecutionResult) => void;
  const executor: NativeLivePreparedCommandExecutor = {
    execute: () =>
      new Promise<NativeLiveRuntimeExecutionResult>((resolve) => {
        resolveExecute = resolve;
      }),
  };
  const loop = new NativeLiveMacDaemonLoop(
    listenerInstanceId,
    relay,
    executor,
  );

  const first = loop.runOnce();
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    () => loop.runOnce(),
    (error: unknown) =>
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "NATIVE_LIVE_DAEMON_REENTRANT",
  );

  resolveExecute(success());
  assert.equal((await first).outcome, "completed");
});
