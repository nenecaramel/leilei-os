import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateLifecycle,
  MemoryLifecycleService,
  type MemoryLifecyclePolicy,
} from "../src/domains/runtime/memory-lifecycle.js";

const policy: MemoryLifecyclePolicy = {
  halfLifeHours: { memory: 24, feel: 12 },
  fadingThreshold: 0.7,
  archiveThreshold: 0.2,
};

test("lifecycle initializes lazily instead of inventing an age for pre-existing state", () => {
  const update = evaluateLifecycle(
    {
      stateId: "m1",
      kind: "memory",
      payload: null,
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    "2026-09-22T00:00:00.000Z",
    policy,
  );
  assert.ok(update);
  assert.equal(update.reason, "initialize");
  assert.equal(update.lifecycle.status, "active");
  assert.equal(update.lifecycle.salience, 1);
  assert.equal(update.lifecycle.lastDecayedAt, "2026-09-22T00:00:00.000Z");
});

test("memory crosses fading and archive thresholds under a configurable half-life", () => {
  const initialized = evaluateLifecycle(
    {
      stateId: "m1",
      kind: "memory",
      payload: null,
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    "2026-09-20T00:00:00.000Z",
    policy,
  );
  assert.ok(initialized);

  const faded = evaluateLifecycle(
    {
      stateId: "m1",
      kind: "memory",
      payload: initialized.nextPayload,
      updatedAt: "2026-09-20T00:00:01.000Z",
    },
    "2026-09-21T00:00:00.000Z",
    policy,
  );
  assert.ok(faded);
  assert.equal(faded.reason, "decay");
  assert.equal(faded.lifecycle.status, "fading");
  assert.equal(faded.lifecycle.salience, 0.5);

  const archived = evaluateLifecycle(
    {
      stateId: "m1",
      kind: "memory",
      payload: faded.nextPayload,
      updatedAt: "2026-09-21T00:00:01.000Z",
    },
    "2026-09-23T00:00:00.000Z",
    policy,
  );
  assert.ok(archived);
  assert.equal(archived.lifecycle.status, "archived");
  assert.equal(archived.lifecycle.salience, 0.125);
});

test("protected lifecycle freezes salience while advancing the decay anchor", () => {
  const payload = {
    lifecycle_v1: {
      status: "active",
      salience: 0.9,
      protected: true,
      lastDecayedAt: "2026-09-01T00:00:00.000Z",
      lastRecalledAt: null,
      archivedAt: null,
    },
  };
  const update = evaluateLifecycle(
    {
      stateId: "f1",
      kind: "feel",
      payload,
      updatedAt: "2026-09-01T00:00:01.000Z",
    },
    "2026-09-22T00:00:00.000Z",
    policy,
  );
  assert.ok(update);
  assert.equal(update.reason, "protected_freeze");
  assert.equal(update.lifecycle.salience, 0.9);
  assert.equal(update.lifecycle.lastDecayedAt, "2026-09-22T00:00:00.000Z");
});

test("MemoryLifecycleService keeps product rates injectable", async () => {
  const committed: unknown[] = [];
  const service = new MemoryLifecycleService(
    {
      async listCandidates() {
        return [{
          stateId: "m1",
          kind: "memory" as const,
          payload: null,
          updatedAt: "2026-09-01T00:00:00.000Z",
        }];
      },
      async applyUpdates(input) {
        committed.push(...input.updates);
        return { applied: input.updates.length, conflicts: 0 };
      },
      async setProtected() { return true; },
      async archive() { return true; },
    },
    policy,
  );
  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-22T00:00:00.000Z",
  });
  assert.equal(result.initialized, 1);
  assert.equal(committed.length, 1);
});
