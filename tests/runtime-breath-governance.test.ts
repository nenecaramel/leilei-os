import assert from "node:assert/strict";
import test from "node:test";
import { recallBreath } from "../src/domains/runtime/breath-recall.js";
import {
  NativeLiveMindLoopService,
  type SubjectStateRuntimePort,
} from "../src/domains/runtime/native-live-mind-loop-service.js";
import type {
  InitialContextManifest,
} from "../src/domains/runtime/context-assembly-contract.js";
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

test("Breath salience weight 0.1 stays a relevance-preserving bias", () => {
  const candidates = [
    state("more-relevant-low-salience", "unrelated lexical text", {
      status: "fading",
      salience: 0.2,
      lastRecalledAt: null,
    }),
    state("less-relevant-high-salience", "different lexical text", {
      status: "active",
      salience: 1,
      lastRecalledAt: null,
    }),
  ];
  const semanticScores = new Map([
    ["more-relevant-low-salience", 0.90],
    ["less-relevant-high-salience", 0.82],
  ]);

  const noBias = recallBreath("semantic only query", candidates, {
    ...baseInput,
    salienceWeight: 0,
    semanticWeight: 0.65,
    semanticMinScore: 0.8,
    semanticScores,
  });
  const conservative = recallBreath("semantic only query", candidates, {
    ...baseInput,
    salienceWeight: 0.1,
    semanticWeight: 0.65,
    semanticMinScore: 0.8,
    semanticScores,
  });
  const stronger = recallBreath("semantic only query", candidates, {
    ...baseInput,
    salienceWeight: 0.2,
    semanticWeight: 0.65,
    semanticMinScore: 0.8,
    semanticScores,
  });

  assert.deepEqual(
    noBias.map((hit) => hit.state.id),
    ["more-relevant-low-salience", "less-relevant-high-salience"],
  );
  assert.deepEqual(
    conservative.map((hit) => hit.state.id),
    ["more-relevant-low-salience", "less-relevant-high-salience"],
  );
  assert.deepEqual(
    stronger.map((hit) => hit.state.id),
    ["less-relevant-high-salience", "more-relevant-low-salience"],
  );
});

test("Breath salience weight 0.1 breaks near relevance ties toward stronger lifecycle state", () => {
  const hits = recallBreath(
    "semantic tie query",
    [
      state("fading-tie", "no lexical overlap one", {
        status: "fading",
        salience: 0.4,
        lastRecalledAt: null,
      }),
      state("active-tie", "no lexical overlap two", {
        status: "active",
        salience: 1,
        lastRecalledAt: null,
      }),
    ],
    {
      ...baseInput,
      salienceWeight: 0.1,
      semanticWeight: 0.65,
      semanticMinScore: 0.8,
      semanticScores: new Map([
        ["fading-tie", 0.86],
        ["active-tie", 0.84],
      ]),
    },
  );

  assert.deepEqual(
    hits.map((hit) => hit.state.id),
    ["active-tie", "fading-tie"],
  );
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


test("finalized Breath reinforcement uses only manifest-selected breath items", async () => {
  const recallCalls: unknown[] = [];
  const manifest: InitialContextManifest = {
    manifestId: "11111111-1111-4111-8111-111111111111",
    userId: "u1",
    subjectId: "G",
    conversationId: "c1",
    pathHeadMessageId: null,
    snapshotSequence: 1,
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v4",
    createdAt: "2026-09-22T10:00:00.000Z",
    budget: {
      maxItems: 4,
      maxChars: 1000,
      usedItems: 3,
      usedChars: 20,
      overflowPolicy: "drop_lowest_rank",
    },
    items: [
      {
        id: "user:u-turn",
        type: "user_message",
        sourceId: "u-turn",
        authority: "data",
        trustBoundary: "canonical_data",
        text: "想起柠檬黄",
        selection: {
          reason: "current_user_message",
          rank: 0,
          truncated: false,
        },
      },
      {
        id: "subject-state:m-selected",
        type: "memory",
        sourceId: "m-selected",
        authority: "data",
        trustBoundary: "subject_state_data",
        text: "蕾蕾喜欢柠檬黄",
        selection: {
          reason: "breath_lexical_match",
          rank: 300,
          truncated: false,
        },
      },
      {
        id: "subject-state:d-not-breath",
        type: "drive",
        sourceId: "d-not-breath",
        authority: "data",
        trustBoundary: "subject_state_data",
        text: "继续研究",
        selection: {
          reason: "active_drive",
          rank: 100,
          truncated: false,
        },
      },
    ],
  };
  const port: SubjectStateRuntimePort = {
    async list() { return []; },
    async append() {},
    async transition() {},
    async saveContextManifest() {},
    async loadContextManifest() { return manifest; },
    async recordBreathRecall(input) {
      recallCalls.push(input);
    },
  };
  const service = new NativeLiveMindLoopService(port, {
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v4",
    ruleVersion: "mind-v1",
    processVersion: "subject-write-v1",
    breathLimit: 4,
    breathRecallSalienceBoost: 0.08,
    maxContextItems: 16,
    maxContextChars: 8000,
  });

  const ids = await service.recordFinalizedBreathRecall({
    userId: "u1",
    subjectId: "G",
    manifestId: manifest.manifestId,
  });

  assert.deepEqual(ids, ["m-selected"]);
  assert.deepEqual(recallCalls, [{
    userId: "u1",
    subjectId: "G",
    stateIds: ["m-selected"],
    recalledAt: "2026-09-22T10:00:00.000Z",
    salienceBoost: 0.08,
    sourceMessageId: "u-turn",
  }]);
});


test("deterministic preparation manifest replays despite a later assembledAt retry", async () => {
  const persisted: InitialContextManifest = {
    manifestId: "22222222-2222-4222-8222-222222222222",
    userId: "u1",
    subjectId: "G",
    conversationId: "c1",
    pathHeadMessageId: null,
    snapshotSequence: 1,
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v4",
    createdAt: "2026-09-22T10:00:00.000Z",
    budget: {
      maxItems: 4,
      maxChars: 1000,
      usedItems: 1,
      usedChars: 10,
      overflowPolicy: "drop_lowest_rank",
    },
    items: [{
      id: "user:u-turn",
      type: "user_message",
      sourceId: "u-turn",
      authority: "data",
      trustBoundary: "canonical_data",
      text: "same turn",
      selection: {
        reason: "current_user_message",
        rank: 0,
        truncated: false,
      },
    }],
  };
  let listCalls = 0;
  const port: SubjectStateRuntimePort = {
    async list() {
      listCalls += 1;
      return [];
    },
    async append() {},
    async transition() {},
    async saveContextManifest() {},
    async loadContextManifest() { return persisted; },
  };
  const service = new NativeLiveMindLoopService(port, {
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v4",
    ruleVersion: "mind-v1",
    processVersion: "subject-write-v1",
    breathLimit: 4,
    maxContextItems: 16,
    maxContextChars: 8000,
  });

  const replayed = await service.prepareTurn({
    manifestId: persisted.manifestId,
    userId: "u1",
    subjectId: "G",
    conversation: {
      id: "c1",
      userId: "u1",
      title: null,
      lifecycleStatus: "active",
      currentHeadMessageId: null,
      createdAt: "2026-09-22T09:00:00.000Z",
      updatedAt: "2026-09-22T09:00:00.000Z",
      messages: [],
    },
    userMessageId: "u-turn",
    userText: "same turn",
    snapshotSequence: 1,
    assembledAt: "2026-09-22T10:05:00.000Z",
    surfaceHeadMessageId: null,
  });

  assert.equal(replayed.manifest.createdAt, persisted.createdAt);
  assert.equal(listCalls, 0);
});
