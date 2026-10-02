import assert from "node:assert/strict";
import test from "node:test";
import {
  RuntimeMessageEffectDeliveryAdapter,
} from "../src/domains/runtime/effects/runtime-message-effect-delivery-adapter.js";
import type {
  RuntimeEffectRecord,
} from "../src/domains/runtime/effects/runtime-effect-repository.js";

function effect(
  overrides: Partial<RuntimeEffectRecord> = {},
): RuntimeEffectRecord {
  return {
    effectId:
      "11111111-1111-4111-8111-111111111111",
    userId:
      "22222222-2222-4222-8222-222222222222",
    subjectId: "G",
    sourceWakeId:
      "33333333-3333-4333-8333-333333333333",
    decisionId: "decision-1",
    idempotencyKey: "a".repeat(64),
    effectType: "message_send",
    target:
      "conversation:44444444-4444-4444-8444-444444444444",
    payload: { text: "hello" },
    payloadHash: "b".repeat(64),
    status: "dispatching",
    attempt: 1,
    retryable: true,
    reservedBy:
      "55555555-5555-4555-8555-555555555555",
    reservedAt: "2026-09-23T11:00:00.000Z",
    reservationExpiresAt:
      "2026-09-23T11:02:00.000Z",
    dispatchStartedAt:
      "2026-09-23T11:00:10.000Z",
    createdAt: "2026-09-23T10:59:00.000Z",
    updatedAt: "2026-09-23T11:00:10.000Z",
    observedAt: null,
    failureCode: null,
    ...overrides,
  };
}

test("message delivery adapter rejects invalid target before touching canonical storage", async () => {
  let touched = false;
  const adapter =
    new RuntimeMessageEffectDeliveryAdapter({
      transaction() {
        touched = true;
        throw new Error("must not touch database");
      },
    } as never);

  assert.deepEqual(
    await adapter.deliver({
      effect: effect({ target: "not-a-conversation" }),
      workerInstanceId:
        "55555555-5555-4555-8555-555555555555",
    }),
    {
      outcome: "failed",
      failureCode: "TARGET_INVALID",
      retryable: false,
    },
  );
  assert.equal(touched, false);
});

test("message delivery adapter rejects invalid payload before touching canonical storage", async () => {
  let touched = false;
  const adapter =
    new RuntimeMessageEffectDeliveryAdapter({
      transaction() {
        touched = true;
        throw new Error("must not touch database");
      },
    } as never);

  assert.deepEqual(
    await adapter.deliver({
      effect: effect({ payload: { text: "   " } }),
      workerInstanceId:
        "55555555-5555-4555-8555-555555555555",
    }),
    {
      outcome: "failed",
      failureCode: "PAYLOAD_INVALID",
      retryable: false,
    },
  );
  assert.equal(touched, false);
});
