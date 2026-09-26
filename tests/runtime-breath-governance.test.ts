import assert from "node:assert/strict";
import test from "node:test";
import { recallBreath } from "../src/domains/runtime/breath-recall.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state-contract.js";

function state(
  id: string,
  text: string,
  lifecycle?: {
    status: "active" | "fading" | "archived";
    salience: number;
    lastRecalledAt: string | null;
  },
): SubjectStateWrite {
  return {
    id,
    kind: "memory",
    text,
    payload: lifecycle
      ? {
          lifecycle_v1: {
            ...lifecycle,
            protected: false,
            lastDecayedAt: "2026-09-20T00:00:00.000Z",
            archivedAt:
              lifecycle.status === "archived"
                ? "2026-09-21T00:00:00.000Z"
                : null,
          },
        }
      : null,
    envelope: {
      semanticActor: { kind: "subject", id: "G" },
      producer: { kind: "model", id: "claude-code" },
      committer: { kind: "runtime", id: "leileios-runtime" },
      authority: "subject_authorized",
      scope: {
        userId: "u1",
        subjectId: "G",
        applicability: "global",
        conversationId: null,
        pathHeadMessageId: null,
        visibility: "subject_private",
        sensitivity: "normal",
        audience: ["G"],
      },
      status: {
        generationStatus: "committed",
        presentationStatus: "presented",
        pathStatus: "current",
        settlementStatus: "settled",
        validityStatus: "valid",
      },
      provenance: {
        sources: [{ kind: "event", id }],
        causedBy: id,
        derivedFrom: [],
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "test",
        processVersion: "test",
      },
    },
  };
}

const baseInput = {
  userId: "u1",
  subjectId: "G",
  conversationId: "c1",
  currentPathMessageIds: new Set<string>(),
  limit: 5,
  now: "2026-09-22T10:00:00.000Z",
};

test("Breath cooldown suppresses a recently surfaced state", () => {
  const hits = recallBreath(
    "柠檬黄",
    [
      state("recent", "蕾蕾喜欢柠檬黄", {
        status: "active",
        salience: 1,
        lastRecalledAt: "2026-09-22T09:30:00.000Z",
      }),
      state("older", "柠檬黄让人想到很亮的头发", {
        status: "active",
        salience: 1,
        lastRecalledAt: "2026-09-21T00:00:00.000Z",
      }),
    ],
    { ...baseInput, cooldownHours: 2 },
  );

  assert.deepEqual(hits.map((hit) => hit.state.id), ["older"]);
});

test("Breath ranking can use lifecycle salience without turning recall into reinforcement evidence", () => {
  const hits = recallBreath(
    "Runtime memory",
    [
      state("fading", "Runtime memory", {
        status: "fading",
        salience: 0.2,
        lastRecalledAt: null,
      }),
      state("active", "Runtime memory extra", {
        status: "active",
        salience: 1,
        lastRecalledAt: null,
      }),
    ],
    { ...baseInput, salienceWeight: 0.6 },
  );

  assert.equal(hits[0]?.state.id, "active");
  assert.equal(hits[0]?.salience, 1);
  assert.equal(hits[1]?.state.id, "fading");
});

test("Breath exact-content dedupe keeps only the strongest duplicate", () => {
  const hits = recallBreath(
    "连续记忆",
    [
      state("low", "我们建立了连续记忆", {
        status: "fading",
        salience: 0.3,
        lastRecalledAt: null,
      }),
      state("high", "  我们建立了连续记忆  ", {
        status: "active",
        salience: 1,
        lastRecalledAt: null,
      }),
    ],
    { ...baseInput, salienceWeight: 0.5 },
  );

  assert.deepEqual(hits.map((hit) => hit.state.id), ["high"]);
});
