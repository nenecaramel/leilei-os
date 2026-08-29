import assert from "node:assert/strict";
import test from "node:test";
import { bridgeEvents, bridgeListenerLeases } from "../src/database/schema.js";

test("Bridge tables expose the lifecycle columns needed by the queue contract", () => {
  assert.equal(bridgeEvents[Symbol.for("drizzle:Name")], "bridge_events");
  assert.equal(
    bridgeListenerLeases[Symbol.for("drizzle:Name")],
    "bridge_listener_leases",
  );

  for (const column of [
    "id",
    "userId",
    "idempotencyKey",
    "requestHash",
    "kind",
    "source",
    "visibleText",
    "modelContext",
    "status",
    "reservedBy",
    "reservedAt",
    "reservationExpiresAt",
    "dispatchStartedAt",
    "hostSentAt",
    "deliveryUnknownAt",
    "retryCount",
    "lastErrorCode",
    "processingState",
    "modelClaimedAt",
    "modelCompletedAt",
    "deliveryReconciledAt",
  ]) {
    assert.ok(column in bridgeEvents, `bridgeEvents.${column} is missing`);
  }

  for (const column of [
    "userId",
    "listenerInstanceId",
    "leaseExpiresAt",
    "updatedAt",
  ]) {
    assert.ok(
      column in bridgeListenerLeases,
      `bridgeListenerLeases.${column} is missing`,
    );
  }
});
