import assert from "node:assert/strict";
import test from "node:test";
import {
  planCausalSubjectStatePurge,
  planExclusiveProviderSessionCleanup,
  planReplacementMessagePurge,
  planSubjectStateEvolutionRepairs,
  stateReferencesAnyId,
} from "../src/domains/bridge/native-live-replacement-purge.js";
import type {
  NativeLiveConversation,
  NativeLiveMessage,
} from "../src/domains/conversation/native-live-conversation-types.js";

const now = "2026-09-26T12:00:00.000Z";

function message(
  id: string,
  role: "user" | "assistant",
  parentMessageId: string | null,
): NativeLiveMessage {
  return {
    id,
    conversationId: "c1",
    parentMessageId,
    role,
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [],
  };
}

function conversation(
  messages: NativeLiveMessage[],
  head: string,
): NativeLiveConversation {
  return {
    id: "c1",
    userId: "u1",
    title: null,
    lifecycleStatus: "active",
    currentHeadMessageId: head,
    createdAt: now,
    updatedAt: now,
    messages,
  };
}

test("Retry purges the old assistant suffix but keeps the target user", () => {
  const c = conversation([
    message("u1", "user", null),
    message("a1", "assistant", "u1"),
    message("u2", "user", "a1"),
    message("a2", "assistant", "u2"),
    message("u3", "user", "a2"),
    message("a3", "assistant", "u3"),
  ], "a3");

  const plan = planReplacementMessagePurge({
    operation: "retry",
    conversation: c,
    targetUserMessageId: "u2",
  });

  assert.ok(plan);
  assert.equal(plan.branchParentMessageId, "a1");
  assert.deepEqual(plan.rootMessageIds, ["a2"]);
  assert.deepEqual(plan.messageIds, ["a2", "u3", "a3"]);
  assert.equal(plan.messageIds.includes("u2"), false);
});

test("Edit purges the target user and its entire suffix", () => {
  const c = conversation([
    message("u1", "user", null),
    message("a1", "assistant", "u1"),
    message("u2", "user", "a1"),
    message("a2", "assistant", "u2"),
    message("u3", "user", "a2"),
    message("a3", "assistant", "u3"),
    message("edited", "user", "a1"),
  ], "a3");

  const plan = planReplacementMessagePurge({
    operation: "edit",
    conversation: c,
    targetUserMessageId: "u2",
  });

  assert.ok(plan);
  assert.deepEqual(plan.rootMessageIds, ["u2"]);
  assert.deepEqual(plan.messageIds, ["u2", "a2", "u3", "a3"]);
  assert.equal(plan.messageIds.includes("edited"), false);
});

test("replacement target must be on the current canonical path", () => {
  const c = conversation([
    message("u1", "user", null),
    message("a1", "assistant", "u1"),
    message("u2", "user", "a1"),
    message("a2", "assistant", "u2"),
    message("other-u", "user", "a1"),
    message("other-a", "assistant", "other-u"),
  ], "a2");

  assert.equal(
    planReplacementMessagePurge({
      operation: "edit",
      conversation: c,
      targetUserMessageId: "other-u",
    }),
    null,
  );
});

test("causal Mind purge follows message provenance and derived state chains", () => {
  const purgedMessages = new Set(["a2"]);
  const states = [
    {
      id: "state-old",
      kind: "drive",
      payload: null,
      envelope: { provenance: { sources: [{ kind: "message", id: "a2" }] } },
      scopeConversationId: "c1",
      scopePathHeadMessageId: null,
    },
    {
      id: "state-derived",
      kind: "topic",
      payload: { seed_state_id: "state-old" },
      envelope: { provenance: { sources: [{ kind: "persistent_state", id: "state-old" }] } },
      scopeConversationId: null,
      scopePathHeadMessageId: null,
    },
    {
      id: "state-safe",
      kind: "memory",
      payload: null,
      envelope: { provenance: { sources: [{ kind: "message", id: "a1" }] } },
      scopeConversationId: null,
      scopePathHeadMessageId: null,
    },
  ];

  assert.deepEqual(
    new Set(planCausalSubjectStatePurge({
      conversationId: "c1",
      purgeMessageIds: purgedMessages,
      resetDistillation: false,
      states,
    })),
    new Set(["state-old", "state-derived"]),
  );
});

test("surviving state is preserved while contaminated evolution cache is stripped", () => {
  const purgeMessageIds = new Set(["old-message"]);
  const states = [
    {
      id: "surviving-drive",
      kind: "drive",
      payload: {
        source_start: 1,
        drive_v1: {
          pressure: 0.8,
          reinforcementSources: ["safe-message", "old-message"],
        },
      },
      envelope: {
        provenance: {
          sources: [{ kind: "message", id: "safe-message" }],
          causedBy: "safe-message",
        },
      },
      scopeConversationId: null,
      scopePathHeadMessageId: null,
    },
    {
      id: "old-drive",
      kind: "drive",
      payload: {
        drive_v1: {
          pressure: 0.8,
          reinforcementSources: ["safe-message", "old-message"],
        },
      },
      envelope: {
        provenance: {
          sources: [{ kind: "message", id: "old-message" }],
          causedBy: "old-message",
        },
      },
      scopeConversationId: null,
      scopePathHeadMessageId: null,
    },
  ];

  const purgeStateIds = new Set(planCausalSubjectStatePurge({
    conversationId: "c1",
    purgeMessageIds,
    resetDistillation: false,
    states,
  }));
  assert.deepEqual(purgeStateIds, new Set(["old-drive"]));

  const repairs = planSubjectStateEvolutionRepairs({
    states,
    purgeMessageIds,
    purgeStateIds,
  });
  assert.deepEqual(repairs, [{
    stateId: "surviving-drive",
    nextPayload: { source_start: 1 },
  }]);
});

test("semantic action projections are invalidated when their branch provenance is purged", () => {
  const repairs = planSubjectStateEvolutionRepairs({
    states: [
      {
        id: "drive-anchor",
        kind: "drive",
        payload: {
          drive_v1: {
            anchorStateId: "drive-anchor",
            reinforcementSources: ["safe-message"],
            pressure: 0.2,
          },
        },
      },
      {
        id: "drive-copy",
        kind: "drive",
        payload: {
          drive_v1: {
            anchorStateId: "drive-anchor",
            reinforcementSources: ["safe-message"],
            pressure: 0.2,
          },
        },
      },
      {
        id: "curiosity-anchor",
        kind: "curiosity",
        payload: {
          curiosity_v1: {
            anchorStateId: "curiosity-anchor",
            reinforcementSources: ["safe-message"],
            resolutionSourceId: "old-assistant",
            phase: "resolved",
          },
        },
      },
    ],
    purgeMessageIds: new Set(["old-assistant"]),
    purgeStateIds: new Set(),
    additionalEvolutionCausalIds: new Set(["drive-anchor"]),
  });

  assert.deepEqual(
    repairs.map((repair) => repair.stateId).sort(),
    ["curiosity-anchor", "drive-anchor", "drive-copy"],
  );
  assert.equal(repairs.every((repair) => repair.nextPayload === null), true);
});

test("Edit causal purge removes only Memory recall contribution from the purged user source", () => {
  const repairs = planSubjectStateEvolutionRepairs({
    states: [{
      id: "memory-anchor",
      kind: "memory",
      payload: {
        lifecycle_v1: {
          status: "active",
          salience: 0.66,
          protected: false,
          lastDecayedAt: "2026-09-26T10:00:00.000Z",
          lastRecalledAt: "2026-09-26T10:00:00.000Z",
          archivedAt: null,
          forgottenAt: null,
        },
        recall_reinforcement_v1: {
          contributions: [
            {
              sourceMessageId: "user-purged",
              recalledAt: "2026-09-25T10:00:00.000Z",
              currentValue: 0.08,
            },
            {
              sourceMessageId: "user-survives",
              recalledAt: "2026-09-26T10:00:00.000Z",
              currentValue: 0.08,
            },
          ],
        },
      },
    }],
    purgeMessageIds: new Set(["user-purged"]),
    purgeStateIds: new Set(),
  });

  assert.equal(repairs.length, 1);
  assert.equal(repairs[0]?.stateId, "memory-anchor");
  assert.equal(
    (repairs[0]?.nextPayload?.lifecycle_v1 as { salience: number }).salience,
    0.58,
  );
  assert.deepEqual(
    (
      repairs[0]?.nextPayload?.recall_reinforcement_v1 as {
        contributions: unknown[];
      }
    ).contributions,
    [{
      sourceMessageId: "user-survives",
      recalledAt: "2026-09-26T10:00:00.000Z",
      currentValue: 0.08,
    }],
  );
});

test("distillation reset drops all distilled memories for that conversation", () => {
  const ids = planCausalSubjectStatePurge({
    conversationId: "c1",
    purgeMessageIds: new Set(["a4"]),
    resetDistillation: true,
    states: [{
      id: "distilled",
      kind: "memory",
      payload: { formation: "distillation" },
      envelope: { provenance: { sources: [{ kind: "message", id: "a1" }] } },
      scopeConversationId: "c1",
      scopePathHeadMessageId: "a1",
    }],
  });
  assert.deepEqual(ids, ["distilled"]);
});

test("structured reference scan matches exact ids only", () => {
  assert.equal(
    stateReferencesAnyId(
      { nested: ["x", { id: "target-id" }] },
      new Set(["target-id"]),
    ),
    true,
  );
  assert.equal(
    stateReferencesAnyId(
      { text: "prefix target-id suffix" },
      new Set(["target-id"]),
    ),
    false,
  );
});


test("provider session cleanup only selects sessions exclusive to purged messages", () => {
  const sessions = planExclusiveProviderSessionCleanup({
    purgeMessageIds: new Set(["old-a", "old-b"]),
    checkpoints: [
      {
        canonicalMessageId: "old-a",
        provider: "claude_code",
        providerSessionId: "session-old",
      },
      {
        canonicalMessageId: "old-b",
        provider: "claude_code",
        providerSessionId: "session-shared",
      },
      {
        canonicalMessageId: "survivor",
        provider: "claude_code",
        providerSessionId: "session-shared",
      },
      {
        canonicalMessageId: "survivor-2",
        provider: "claude_code",
        providerSessionId: "session-safe",
      },
    ],
  });

  assert.deepEqual(sessions, ["session-old"]);
});
