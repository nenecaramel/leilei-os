import assert from "node:assert/strict";
import test from "node:test";
import {
  planCausalSubjectStatePurge,
  planReplacementMessagePurge,
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
