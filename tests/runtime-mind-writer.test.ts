import assert from "node:assert/strict";
import test from "node:test";
import { createMindState } from "../src/domains/runtime/mind-writer.js";
import { materializeMindWrites } from "../src/domains/runtime/mind-write-materializer.js";
import { readSubjectStateTemporal } from "../src/domains/runtime/subject-state-temporal.js";
import { isActiveThought } from "../src/domains/runtime/thought.js";

const unsettled = {
  generationStatus: "committed",
  presentationStatus: "presented",
  pathStatus: "current",
  settlementStatus: "unsettled",
  validityStatus: "valid",
} as const;

const assistantSource = {
  origin: "assistant" as const,
  conversationId: "c1",
  assistantMessageId: "a1",
  occurredAt: "2026-09-30T10:00:00+08:00",
  span: { start: 3, end: 40 },
  producer: { kind: "model" as const, id: "claude-code" },
  committer: { kind: "runtime" as const, id: "leileios-runtime" },
  status: unsettled,
  visibility: "subject_private" as const,
  sensitivity: "normal" as const,
  audience: ["G"],
  ruleVersion: "mind-v2",
  processVersion: "subject-write-v2",
};

test("assistant writes are path-scoped, unsettled and dated from the source message", () => {
  for (const kind of ["memory", "feel", "thought"] as const) {
    const state = createMindState({
      id: `id-${kind}`,
      userId: "u1",
      subjectId: "G",
      kind,
      text: "一件事",
      source: assistantSource,
    });

    assert.equal(state.kind, kind);
    assert.equal(state.envelope.scope.applicability, "path");
    assert.equal(state.envelope.scope.pathHeadMessageId, "a1");
    assert.equal(state.envelope.status.settlementStatus, "unsettled");
    assert.equal(state.envelope.authority, "subject_authorized");
    assert.deepEqual(state.envelope.provenance.sources, [
      { kind: "message", id: "a1" },
    ]);
    assert.deepEqual(readSubjectStateTemporal(state.payload), {
      occurredAt: "2026-09-30T02:00:00.000Z",
      basis: "source_message",
      sourceMessageId: "a1",
    });
    assert.equal(isActiveThought(state.payload), kind === "thought");
  }
});

test("manual writes are global, settled and user-asserted; time only when the user gave one", () => {
  const dated = createMindState({
    id: "m1",
    userId: "u1",
    subjectId: "G",
    kind: "memory",
    text: "那天",
    source: {
      origin: "manual",
      occurredAt: "2026-07-14T18:30:00.000Z",
      note: "给自己看的",
    },
  });
  assert.equal(dated.envelope.scope.applicability, "global");
  assert.equal(dated.envelope.status.settlementStatus, "settled");
  assert.equal(dated.envelope.authority, "user_asserted");
  assert.deepEqual(readSubjectStateTemporal(dated.payload), {
    occurredAt: "2026-07-14T18:30:00.000Z",
    basis: "user_supplied",
    sourceMessageId: null,
  });
  assert.deepEqual(dated.payload?.manual_v1, {
    occurredAt: "2026-07-14T18:30:00.000Z",
    note: "给自己看的",
  });

  const undated = createMindState({
    id: "m2",
    userId: "u1",
    subjectId: "G",
    kind: "thought",
    text: "想一想",
    source: { origin: "manual", occurredAt: null, note: null },
  });
  assert.equal(readSubjectStateTemporal(undated.payload), null);
  assert.equal(isActiveThought(undated.payload), true);
});

test("both entry points produce the same shape for the same kind", () => {
  const fromTag = createMindState({
    id: "t1",
    userId: "u1",
    subjectId: "G",
    kind: "thought",
    text: "x",
    source: assistantSource,
  });
  const fromManual = createMindState({
    id: "t2",
    userId: "u1",
    subjectId: "G",
    kind: "thought",
    text: "x",
    source: { origin: "manual", occurredAt: "2026-09-30T02:00:00.000Z", note: null },
  });

  assert.deepEqual(
    Object.keys(fromTag.payload ?? {}).filter((key) => key.endsWith("_v1") || key.endsWith("_v2")).sort(),
    ["temporal_v1", "thought_v2"],
  );
  assert.deepEqual(
    Object.keys(fromManual.payload ?? {}).filter((key) => key.endsWith("_v1") || key.endsWith("_v2")).sort(),
    ["manual_v1", "temporal_v1", "thought_v2"],
  );
});

test("blank text is rejected by the contract, not stored", () => {
  assert.throws(() =>
    createMindState({
      id: "e1",
      userId: "u1",
      subjectId: "G",
      kind: "memory",
      text: "   ",
      source: { origin: "manual", occurredAt: null, note: null },
    })
  );
});

test("tag materialization goes through the same Writer", () => {
  let n = 0;
  const [state] = materializeMindWrites({
    userId: "u1",
    subjectId: "G",
    conversationId: "c1",
    assistantMessageId: "a1",
    sourceOccurredAt: "2026-09-30T02:00:00.000Z",
    intents: [{
      kind: "thought",
      text: "想把 Mind 收简单",
      sourceStart: 0,
      sourceEnd: 10,
      raw: "<thought>想把 Mind 收简单</thought>",
    }],
    createId: () => `id-${++n}`,
    producer: assistantSource.producer,
    committer: assistantSource.committer,
    sourceStatus: unsettled,
    ruleVersion: "mind-v2",
    processVersion: "subject-write-v2",
    visibility: "subject_private",
    sensitivity: "normal",
    audience: ["G"],
  });

  assert.ok(state);
  assert.equal(state.id, "id-1");
  assert.equal(isActiveThought(state.payload), true);
  assert.equal(state.payload?.source_start, 0);
  assert.equal(state.payload?.source_end, 10);
});
