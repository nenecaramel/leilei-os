import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateForgetting,
  evaluateLifecycle,
  evaluatePurge,
  evaluateRecallReinforcement,
  removeRecallReinforcementSources,
  forgottenSubjectStatePayload,
  MemoryLifecycleService,
  type MemoryLifecyclePolicy,
} from "../src/domains/runtime/memory-lifecycle.js";

const policy: MemoryLifecyclePolicy = {
  halfLifeHours: { memory: 24, feel: 12 },
  fadingThreshold: 0.7,
  archiveThreshold: 0.2,
  forgetAfterHours: 24,
  purgeAfterHours: 24,
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
  assert.equal(update.lifecycle.forgottenAt, null);
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
  assert.equal(archived.lifecycle.archivedAt, "2026-09-23T00:00:00.000Z");
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
      forgottenAt: null,
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

test("decay-only policy keeps archived/forgotten retention fail-closed", () => {
  const decayOnly: MemoryLifecyclePolicy = {
    halfLifeHours: { memory: 1440, feel: 168 },
    fadingThreshold: 0.35,
    archiveThreshold: 0.12,
  };
  const archivedPayload = {
    lifecycle_v1: {
      status: "archived",
      salience: 0.1,
      protected: false,
      lastDecayedAt: "2026-01-01T00:00:00.000Z",
      lastRecalledAt: null,
      archivedAt: "2026-01-01T00:00:00.000Z",
      forgottenAt: null,
    },
  };
  const forgottenPayload = {
    lifecycle_v1: {
      status: "forgotten",
      salience: 0,
      protected: false,
      lastDecayedAt: "2026-01-01T00:00:00.000Z",
      lastRecalledAt: null,
      archivedAt: "2025-12-01T00:00:00.000Z",
      forgottenAt: "2026-01-01T00:00:00.000Z",
    },
  };

  assert.equal(
    evaluateForgetting(
      {
        stateId: "m-archive-retained",
        kind: "memory",
        payload: archivedPayload,
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
      "2026-09-27T00:00:00.000Z",
      decayOnly,
    ),
    null,
  );
  assert.equal(
    evaluatePurge(
      {
        stateId: "m-forgotten-retained",
        kind: "memory",
        payload: forgottenPayload,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      "2026-09-27T00:00:00.000Z",
      decayOnly,
    ),
    null,
  );
});

test("archived state becomes a content-free forgotten tombstone after the forgetting window", () => {
  const archived = {
    lifecycle_v1: {
      status: "archived",
      salience: 0.1,
      protected: false,
      lastDecayedAt: "2026-09-20T00:00:00.000Z",
      lastRecalledAt: "2026-09-19T00:00:00.000Z",
      archivedAt: "2026-09-20T00:00:00.000Z",
      forgottenAt: null,
    },
    semantic_detail: "this must disappear",
  };
  const forget = evaluateForgetting(
    {
      stateId: "m1",
      kind: "memory",
      payload: archived,
      updatedAt: "2026-09-20T00:00:01.000Z",
    },
    "2026-09-21T00:00:00.000Z",
    policy,
  );
  assert.ok(forget);
  assert.equal(forget.lifecycle.status, "forgotten");
  assert.equal(forget.lifecycle.salience, 0);
  assert.equal(forget.lifecycle.forgottenAt, "2026-09-21T00:00:00.000Z");

  const tombstone = forgottenSubjectStatePayload(forget.lifecycle);
  assert.deepEqual(Object.keys(tombstone), ["lifecycle_v1"]);
  assert.equal("semantic_detail" in tombstone, false);
});

test("forgotten tombstone becomes purge-eligible only after its purge window", () => {
  const payload = {
    lifecycle_v1: {
      status: "forgotten",
      salience: 0,
      protected: false,
      lastDecayedAt: "2026-09-21T00:00:00.000Z",
      lastRecalledAt: null,
      archivedAt: "2026-09-20T00:00:00.000Z",
      forgottenAt: "2026-09-21T00:00:00.000Z",
    },
  };

  assert.equal(
    evaluatePurge(
      {
        stateId: "m1",
        kind: "memory",
        payload,
        updatedAt: "2026-09-21T00:00:00.000Z",
      },
      "2026-09-21T23:59:59.000Z",
      policy,
    ),
    null,
  );
  assert.deepEqual(
    evaluatePurge(
      {
        stateId: "m1",
        kind: "memory",
        payload,
        updatedAt: "2026-09-21T00:00:00.000Z",
      },
      "2026-09-22T00:00:00.000Z",
      policy,
    ),
    {
      stateId: "m1",
      expectedUpdatedAt: "2026-09-21T00:00:00.000Z",
    },
  );
});

test("MemoryLifecycleService keeps product rates injectable and runs forget/purge ports", async () => {
  const committed: unknown[] = [];
  const forgotten: unknown[] = [];
  const purged: unknown[] = [];
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
      async listForgottenCandidates() {
        return [];
      },
      async applyUpdates(input) {
        committed.push(...input.updates);
        return { applied: input.updates.length, conflicts: 0 };
      },
      async forgetArchived(input) {
        forgotten.push(...input.forgets);
        return { applied: input.forgets.length, conflicts: 0 };
      },
      async purgeForgotten(input) {
        purged.push(...input.purges);
        return { applied: input.purges.length, conflicts: 0 };
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
  assert.equal(forgotten.length, 0);
  assert.equal(purged.length, 0);
});


test("selected recall decays to the recall instant before applying deterministic salience boost", () => {
  const update = evaluateRecallReinforcement(
    {
      stateId: "m-recall",
      kind: "memory",
      payload: {
        lifecycle_v1: {
          status: "fading",
          salience: 0.5,
          protected: false,
          lastDecayedAt: "2026-09-20T00:00:00.000Z",
          lastRecalledAt: null,
          archivedAt: null,
          forgottenAt: null,
        },
      },
      updatedAt: "2026-09-20T00:00:01.000Z",
    },
    "2026-09-21T00:00:00.000Z",
    0.08,
    "u-recall",
    policy,
  );

  assert.ok(update);
  assert.equal(update.lifecycle.salience, 0.33);
  assert.equal(update.lifecycle.status, "fading");
  assert.equal(
    update.lifecycle.lastDecayedAt,
    "2026-09-21T00:00:00.000Z",
  );
  assert.equal(
    update.lifecycle.lastRecalledAt,
    "2026-09-21T00:00:00.000Z",
  );
  const [contribution] = (
    update.nextPayload.recall_reinforcement_v1 as {
      contributions: Array<{
        sourceMessageId: string;
        recalledAt: string;
        currentValue: number;
      }>;
    }
  ).contributions;
  assert.ok(contribution);
  assert.equal(contribution.sourceMessageId, "u-recall");
  assert.equal(
    contribution.recalledAt,
    "2026-09-21T00:00:00.000Z",
  );
  assert.equal(Math.abs(contribution.currentValue - 0.08) < 1e-12, true);
});

test("late recall commit catches its boost up to a newer decay checkpoint", () => {
  const update = evaluateRecallReinforcement(
    {
      stateId: "m-late-recall",
      kind: "memory",
      payload: {
        lifecycle_v1: {
          status: "fading",
          salience: 0.25,
          protected: false,
          lastDecayedAt: "2026-09-21T00:00:00.000Z",
          lastRecalledAt: null,
          archivedAt: null,
          forgottenAt: null,
        },
      },
      updatedAt: "2026-09-21T00:00:01.000Z",
    },
    "2026-09-20T12:00:00.000Z",
    0.08,
    "u-recall",
    policy,
  );

  assert.ok(update);
  assert.equal(
    Math.abs(update.lifecycle.salience - 0.3065685424949238) < 1e-12,
    true,
  );
  assert.equal(
    update.lifecycle.lastDecayedAt,
    "2026-09-21T00:00:00.000Z",
  );
  assert.equal(
    update.lifecycle.lastRecalledAt,
    "2026-09-20T12:00:00.000Z",
  );
});

test("recall reinforcement is idempotent for the same or older recall evidence", () => {
  const candidate = {
    stateId: "m-idempotent",
    kind: "memory" as const,
    payload: {
      lifecycle_v1: {
        status: "active",
        salience: 0.7,
        protected: false,
        lastDecayedAt: "2026-09-21T00:00:00.000Z",
        lastRecalledAt: "2026-09-21T00:00:00.000Z",
        archivedAt: null,
        forgottenAt: null,
      },
    },
    updatedAt: "2026-09-21T00:00:01.000Z",
  };

  assert.equal(
    evaluateRecallReinforcement(
      candidate,
      "2026-09-21T00:00:00.000Z",
      0.08,
      "u-recall",
      policy,
    ),
    null,
  );
  assert.equal(
    evaluateRecallReinforcement(
      candidate,
      "2026-09-20T23:00:00.000Z",
      0.08,
      "u-recall",
      policy,
    ),
    null,
  );
});

test("recall cannot resurrect archived or forgotten Memory/Feel", () => {
  for (const status of ["archived", "forgotten"] as const) {
    const at = "2026-09-21T00:00:00.000Z";
    const payload = {
      lifecycle_v1: {
        status,
        salience: status === "forgotten" ? 0 : 0.1,
        protected: false,
        lastDecayedAt: at,
        lastRecalledAt: null,
        archivedAt: at,
        forgottenAt: status === "forgotten" ? at : null,
      },
    };
    assert.equal(
      evaluateRecallReinforcement(
        {
          stateId: "m-" + status,
          kind: "memory",
          payload,
          updatedAt: at,
        },
        "2026-09-22T00:00:00.000Z",
        0.08,
        "u-recall",
        policy,
      ),
      null,
    );
  }
});

test("recall reinforcement without decay policy starts a new non-retroactive baseline", () => {
  const update = evaluateRecallReinforcement(
    {
      stateId: "f-no-decay",
      kind: "feel",
      payload: {
        lifecycle_v1: {
          status: "fading",
          salience: 0.4,
          protected: false,
          lastDecayedAt: "2026-09-01T00:00:00.000Z",
          lastRecalledAt: null,
          archivedAt: null,
          forgottenAt: null,
        },
      },
      updatedAt: "2026-09-01T00:00:01.000Z",
    },
    "2026-09-22T00:00:00.000Z",
    0.08,
    "u-recall",
  );

  assert.ok(update);
  assert.equal(Math.abs(update.lifecycle.salience - 0.48) < 1e-12, true);
  assert.equal(update.lifecycle.status, "fading");
  assert.equal(
    update.lifecycle.lastDecayedAt,
    "2026-09-22T00:00:00.000Z",
  );
});


test("lifecycle decay advances recall contribution values with the same factor as salience", () => {
  const update = evaluateLifecycle(
    {
      stateId: "m-contribution-decay",
      kind: "memory",
      payload: {
        lifecycle_v1: {
          status: "active",
          salience: 0.8,
          protected: false,
          lastDecayedAt: "2026-09-20T00:00:00.000Z",
          lastRecalledAt: "2026-09-20T00:00:00.000Z",
          archivedAt: null,
          forgottenAt: null,
        },
        recall_reinforcement_v1: {
          contributions: [{
            sourceMessageId: "u-old",
            recalledAt: "2026-09-20T00:00:00.000Z",
            currentValue: 0.08,
          }],
        },
      },
      updatedAt: "2026-09-20T00:00:01.000Z",
    },
    "2026-09-21T00:00:00.000Z",
    policy,
  );

  assert.ok(update);
  assert.equal(update.lifecycle.salience, 0.4);
  assert.deepEqual(
    (update.nextPayload.recall_reinforcement_v1 as {
      contributions: unknown[];
    }).contributions,
    [{
      sourceMessageId: "u-old",
      recalledAt: "2026-09-20T00:00:00.000Z",
      currentValue: 0.04,
    }],
  );
});

test("the same canonical user turn cannot reinforce the same Memory twice", () => {
  const first = evaluateRecallReinforcement(
    {
      stateId: "m-retry",
      kind: "memory",
      payload: {
        lifecycle_v1: {
          status: "active",
          salience: 0.5,
          protected: false,
          lastDecayedAt: "2026-09-20T00:00:00.000Z",
          lastRecalledAt: null,
          archivedAt: null,
          forgottenAt: null,
        },
      },
      updatedAt: "2026-09-20T00:00:01.000Z",
    },
    "2026-09-20T01:00:00.000Z",
    0.08,
    "u-same-turn",
  );
  assert.ok(first);

  const replay = evaluateRecallReinforcement(
    {
      stateId: "m-retry",
      kind: "memory",
      payload: first.nextPayload,
      updatedAt: "2026-09-20T01:00:01.000Z",
    },
    "2026-09-20T02:00:00.000Z",
    0.08,
    "u-same-turn",
  );

  assert.ok(replay);
  assert.equal(replay.lifecycle.salience, 0.58);
  assert.equal(replay.lifecycle.lastRecalledAt, "2026-09-20T02:00:00.000Z");
  assert.equal(
    (replay.nextPayload.recall_reinforcement_v1 as {
      contributions: unknown[];
    }).contributions.length,
    1,
  );
});

test("causal Edit removal subtracts only recall reinforcement sourced by purged user messages", () => {
  const repaired = removeRecallReinforcementSources(
    {
      lifecycle_v1: {
        status: "active",
        salience: 0.66,
        protected: false,
        lastDecayedAt: "2026-09-21T00:00:00.000Z",
        lastRecalledAt: "2026-09-21T00:00:00.000Z",
        archivedAt: null,
        forgottenAt: null,
      },
      recall_reinforcement_v1: {
        contributions: [
          {
            sourceMessageId: "u-purged",
            recalledAt: "2026-09-20T00:00:00.000Z",
            currentValue: 0.08,
          },
          {
            sourceMessageId: "u-survives",
            recalledAt: "2026-09-21T00:00:00.000Z",
            currentValue: 0.08,
          },
        ],
      },
    },
    new Set(["u-purged"]),
  );

  assert.ok(repaired);
  assert.equal(
    Math.abs(repaired.lifecycle.salience - 0.58) < 1e-12,
    true,
  );
  assert.deepEqual(
    (repaired.nextPayload.recall_reinforcement_v1 as {
      contributions: unknown[];
    }).contributions,
    [{
      sourceMessageId: "u-survives",
      recalledAt: "2026-09-21T00:00:00.000Z",
      currentValue: 0.08,
    }],
  );
});
