import assert from "node:assert/strict";
import test from "node:test";
import {
  SubjectStateContractError,
  validateSubjectStateWrite,
  type SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";
import {
  assertContextManifestSafe,
  subjectStateToContextItem,
} from "../src/domains/runtime/context-assembly-contract.js";

const base: SubjectStateWrite = {
  id: "state-1",
  kind: "memory",
  text: "A remembered event.",
  payload: null,
  lifecycle: "active",
  sourceSettlement: "settled",
  writer: {
    actor: "subject",
    writerId: "claude-code",
    authority: "subject_authorized",
  },
  scope: {
    userId: "user-1",
    applicability: "global",
    conversationId: null,
    pathHeadMessageId: null,
    visibility: "subject_private",
    sensitivity: "normal",
  },
  provenance: {
    sources: [{ kind: "message", id: "message-1" }],
    causedBy: "ledger-event-1",
    derivedFromStateIds: [],
    decisionId: null,
    processRunId: null,
    schemaVersion: 1,
    ruleVersion: "mind-v1",
    processVersion: "subject-write-v1",
  },
};

test("settled memory may become active persistent state", () => {
  const result = validateSubjectStateWrite(base);
  assert.equal(result.kind, "memory");
  assert.equal(result.lifecycle, "active");
  assert.equal(result.provenance.sources[0]?.id, "message-1");
});

test("bedrock rejects derived authority", () => {
  assert.throws(
    () =>
      validateSubjectStateWrite({
        ...base,
        kind: "bedrock",
        writer: {
          actor: "process",
          writerId: "cron-distillation",
          authority: "derived",
        },
      }),
    (error: unknown) =>
      error instanceof SubjectStateContractError
      && error.code === "BEDROCK_AUTHORITY_REQUIRED",
  );
});

test("unsettled state must remain provisional and path scoped", () => {
  assert.throws(
    () =>
      validateSubjectStateWrite({
        ...base,
        sourceSettlement: "presented",
      }),
    /must remain provisional/,
  );

  assert.throws(
    () =>
      validateSubjectStateWrite({
        ...base,
        lifecycle: "provisional",
        sourceSettlement: "presented",
      }),
    /must remain path-scoped/,
  );

  const provisional = validateSubjectStateWrite({
    ...base,
    lifecycle: "provisional",
    sourceSettlement: "presented",
    scope: {
      ...base.scope,
      applicability: "path",
      conversationId: "conversation-1",
      pathHeadMessageId: "assistant-1",
    },
  });
  assert.equal(provisional.lifecycle, "provisional");
});

test("persistent state requires provenance", () => {
  assert.throws(
    () =>
      validateSubjectStateWrite({
        ...base,
        provenance: {
          ...base.provenance,
          sources: [],
        },
      }),
    /requires at least one provenance source/,
  );
});

test("feel, memory and dream remain distinct context types", () => {
  for (const kind of ["feel", "memory", "dream"] as const) {
    const item = subjectStateToContextItem(
      validateSubjectStateWrite({
        ...base,
        id: `state-${kind}`,
        kind,
      }),
    );
    assert.equal(item.type, kind);
    assert.equal(item.authority, "data");
    assert.equal(item.trustBoundary, "subject_state_data");
  }
});

test("subject state cannot be promoted to instruction authority in context", () => {
  const item = subjectStateToContextItem(validateSubjectStateWrite(base));
  assert.doesNotThrow(() =>
    assertContextManifestSafe({
      conversationId: "conversation-1",
      pathHeadMessageId: "assistant-1",
      snapshotSequence: 10,
      assembledAt: "2026-09-22T07:40:00.000Z",
      items: [item],
    }),
  );

  assert.throws(
    () =>
      assertContextManifestSafe({
        conversationId: "conversation-1",
        pathHeadMessageId: "assistant-1",
        snapshotSequence: 10,
        assembledAt: "2026-09-22T07:40:00.000Z",
        items: [{ ...item, authority: "instruction" }],
      }),
    /only as data authority/,
  );
});
