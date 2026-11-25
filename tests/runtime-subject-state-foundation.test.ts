import assert from "node:assert/strict";
import test from "node:test";
import { validateCanonicalEvent } from "../src/domains/runtime/shared/canonical-event-contract.js";
import {
  assertContextManifestSafe,
  subjectStateToContextItem,
} from "../src/domains/runtime/context/context-assembly-contract.js";
import { isConsolidationEligible } from "../src/domains/runtime/subject-state/runtime-status-axes.js";
import {
  SubjectStateContractError,
  validateSubjectStateWrite,
  type SubjectStateWrite,
} from "../src/domains/runtime/subject-state/subject-state-contract.js";
import { assertTurnTransition } from "../src/domains/runtime/lifecycle/turn-lifecycle-contract.js";

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
