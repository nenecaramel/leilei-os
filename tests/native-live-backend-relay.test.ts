import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveBackendRelayError,
  NativeLiveBackendRelayService,
  type NativeLiveBackendRelayPort,
} from "../src/domains/bridge/relay/native-live-backend-relay.js";
import type {
  NativeLiveFinalizeResult,
  NativeLivePreparedTurn,
} from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import type {
  NativeLiveRuntimeExecutionResult,
} from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";

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
    protocol_version: 4,
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
  discardedWake = false;
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

  async isDiscardedWakeReservation(input: unknown) {
    this.calls.push({ name: "isDiscardedWakeReservation", input });
    return this.discardedWake;
  }

  async markCompleted(input: unknown) {
    this.calls.push({ name: "markCompleted", input });
    return this.mutation;
  }

  async markFinalizeRejected(input: unknown) {
    this.calls.push({ name: "markFinalizeRejected", input });
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

function setup(runtimeProtocolVersion: 4 = 4) {
  const port = new FakePort();
  const coordinator = new FakeCoordinator();
  const wake = new FakeWake();
  const service = new NativeLiveBackendRelayService(
    port,
    coordinator,
    wake,
    runtimeProtocolVersion,
  );
  return { port, coordinator, wake, service };
}

test("reserve preserves v4 for a persisted modern new preparation after protocol namespace retirement", async () => {
  const { port, service } = setup(3);
  port.preparation = { ...prepared(), parentProviderCheckpointId: null };
  const reserved = await service.reserveNext({
    userId,
    listenerInstanceId,
    dispatchTarget: "claude_code",
  });
  assert.equal(reserved?.command.protocol_version, 4);
  assert.equal(reserved?.command.parent_provider_checkpoint_id, null);
});

for (const runtimeMode of ["resume", "fork"] as const) {
  test(`reserve retains the exact canonical checkpoint for modern ${runtimeMode}`, async () => {
    const { port, service } = setup(3);
    const checkpoint = "77777777-7777-4777-8777-777777777777";
    port.preparation = {
      ...prepared(),
      runtimeMode,
      parentProviderSessionId: "branch-A",
      parentProviderCheckpointId: checkpoint,
    };
    const reserved = await service.reserveNext({
      userId,
      listenerInstanceId,
      dispatchTarget: "claude_code",
    });
    assert.equal(reserved?.command.protocol_version, 4);
    assert.equal(reserved?.command.runtime_mode, runtimeMode);
    assert.equal(reserved?.command.parent_provider_checkpoint_id, checkpoint);
  });
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
      protocol_version: 4,
      dispatch_target: "claude_code",
      prepare_id: prepareId,
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      canonical_user_message_id: userMessageId,
      runtime_mode: "new",
      parent_provider_session_id: null,
      expected_working_directory: null,
      execution_selection: null,
      prompt: "hello",
    },
  });
});

test("reserve uses protocol v4 after namespace retirement", async () => {
  const { service } = setup(4);
  const reservation = await service.reserveNext({
    userId,
    listenerInstanceId,
    dispatchTarget: "claude_code",
  });

  assert.equal(reservation?.command.protocol_version, 4);
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

test("discarded wake result replay is idempotent after the invisible preparation has been deleted", async () => {
  const { port, coordinator, service } = setup();
  port.owns = false;
  port.discardedWake = true;

  const finalized = await service.submitResult({
    userId,
    listenerInstanceId,
    reservationId: prepareId,
    result: {
      protocol_version: 4,
      prepare_id: prepareId,
      request_id: requestId,
      conversation_id: conversationId,
      status: "success",
      provider_session_id: "provider-wake-replay",
      normalized_events: [
        {
          type: "result",
          payload: {
            status: "success",
            final_text: "<quiet />",
          },
        },
      ],
    },
  });

  assert.deepEqual(finalized, {
    ok: true,
    outcome: "wake_discarded",
    requestId,
    operation: "wake",
    conversationId,
    providerSessionId: "provider-wake-replay",
  });
  assert.equal(coordinator.calls.length, 0);
  assert.equal(
    port.calls.filter((entry) => entry.name === "markCompleted").length,
    0,
  );
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

test("canonical finalize conflicts become receipted terminal rejects instead of poison retries", async () => {
  const { port, coordinator, wake, service } = setup();
  coordinator.result = {
    ok: false,
    prepareId,
    requestId,
    conversationId,
    code: "FINALIZE_CONFLICT",
  };

  const finalized = await service.submitResult({
    userId,
    listenerInstanceId,
    reservationId: prepareId,
    result: failureResult(),
  });

  assert.equal(finalized.ok, false);
  if (finalized.ok) throw new Error("expected finalize conflict");
  assert.equal(finalized.code, "FINALIZE_CONFLICT");
  assert.deepEqual(
    port.calls.filter((entry) => entry.name === "markFinalizeRejected"),
    [{
      name: "markFinalizeRejected",
      input: {
        userId,
        listenerInstanceId,
        reservationId: prepareId,
        code: "FINALIZE_CONFLICT",
      },
    }],
  );
  assert.equal(
    port.calls.filter((entry) => entry.name === "markCompleted").length,
    0,
  );
  assert.deepEqual(wake.calls, [{
    userId,
    kind: "turn_terminal",
    prepareId,
  }]);
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
