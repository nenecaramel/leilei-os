import assert from "node:assert/strict";
import test from "node:test";
import { validateCanonicalEvent } from "../src/domains/runtime/canonical-event-contract.js";
import {
  assertContextManifestSafe,
  subjectStateToContextItem,
} from "../src/domains/runtime/context-assembly-contract.js";
import {
  assertEffectDispatchAllowed,
  assertEffectTransition,
  type DurableEffect,
} from "../src/domains/runtime/effect-protocol.js";
import { isConsolidationEligible } from "../src/domains/runtime/runtime-status-axes.js";
import {
  SubjectStateContractError,
  validateCurrentSubjectStateAppend,
  validateSubjectStateWrite,
  type SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";
import { assertTurnTransition } from "../src/domains/runtime/turn-lifecycle-contract.js";

const settledStatus = {
  generationStatus: "committed",
  presentationStatus: "presented",
  pathStatus: "current",
  settlementStatus: "settled",
  validityStatus: "valid",
} as const;

function baseState(): SubjectStateWrite {
  return {
    id: "state-1",
    kind: "memory",
    text: "A remembered event.",
    payload: null,
    envelope: {
      semanticActor: { kind: "subject", id: "G" },
      producer: { kind: "model", id: "claude-code" },
      committer: { kind: "service", id: "leileios-runtime" },
      authority: "subject_authorized",
      scope: {
        userId: "user-1",
        subjectId: "G",
        applicability: "global",
        conversationId: null,
        pathHeadMessageId: null,
        visibility: "subject_private",
        sensitivity: "normal",
        audience: ["G"],
      },
      status: settledStatus,
      provenance: {
        sources: [{ kind: "message", id: "message-1" }],
        causedBy: "message-1",
        derivedFrom: [],
        decisionId: null,
        processRunId: null,
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "mind-v1",
        processVersion: "subject-write-v1",
      },
    },
  };
}

test("current Subject State append rejects retired Dream and authored Topic while legacy reads remain valid", () => {
  const dream = {
    ...baseState(),
    kind: "dream" as const,
  };
  assert.equal(validateSubjectStateWrite(dream).kind, "dream");
  assert.throws(
    () => validateCurrentSubjectStateAppend(dream),
    (error: unknown) =>
      error instanceof SubjectStateContractError
      && error.code === "RETIRED_KIND_WRITE",
  );

  const authoredTopic = {
    ...baseState(),
    kind: "topic" as const,
  };
  assert.equal(validateSubjectStateWrite(authoredTopic).kind, "topic");
  assert.throws(
    () => validateCurrentSubjectStateAppend(authoredTopic),
    (error: unknown) =>
      error instanceof SubjectStateContractError
      && error.code === "TOPIC_MUST_BE_DERIVED",
  );

  const derivedTopic = {
    ...authoredTopic,
    envelope: {
      ...authoredTopic.envelope,
      authority: "derived" as const,
    },
  };
  assert.equal(
    validateCurrentSubjectStateAppend(derivedTopic).kind,
    "topic",
  );
});

test("canonical event contract keeps explicit ordering, time and causality", () => {
  const event = validateCanonicalEvent({
    eventId: "event-1",
    userId: "user-1",
    subjectId: "G",
    streamId: "conversation:c1",
    streamSequence: 12,
    eventType: "message_committed",
    schemaVersion: 1,
    time: {
      occurredAt: null,
      observedAt: "2026-09-22T08:00:00.000Z",
      recordedAt: "2026-09-22T08:00:01.000Z",
      effectiveAt: "2026-09-22T08:00:01.000Z",
    },
    relation: {
      parentEventId: "event-0",
      causedBy: "turn-1",
      derivedFrom: [],
      decisionId: null,
    },
    payload: { message_id: "a1" },
  });
  assert.equal(event.streamSequence, 12);
});

test("turn lifecycle allows tool loops but terminal states stay terminal", () => {
  assert.doesNotThrow(() => assertTurnTransition("started", "producing"));
  assert.doesNotThrow(() => assertTurnTransition("streaming", "waiting_tool"));
  assert.doesNotThrow(() => assertTurnTransition("waiting_tool", "streaming"));
  assert.doesNotThrow(() => assertTurnTransition("streaming", "committed"));
  assert.throws(() => assertTurnTransition("committed", "producing"));
});

test("runtime status axes do not collapse settled, path and validity into one enum", () => {
  assert.equal(isConsolidationEligible(settledStatus), true);
  assert.equal(
    isConsolidationEligible({
      ...settledStatus,
      settlementStatus: "unsettled",
    }),
    false,
  );
  assert.equal(
    isConsolidationEligible({
      ...settledStatus,
      pathStatus: "superseded",
    }),
    false,
  );
});

test("unsettled subject state must remain scoped to the exact canonical path", () => {
  const base = baseState();
  assert.throws(
    () =>
      validateSubjectStateWrite({
        ...base,
        envelope: {
          ...base.envelope,
          status: {
            ...settledStatus,
            settlementStatus: "unsettled",
          },
        },
      }),
    /must remain path-scoped/,
  );

  const result = validateSubjectStateWrite({
    ...base,
    envelope: {
      ...base.envelope,
      status: {
        ...settledStatus,
        settlementStatus: "unsettled",
      },
      scope: {
        ...base.envelope.scope,
        applicability: "path",
        conversationId: "c1",
        pathHeadMessageId: "a1",
      },
    },
  });
  assert.equal(result.envelope.scope.pathHeadMessageId, "a1");
});

test("Context Manifest keeps subject state as typed data, never promoted instruction", () => {
  const item = subjectStateToContextItem(baseState(), {
    reason: "breath_match",
    rank: 3,
    score: 0.8,
    truncated: false,
  });
  const manifest = {
    manifestId: "manifest-1",
    userId: "user-1",
    subjectId: "G",
    conversationId: "c1",
    pathHeadMessageId: "a1",
    snapshotSequence: 10,
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v1",
    createdAt: "2026-09-22T08:00:00.000Z",
    budget: {
      maxItems: 10,
      maxChars: 1000,
      usedItems: 1,
      usedChars: item.text?.length ?? 0,
      overflowPolicy: "drop_lowest_rank" as const,
    },
    items: [item],
  };
  assert.doesNotThrow(() => assertContextManifestSafe(manifest));
  assert.throws(() =>
    assertContextManifestSafe({
      ...manifest,
      items: [{ ...item, authority: "instruction" as const }],
    }),
  );
});

test("Effect protocol forbids replay dispatch and blind retry from unknown delivery", () => {
  const effect: DurableEffect = {
    effectId: "effect-1",
    userId: "user-1",
    subjectId: "G",
    decisionId: "decision-1",
    idempotencyKey: "effect-1:send",
    effectType: "message_send",
    target: "chat",
    payloadHash: "abc",
    status: "reserved",
    attempt: 0,
    retryable: true,
    reservedBy: "33333333-3333-4333-8333-333333333333",
    reservedAt: "2026-09-22T08:00:01.000Z",
    reservationExpiresAt: "2026-09-22T08:01:01.000Z",
    createdAt: "2026-09-22T08:00:00.000Z",
    updatedAt: "2026-09-22T08:00:01.000Z",
  };
  assert.doesNotThrow(() =>
    assertEffectDispatchAllowed({ mode: "live", effect }),
  );
  assert.throws(() =>
    assertEffectDispatchAllowed({ mode: "replay", effect }),
  );
  assert.throws(() =>
    assertEffectDispatchAllowed({
      mode: "live",
      effect: {
        ...effect,
        status: "unknown",
        reservedBy: null,
        reservedAt: null,
        reservationExpiresAt: null,
        dispatchStartedAt: "2026-09-22T08:00:02.000Z",
        attempt: 1,
        retryable: false,
        failureCode: "DELIVERY_UNKNOWN",
      },
    }),
  );
  assert.doesNotThrow(() => assertEffectTransition("unknown", "observed"));
  assert.throws(() => assertEffectTransition("unknown", "pending"));
});
