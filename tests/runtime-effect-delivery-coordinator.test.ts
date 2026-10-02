import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEffectDispatchAllowed,
  assertEffectRequeueAllowed,
  assertEffectTransition,
  assertEffectUnknownReconciliationAllowed,
} from "../src/domains/runtime/effects/effect-protocol.js";
import {
  RuntimeEffectDeliveryCoordinator,
} from "../src/domains/runtime/effects/runtime-effect-delivery-coordinator.js";
import type {
  RuntimeEffectDispatchOutcome,
  RuntimeEffectPort,
  RuntimeEffectRecord,
} from "../src/domains/runtime/effects/runtime-effect-repository.js";

const userId = "22222222-2222-4222-8222-222222222222";
const effectId = "11111111-1111-4111-8111-111111111111";
const workerId = "33333333-3333-4333-8333-333333333333";

function effect(
  overrides: Partial<RuntimeEffectRecord> = {},
): RuntimeEffectRecord {
  return {
    effectId,
    userId,
    subjectId: "G",
    sourceWakeId:
      "44444444-4444-4444-8444-444444444444",
    decisionId: "decision-1",
    idempotencyKey: "a".repeat(64),
    effectType: "message_send",
    target: "conversation:c1",
    payload: { text: "hello" },
    payloadHash: "b".repeat(64),
    status: "pending",
    attempt: 0,
    retryable: true,
    reservedBy: null,
    reservedAt: null,
    reservationExpiresAt: null,
    dispatchStartedAt: null,
    createdAt: "2026-09-23T10:00:00.000Z",
    updatedAt: "2026-09-23T10:00:00.000Z",
    observedAt: null,
    failureCode: null,
    ...overrides,
  };
}

class EffectMemory implements RuntimeEffectPort {
  current: RuntimeEffectRecord | null = effect();

  async createOrGet() {
    assert.ok(this.current);
    return this.current;
  }

  async get() {
    return this.current;
  }

  async getBySourceWake() {
    return this.current;
  }

  async findNextUnknown() {
    return this.current?.status === "unknown"
      ? this.current
      : null;
  }

  async findNextRetryableFailed() {
    return (
      this.current?.status === "failed"
      && this.current.retryable
    )
      ? this.current
      : null;
  }

  async reserveNext(input: {
    userId: string;
    workerInstanceId: string;
  }) {
    if (
      !this.current
      || this.current.userId !== input.userId
      || this.current.status !== "pending"
    ) {
      return null;
    }
    this.current = effect({
      ...this.current,
      status: "reserved",
      reservedBy: input.workerInstanceId,
      reservedAt: "2026-09-23T10:01:00.000Z",
      reservationExpiresAt:
        "2026-09-23T10:02:00.000Z",
      updatedAt: "2026-09-23T10:01:00.000Z",
    });
    return this.current;
  }

  async releaseReservation() {
    assert.ok(this.current);
    this.current = effect({
      ...this.current,
      status: "pending",
      reservedBy: null,
      reservedAt: null,
      reservationExpiresAt: null,
      updatedAt: "2026-09-23T10:01:30.000Z",
    });
    return this.current;
  }

  async beginDispatch() {
    assert.ok(this.current);
    assert.equal(this.current.status, "reserved");
    this.current = effect({
      ...this.current,
      status: "dispatching",
      attempt: this.current.attempt + 1,
      dispatchStartedAt:
        "2026-09-23T10:01:40.000Z",
      reservationExpiresAt:
        "2026-09-23T10:03:40.000Z",
      updatedAt: "2026-09-23T10:01:40.000Z",
    });
    return this.current;
  }

  async completeDispatch(input: {
    result: RuntimeEffectDispatchOutcome;
  }) {
    assert.ok(this.current);
    assert.equal(this.current.status, "dispatching");
    if (input.result.outcome === "observed") {
      this.current = effect({
        ...this.current,
        status: "observed",
        retryable: false,
        reservedBy: null,
        reservedAt: null,
        reservationExpiresAt: null,
        observedAt:
          input.result.observedAt
          ?? "2026-09-23T10:02:00.000Z",
        updatedAt: "2026-09-23T10:02:00.000Z",
      });
    } else if (input.result.outcome === "failed") {
      this.current = effect({
        ...this.current,
        status: "failed",
        retryable: input.result.retryable,
        reservedBy: null,
        reservedAt: null,
        reservationExpiresAt: null,
        failureCode: input.result.failureCode,
        updatedAt: "2026-09-23T10:02:00.000Z",
      });
    } else {
      this.current = effect({
        ...this.current,
        status: "unknown",
        retryable: false,
        reservedBy: null,
        reservedAt: null,
        reservationExpiresAt: null,
        failureCode:
          input.result.failureCode
          ?? "DELIVERY_UNKNOWN",
        updatedAt: "2026-09-23T10:02:00.000Z",
      });
    }
    return this.current;
  }

  async requeueFailed() {
    assert.ok(this.current);
    assert.equal(this.current.status, "failed");
    assert.equal(this.current.retryable, true);
    this.current = effect({
      ...this.current,
      status: "pending",
      dispatchStartedAt: null,
      failureCode: null,
      updatedAt: "2026-09-23T10:03:00.000Z",
    });
    return this.current;
  }

  async reconcileUnknown(input: {
    resolution:
      | { outcome: "observed"; observedAt?: string }
      | {
          outcome: "failed";
          failureCode: string;
          retryable: boolean;
        };
  }) {
    assert.ok(this.current);
    assert.equal(this.current.status, "unknown");
    if (input.resolution.outcome === "observed") {
      this.current = effect({
        ...this.current,
        status: "observed",
        retryable: false,
        observedAt:
          input.resolution.observedAt
          ?? "2026-09-23T10:04:00.000Z",
        failureCode: null,
      });
    } else {
      this.current = effect({
        ...this.current,
        status: "failed",
        retryable: input.resolution.retryable,
        failureCode: input.resolution.failureCode,
      });
    }
    return this.current;
  }
}

test("Effect Protocol encodes reservation, dispatch and reconciliation boundaries", () => {
  assert.doesNotThrow(() =>
    assertEffectTransition("pending", "reserved"),
  );
  assert.doesNotThrow(() =>
    assertEffectTransition("reserved", "dispatching"),
  );
  assert.doesNotThrow(() =>
    assertEffectTransition("dispatching", "unknown"),
  );
  assert.doesNotThrow(() =>
    assertEffectTransition("unknown", "observed"),
  );
  assert.throws(
    () => assertEffectTransition("unknown", "pending"),
    /Invalid effect transition/,
  );

  assert.doesNotThrow(() =>
    assertEffectDispatchAllowed({
      mode: "live",
      effect: effect({
        status: "reserved",
        reservedBy: workerId,
        reservedAt: "2026-09-23T10:01:00.000Z",
        reservationExpiresAt:
          "2026-09-23T10:02:00.000Z",
      }),
    }),
  );
  assert.throws(
    () =>
      assertEffectDispatchAllowed({
        mode: "live",
        effect: effect({ status: "pending" }),
      }),
    /Only a reserved effect/,
  );
  assert.throws(
    () =>
      assertEffectDispatchAllowed({
        mode: "replay",
        effect: effect({
          status: "reserved",
          reservedBy: workerId,
          reservedAt: "2026-09-23T10:01:00.000Z",
          reservationExpiresAt:
            "2026-09-23T10:02:00.000Z",
        }),
      }),
    /Replay is effect-silent/,
  );

  assert.doesNotThrow(() =>
    assertEffectRequeueAllowed(
      effect({
        status: "failed",
        retryable: true,
        dispatchStartedAt:
          "2026-09-23T10:00:00.000Z",
        failureCode: "KNOWN_FAILURE",
      }),
    ),
  );
  assert.throws(
    () =>
      assertEffectUnknownReconciliationAllowed(
        effect({ status: "pending" }),
      ),
    /Only unknown effects/,
  );
});

test("foreground blocks reservation before any dispatch state is entered", async () => {
  const effects = new EffectMemory();
  const coordinator =
    new RuntimeEffectDeliveryCoordinator(
      effects,
      {
        async isForegroundActive() {
          return true;
        },
      },
    );

  assert.deepEqual(
    await coordinator.reserveNext({
      userId,
      workerInstanceId: workerId,
    }),
    { outcome: "foreground_active" },
  );
  assert.equal(effects.current?.status, "pending");
});

test("foreground that appears after reservation releases it instead of dispatching", async () => {
  const effects = new EffectMemory();
  let checks = 0;
  const coordinator =
    new RuntimeEffectDeliveryCoordinator(
      effects,
      {
        async isForegroundActive() {
          checks += 1;
          return checks >= 2;
        },
      },
    );

  const reserved = await coordinator.reserveNext({
    userId,
    workerInstanceId: workerId,
  });
  assert.equal(reserved.outcome, "reserved");

  const begin = await coordinator.beginDispatch({
    userId,
    effectId,
    workerInstanceId: workerId,
  });
  assert.deepEqual(begin, {
    outcome: "foreground_active",
  });
  assert.equal(effects.current?.status, "pending");
  assert.equal(effects.current?.attempt, 0);
});

test("known delivery result reaches observed only after beginDispatch increments the attempt", async () => {
  const effects = new EffectMemory();
  const coordinator =
    new RuntimeEffectDeliveryCoordinator(
      effects,
      {
        async isForegroundActive() {
          return false;
        },
      },
    );

  await coordinator.reserveNext({
    userId,
    workerInstanceId: workerId,
  });
  const begun = await coordinator.beginDispatch({
    userId,
    effectId,
    workerInstanceId: workerId,
  });
  assert.equal(begun.outcome, "dispatching");
  if (begun.outcome !== "dispatching") return;
  assert.equal(begun.effect.attempt, 1);

  const observed = await coordinator.completeDispatch({
    userId,
    effectId,
    workerInstanceId: workerId,
    result: {
      outcome: "observed",
      observedAt: "2026-09-23T10:02:00.000Z",
    },
  });
  assert.equal(observed.status, "observed");
  assert.equal(observed.retryable, false);
});

test("unknown delivery never blind-retries; reconciliation must resolve it first", async () => {
  const effects = new EffectMemory();
  const coordinator =
    new RuntimeEffectDeliveryCoordinator(
      effects,
      {
        async isForegroundActive() {
          return false;
        },
      },
    );

  await coordinator.reserveNext({
    userId,
    workerInstanceId: workerId,
  });
  await coordinator.beginDispatch({
    userId,
    effectId,
    workerInstanceId: workerId,
  });
  const unknown = await coordinator.completeDispatch({
    userId,
    effectId,
    workerInstanceId: workerId,
    result: {
      outcome: "unknown",
      failureCode: "NETWORK_RESULT_UNKNOWN",
    },
  });
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.retryable, false);

  await assert.rejects(
    () => coordinator.requeueFailed({ userId, effectId }),
    /Only retryable failed effects/,
  );

  const reconciled = await coordinator.reconcileUnknown({
    userId,
    effectId,
    resolution: {
      outcome: "failed",
      failureCode: "CONFIRMED_NOT_DELIVERED",
      retryable: true,
    },
  });
  assert.equal(reconciled.status, "failed");
  assert.equal(reconciled.retryable, true);

  const pending = await coordinator.requeueFailed({
    userId,
    effectId,
  });
  assert.equal(pending.status, "pending");
  assert.equal(pending.attempt, 1);
});
