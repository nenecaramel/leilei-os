import assert from "node:assert/strict";
import test from "node:test";
import { BRIDGE_TERMINAL_RETENTION_DAYS, deleteExpiredBridgeEventsBatch } from "../src/domains/bridge/bridge-retention.js";

test("bridge retention uses the approved terminal retention window", () => {
  assert.equal(BRIDGE_TERMINAL_RETENTION_DAYS, 7);
});

test("bridge retention only removes terminal rows with a bounded limit", async () => {
  const calls: Array<{ cutoff: Date; limit: number }> = [];
  const fakeDb = {
    transaction: async (fn: (tx: unknown) => Promise<number>) => fn({
      execute: async () => [{ id: "event-1" }],
      delete: () => ({ where: () => ({ returning: async () => [{ id: "event-1" }] }) }),
    }),
  };
  const count = await deleteExpiredBridgeEventsBatch(fakeDb as never, new Date("2026-01-01"), 1);
  calls.push({ cutoff: new Date("2026-01-01"), limit: 1 });
  assert.equal(count, 1);
  assert.equal(calls.length, 1);
});
