import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveBackendRelayError,
  NativeLiveBackendRelayService,
  type NativeLiveBackendRelayPort,
} from "../src/domains/bridge/native-live-backend-relay.js";
import type {
  NativeLiveFinalizeResult,
  NativeLivePreparedTurn,
} from "../src/domains/bridge/native-live-backend-turn-coordinator.js";
import type {
  NativeLiveRuntimeExecutionResult,
} from "../src/domains/bridge/native-live-runtime-protocol.js";

const userId = "11111111-1111-4111-8111-111111111111";
const listenerInstanceId = "22222222-2222-4222-8222-222222222222";
const prepareId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const conversationId = "55555555-5555-4555-8555-555555555555";
const userMessageId = "66666666-6666-4666-8666-666666666666";

function prepared(): NativeLivePreparedTurn {
  return {
    prepareId,
    requestId,
    userId,
    conversationId,
    operation: "send",
    canonicalUserMessageId: userMessageId,
    runtimeMode: "new",
    parentProviderSessionId: null,
    prompt: "hello",
    mindPrepared: false,
  };
}

function failureResult(): NativeLiveRuntimeExecutionResult {
  return {
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "CLAUDE_PROCESS_FAILED",
  };
}

class FakePort implements NativeLiveBackendRelayPort {
  lease: "acquired" | "renewed" | "busy" = "acquired";
  preparation: NativeLivePreparedTurn | null = prepared();
  owns = true;
  mutation:
    | "applied"
    | "idempotent"
    | "not_found"
    | "conflict" = "applied";
  calls: Array<{ name: string; input: unknown }> = [];

  async enqueuePreparation(input: unknown) {
    this.calls.push({ name: "enqueuePreparation", input });
    return this.mutation;
  }

  async renewLease(input: unknown) {
    this.calls.push({ name: "renewLease", input });
    return this.lease;
  }

  async reserveNext(input: unknown) {
    this.calls.push({ name: "reserveNext", input });
    return this.preparation;
  }

  async markExecutionStarted(input: unknown) {
    this.calls.push({ name: "markExecutionStarted", input });
    return this.mutation;
  }

  async ownsSubmitReservation(input: unknown) {
    this.calls.push({ name: "ownsSubmitReservation", input });
    return this.owns;
  }

  async markCompleted(input: unknown) {
    this.calls.push({ name: "markCompleted", input });
    return this.mutation;
  }

  async markDeliveryUnknown(input: unknown) {
    this.calls.push({ name: "markDeliveryUnknown", input });
    return this.mutation;
  }

  async rejectReservation(input: unknown) {
    this.calls.push({ name: "rejectReservation", input });
    return this.mutation;
  }
}

class FakeCoordinator {
  calls: unknown[] = [];
  result: NativeLiveFinalizeResult = {
    ok: false,
    prepareId,
    requestId,
    conversationId,
    code: "CLAUDE_PROCESS_FAILED",
  };

  async finalize(user: string, result: unknown) {
    this.calls.push({ user, result });
    return this.result;
  }
}

class FakeWake {
  calls: unknown[] = [];

  async notify(input: unknown) {
    this.calls.push(input);
  }
}

function setup() {
  const port = new FakePort();
  const coordinator = new FakeCoordinator();
  const wake = new FakeWake();
  const service = new NativeLiveBackendRelayService(
    port,
    coordinator,
    wake,
  );
  return { port, coordinator, wake, service };
}

test("reserve emits the persisted prepared command without rebuilding it on the Mac", async () => {
  const { service } = setup();
  const reservation = await service.reserveNext({
    userId,
    listenerInstanceId,
    dispatchTarget: "claude_code",
  });

  assert.deepEqual(reservation, {
    reservationId: prepareId,
    command: {
      protocol_version: 1,
      dispatch_target: "claude_code",
      prepare_id: prepareId,
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      canonical_user_message_id: userMessageId,
      runtime_mode: "new",
      parent_provider_session_id: null,
      workspace_id: null,
      expected_workspace_root: null,
      execution_selection: null,
      prompt: "hello",
    },
  });
});

test("runtime failure is a valid terminal callback, closes the reservation, and wakes turn waiters", async () => {
  const { port, coordinator, wake, service } = setup();
  const result = failureResult();

  const finalized = await service.submitResult({
    userId,
    listenerInstanceId,
    reservationId: prepareId,
    result,
  });

  assert.equal(finalized.ok, false);
  if (finalized.ok) throw new Error("expected runtime failure result");
  assert.equal(finalized.code, "CLAUDE_PROCESS_FAILED");
  assert.equal(coordinator.calls.length, 1);
  assert.equal(
    port.calls.filter((entry) => entry.name === "markCompleted").length,
    1,
  );
  assert.deepEqual(wake.calls, [{
    userId,
    kind: "turn_terminal",
    prepareId,
  }]);
});

test("reservation identity mismatch is rejected before canonical finalize", async () => {
  const { coordinator, service } = setup();
  const result = failureResult();

  await assert.rejects(
    () =>
      service.submitResult({
        userId,
        listenerInstanceId,
        reservationId: "77777777-7777-4777-8777-777777777777",
        result,
      }),
    (error: unknown) =>
      error instanceof NativeLiveBackendRelayError
      && error.code === "RESERVATION_CONFLICT",
  );
  assert.equal(coordinator.calls.length, 0);
});

test("canonical finalize conflicts do not mark transport complete", async () => {
  const { port, coordinator, service } = setup();
  coordinator.result = {
    ok: false,
    prepareId,
    requestId,
    conversationId,
    code: "FINALIZE_CONFLICT",
  };

  await assert.rejects(
    () =>
      service.submitResult({
        userId,
        listenerInstanceId,
        reservationId: prepareId,
        result: failureResult(),
      }),
    (error: unknown) =>
      error instanceof NativeLiveBackendRelayError
      && error.code === "FINALIZE_REJECTED",
  );

  assert.equal(
    port.calls.filter((entry) => entry.name === "markCompleted").length,
    0,
  );
});

test("relay mutations accept applied/idempotent outcomes and reject stale ownership", async () => {
  const { port, wake, service } = setup();

  port.mutation = "idempotent";
  await service.markExecutionStarted({
    userId,
    listenerInstanceId,
    reservationId: prepareId,
  });
  await service.markResultDeliveryUnknown({
    userId,
    listenerInstanceId,
    reservationId: prepareId,
  });
  await service.rejectReservation({
    userId,
    listenerInstanceId,
    reservationId: prepareId,
    code: "INVALID_COMMAND",
  });
  assert.deepEqual(wake.calls, [{
    userId,
    kind: "turn_terminal",
    prepareId,
  }]);

  port.mutation = "conflict";
  await assert.rejects(
    () =>
      service.rejectReservation({
        userId,
        listenerInstanceId,
        reservationId: prepareId,
        code: "INVALID_COMMAND",
      }),
    (error: unknown) =>
      error instanceof NativeLiveBackendRelayError
      && error.code === "RESERVATION_CONFLICT",
  );
  assert.equal(wake.calls.length, 1);
});
