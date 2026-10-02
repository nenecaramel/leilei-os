import assert from "node:assert/strict";
import test from "node:test";
import type { NativeLiveConversation } from "../src/domains/conversation/native-live-conversation-types.js";
import { recallBreath } from "../src/domains/runtime/breath-recall.js";
import {
  NativeLiveMindLoopService,
  type SubjectStateRuntimePort,
} from "../src/domains/runtime/native-live-mind-loop-service.js";
import type { InitialContextManifest } from "../src/domains/runtime/context-assembly-contract.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state-contract.js";

function state(id: string, text: string): SubjectStateWrite {
  return {
    id,
    kind: "memory",
    text,
    payload: null,
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

const base = {
  userId: "u1",
  subjectId: "G",
  conversationId: "c1",
  currentPathMessageIds: new Set<string>(),
  limit: 5,
};

test("Chinese single-character overlap does not create a lexical Breath match", () => {
  const unrelated = state("unrelated", "我在九月画了一张画");
  const hits = recallBreath(
    "想我吗",
    [unrelated],
    {
      ...base,
      semanticWeight: 0,
    },
  );

  assert.deepEqual(hits, []);
});

test("English low-information words do not create a lexical Breath match", () => {
  const unrelated = state(
    "unrelated-english",
    "you told me that this toy was funny",
  );
  const hits = recallBreath(
    "do you think of me",
    [unrelated],
    {
      ...base,
      semanticWeight: 0,
    },
  );

  assert.deepEqual(hits, []);
});

test("English content words still create lexical evidence after stopword filtering", () => {
  const relevant = state(
    "relevant-english",
    "I miss you when the conversation goes quiet",
  );
  const hits = recallBreath(
    "do you miss me",
    [relevant],
    {
      ...base,
      semanticWeight: 0,
    },
  );

  assert.deepEqual(hits.map((hit) => hit.state.id), ["relevant-english"]);
});

test("sub-threshold semantic similarity contributes zero to a lexical hit", () => {
  const weak = state(
    "weak-semantic",
    "runtime alpha beta gamma delta epsilon zeta eta theta iota kappa lambda",
  );
  const hits = recallBreath(
    "runtime",
    [weak],
    {
      ...base,
      semanticWeight: 0.65,
      semanticMinScore: 0.8,
      semanticScores: new Map([["weak-semantic", 0.79]]),
    },
  );

  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.channel, "lexical");
  assert.ok(hits[0]);
  assert.ok(
    Math.abs(
      hits[0].score - (0.35 * hits[0].lexicalScore),
    ) < 1e-12,
  );
});

test("an unscored lexical candidate keeps full lexical weight", () => {
  const scored = state("scored", "different topic");
  const lexical = state("lexical-unscored", "runtime memory");
  const hits = recallBreath(
    "runtime memory",
    [scored, lexical],
    {
      ...base,
      semanticWeight: 0.65,
      semanticMinScore: 0.8,
      semanticScores: new Map([["scored", 0.9]]),
    },
  );

  const hit = hits.find((candidate) =>
    candidate.state.id === "lexical-unscored"
  );
  assert.ok(hit);
  assert.equal(hit.semanticScore, null);
  assert.ok(Math.abs(hit.score - hit.lexicalScore) < 1e-12);
});

test("semantic median margin suppresses a uniformly high background", () => {
  const candidates = [
    state("background-1", "alpha memory"),
    state("background-2", "beta memory"),
    state("background-3", "gamma memory"),
    state("background-4", "delta memory"),
    state("background-5", "epsilon memory"),
    state("background-6", "zeta memory"),
    state("background-7", "theta memory"),
    state("standout", "korea shoreline memory"),
  ];
  const hits = recallBreath(
    "travel",
    candidates,
    {
      ...base,
      semanticWeight: 0.65,
      semanticMinScore: 0.8,
      semanticMedianMargin: 0.03,
      minimumScore: 0.08,
      semanticScores: new Map([
        ["background-1", 0.81],
        ["background-2", 0.812],
        ["background-3", 0.814],
        ["background-4", 0.816],
        ["background-5", 0.818],
        ["background-6", 0.82],
        ["background-7", 0.822],
        ["standout", 0.9],
      ]),
    },
  );

  assert.deepEqual(hits.map((hit) => hit.state.id), ["standout"]);
});

test("recent recall penalty prefers an equally relevant older memory", () => {
  const recent = state(
    "recent-memory",
    "lemon yellow hair memory from recently",
  );
  recent.payload = {
    lifecycle_v1: {
      status: "active",
      salience: 1,
      protected: false,
      lastDecayedAt: "2026-09-22T00:00:00.000Z",
      lastRecalledAt: "2026-09-22T09:30:00.000Z",
      archivedAt: null,
      forgottenAt: null,
    },
    recall_context_v1: {
      conversationId: "c1",
      epoch: 3,
      sourceMessageId: "u-recent",
      recalledAt: "2026-09-22T09:30:00.000Z",
    },
  };
  const older = state(
    "older-memory",
    "lemon yellow hair memory from years ago",
  );
  older.payload = {
    lifecycle_v1: {
      status: "active",
      salience: 1,
      protected: false,
      lastDecayedAt: "2026-09-22T00:00:00.000Z",
      lastRecalledAt: "2026-09-19T00:00:00.000Z",
      archivedAt: null,
      forgottenAt: null,
    },
    recall_context_v1: {
      conversationId: "c1",
      epoch: 3,
      sourceMessageId: "u-older",
      recalledAt: "2026-09-19T00:00:00.000Z",
    },
  };

  const hits = recallBreath(
    "lemon yellow hair",
    [recent, older],
    {
      ...base,
      now: "2026-09-22T10:00:00.000Z",
      contextEpoch: 3,
      semanticWeight: 0,
      recentRecallPenalty: true,
    },
  );

  assert.deepEqual(
    hits.map((hit) => hit.state.id),
    ["older-memory", "recent-memory"],
  );
  assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0));
});

test("near-duplicate Breath memories do not consume multiple slots", () => {
  const first = state(
    "duplicate-a",
    "lemon yellow hair was my favorite color",
  );
  const second = state(
    "duplicate-b",
    "lemon yellow hair is my favorite color",
  );
  const distinct = state(
    "distinct",
    "solo travel in korea changed how I see myself",
  );
  const hits = recallBreath(
    "lemon yellow hair",
    [first, second, distinct],
    {
      ...base,
      semanticWeight: 0.65,
      semanticMinScore: 0.8,
      diversityMaxTokenOverlap: 0.75,
      semanticScores: new Map([
        ["duplicate-a", 0.95],
        ["duplicate-b", 0.95],
        ["distinct", 0.92],
      ]),
    },
  );

  assert.equal(
    hits.filter((hit) => hit.state.id.startsWith("duplicate-")).length,
    1,
  );
  assert.equal(
    hits.some((hit) => hit.state.id === "distinct"),
    true,
  );
});

test("semantic candidate preselection prefers lexical relevance over state id order", async () => {
  const port = new Port([
    state("000-unrelated", "今天吃了炸鸡"),
    state("111-unrelated", "昨天整理了桌面"),
    state("zzz-relevant", "最喜欢的发色是柠檬黄"),
  ]);
  const mind = new NativeLiveMindLoopService(
    port,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      breathLimit: 3,
      breathSemanticWeight: 0.8,
      breathSemanticMinScore: 0.6,
      breathSemanticCandidateLimit: 2,
      maxContextItems: 8,
      maxContextChars: 4000,
    },
    null,
  );

  const plan = await mind.planSemanticRecall({
    userId: "u1",
    subjectId: "G",
    conversation: conversation(),
    userText: "柠檬黄",
    assembledAt: "2026-09-22T10:00:00.000Z",
  });

  assert.ok(plan);
  assert.equal(plan.candidates.length, 2);
  assert.equal(plan.candidates[0]?.stateId, "zzz-relevant");
});

test("semantic-only recall works when the query tokenizer has no lexical tokens", () => {
  const semantic = state("semantic-short-query", "她难过的时候只想安静待一会");
  const hits = recallBreath(
    "嗯",
    [semantic],
    {
      ...base,
      semanticWeight: 0.8,
      semanticMinScore: 0.6,
      semanticScores: new Map([["semantic-short-query", 0.94]]),
    },
  );

  assert.deepEqual(
    hits.map((hit) => hit.state.id),
    ["semantic-short-query"],
  );
  assert.equal(hits[0]?.channel, "semantic");
  assert.equal(hits[0]?.lexicalScore, 0);
});

test("recent recall penalty is scoped to the same conversation epoch", () => {
  const memory = state("epoch-memory", "lemon yellow hair memory");
  memory.payload = {
    lifecycle_v1: {
      status: "active",
      salience: 1,
      protected: false,
      lastDecayedAt: "2026-09-22T00:00:00.000Z",
      lastRecalledAt: "2026-09-22T09:30:00.000Z",
      archivedAt: null,
      forgottenAt: null,
    },
    recall_context_v1: {
      conversationId: "c1",
      epoch: 3,
      sourceMessageId: "u-before-compact",
      recalledAt: "2026-09-22T09:30:00.000Z",
    },
  };

  const afterCompact = recallBreath(
    "lemon yellow hair",
    [memory],
    {
      ...base,
      contextEpoch: 4,
      now: "2026-09-22T10:00:00.000Z",
      semanticWeight: 0,
      recentRecallPenalty: true,
    },
  );
  const otherConversation = recallBreath(
    "lemon yellow hair",
    [memory],
    {
      ...base,
      conversationId: "c2",
      contextEpoch: 3,
      now: "2026-09-22T10:00:00.000Z",
      semanticWeight: 0,
      recentRecallPenalty: true,
    },
  );

  for (const hits of [afterCompact, otherConversation]) {
    assert.equal(hits.length, 1);
    assert.ok(hits[0]);
    assert.ok(Math.abs(hits[0].score - hits[0].lexicalScore) < 1e-12);
  }
});

test("seen states are excluded before semantic candidate limiting", async () => {
  const port = new Port([
    state("seen-a", "alpha beta gamma delta"),
    state("seen-b", "alpha beta gamma"),
    state("unseen-c", "alpha beta"),
    state("unseen-d", "alpha"),
  ]);
  const mind = new NativeLiveMindLoopService(
    port,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      breathLimit: 2,
      breathSemanticWeight: 0.8,
      breathSemanticMinScore: 0.6,
      breathSemanticCandidateLimit: 2,
      maxContextItems: 8,
      maxContextChars: 4000,
    },
    null,
  );

  const plan = await mind.planSemanticRecall({
    userId: "u1",
    subjectId: "G",
    conversation: conversation(),
    userText: "alpha beta gamma delta",
    assembledAt: "2026-09-22T10:00:00.000Z",
    contextLineage: {
      epoch: 0,
      seenStateIds: ["seen-a", "seen-b"],
      thoughtRevision: 0,
      thoughtFingerprint: null,
    },
  });

  assert.ok(plan);
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.stateId).sort(),
    ["unseen-c", "unseen-d"],
  );
});

test("bounded semantic preselection reserves coverage beyond lexical matches", async () => {
  const port = new Port([
    state("coverage-a", "桌上的杯子"),
    state("coverage-b", "窗外下雨"),
    state("lexical", "alpha beta gamma"),
    state("semantic-history", "那次一个人旅行让我变得更勇敢"),
    state("coverage-c", "今天换了床单"),
  ]);
  const mind = new NativeLiveMindLoopService(
    port,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      breathLimit: 2,
      breathSemanticWeight: 0.8,
      breathSemanticMinScore: 0.6,
      breathSemanticCandidateLimit: 2,
      maxContextItems: 8,
      maxContextChars: 4000,
    },
    null,
  );

  const plan = await mind.planSemanticRecall({
    userId: "u1",
    subjectId: "G",
    conversation: conversation(),
    userText: "alpha beta gamma",
    assembledAt: "2026-09-22T10:00:00.000Z",
  });

  assert.ok(plan);
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.stateId).sort(),
    ["lexical", "semantic-history"],
  );
});

test("semantic snapshot is rejected when the bounded candidate set changed", async () => {
  const port = new Port([
    state("planned", "那趟独自旅行让我长大了"),
    state("added-later", "后来又出现了一条新的长期记忆"),
  ]);
  const mind = new NativeLiveMindLoopService(
    port,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      breathLimit: 3,
      breathSemanticWeight: 0.8,
      breathSemanticMinScore: 0.6,
      breathSemanticCandidateLimit: 8,
      maxContextItems: 8,
      maxContextChars: 4000,
    },
    null,
  );

  const assembled = await mind.prepareTurn({
    manifestId: "stale-semantic-plan",
    userId: "u1",
    subjectId: "G",
    conversation: conversation(),
    userMessageId: "u-now",
    userText: "韩国海边",
    snapshotSequence: 1,
    assembledAt: "2026-09-22T10:00:00.000Z",
    semanticCandidates: [{
      stateId: "planned",
      kind: "memory",
      text: "那趟独自旅行让我长大了",
    }],
    semanticScores: new Map([["planned", 0.95]]),
  });

  assert.deepEqual(assembled.breathStateIds, []);
});

test("semantic-only candidate can enter Breath when lexical overlap is zero", () => {
  const semantic = state("semantic", "那趟独自旅行让我长大了");
  const hits = recallBreath(
    "韩国海边",
    [semantic],
    {
      ...base,
      semanticWeight: 0.8,
      semanticMinScore: 0.6,
      semanticScores: new Map([["semantic", 0.92]]),
    },
  );

  assert.deepEqual(hits.map((hit) => hit.state.id), ["semantic"]);
  assert.equal(hits[0]?.channel, "semantic");
  assert.equal(hits[0]?.lexicalScore, 0);
  assert.equal(hits[0]?.semanticScore, 0.92);
});

test("hybrid score combines lexical and semantic channels before salience ranking", () => {
  const lexicalOnly = state("lexical", "柠檬黄");
  const hybrid = state("hybrid", "柠檬黄是我很喜欢的发色");

  const hits = recallBreath(
    "柠檬黄",
    [lexicalOnly, hybrid],
    {
      ...base,
      semanticWeight: 0.7,
      semanticMinScore: 0.5,
      semanticScores: new Map([
        ["lexical", 0.1],
        ["hybrid", 0.95],
      ]),
    },
  );

  assert.equal(hits[0]?.state.id, "hybrid");
  assert.equal(hits[0]?.channel, "hybrid");
});

class Port implements SubjectStateRuntimePort {
  manifests: InitialContextManifest[] = [];
  constructor(readonly states: SubjectStateWrite[]) {}
  async list() { return this.states; }
  async append() {}
  async transition() {}
  async saveContextManifest(input: { manifest: InitialContextManifest }) {
    this.manifests.push(input.manifest);
  }
}

function conversation(): NativeLiveConversation {
  return {
    id: "c1",
    userId: "u1",
    title: null,
    lifecycleStatus: "active",
    currentHeadMessageId: null,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    messages: [],
  };
}

test("Mind loop consumes an injected semantic scorer and records semantic selection in Context Manifest", async () => {
  const port = new Port([
    state("semantic", "那趟独自旅行让我长大了"),
  ]);
  const mind = new NativeLiveMindLoopService(
    port,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      surfaceLimit: 4,
      breathLimit: 3,
      breathSemanticWeight: 0.8,
      breathSemanticMinScore: 0.6,
      maxContextItems: 8,
      maxContextChars: 4000,
    },
    {
      async score() {
        return new Map([["semantic", 0.93]]);
      },
    },
  );

  const assembled = await mind.prepareTurn({
    manifestId: "m1",
    userId: "u1",
    subjectId: "G",
    conversation: conversation(),
    userMessageId: "u-now",
    userText: "韩国海边",
    snapshotSequence: 1,
    assembledAt: "2026-09-22T10:00:00.000Z",
  });

  assert.deepEqual(assembled.breathStateIds, ["semantic"]);
  assert.equal(
    assembled.manifest.items.some(
      (item) =>
        item.sourceId === "semantic"
        && item.selection.reason === "breath_semantic_match",
    ),
    true,
  );
});

test("semantic scorer failure falls back to full lexical scoring instead of failing the turn", async () => {
  const lexicalState = state("lexical", "我们刚聊过 Runtime");
  const port = new Port([lexicalState]);
  const mind = new NativeLiveMindLoopService(
    port,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      surfaceLimit: 4,
      breathLimit: 3,
      breathSemanticWeight: 0.8,
      breathSemanticMinScore: 0.6,
      maxContextItems: 8,
      maxContextChars: 4000,
    },
    {
      async score() {
        throw new Error("embedding unavailable");
      },
    },
  );

  const assembled = await mind.prepareTurn({
    manifestId: "m2",
    userId: "u1",
    subjectId: "G",
    conversation: conversation(),
    userMessageId: "u-now",
    userText: "Runtime",
    snapshotSequence: 1,
    assembledAt: "2026-09-22T10:00:00.000Z",
  });

  assert.deepEqual(assembled.breathStateIds, ["lexical"]);

  const expectedLexical = recallBreath("Runtime", [lexicalState], {
    ...base,
    semanticWeight: 0,
  })[0];
  assert.ok(expectedLexical);
  const selected = assembled.manifest.items.find(
    (item) => item.sourceId === "lexical",
  );
  assert.ok(selected);
  assert.equal(selected.selection.score, expectedLexical.score);
});

test("Mind loop sends only Breath-eligible states to the semantic scorer", async () => {
  const eligible = state("eligible", "一段可以被召回的旅行记忆");
  const invalid = state("invalid", "旧分支里的旅行记忆");
  invalid.envelope = {
    ...invalid.envelope,
    status: {
      ...invalid.envelope.status,
      validityStatus: "invalidated",
    },
  };
  const scopedElsewhere = state("other-conversation", "另一个对话里的旅行记忆");
  scopedElsewhere.envelope = {
    ...scopedElsewhere.envelope,
    scope: {
      ...scopedElsewhere.envelope.scope,
      applicability: "conversation",
      conversationId: "other",
    },
  };

  const port = new Port([eligible, invalid, scopedElsewhere]);
  const seen: string[] = [];
  const mind = new NativeLiveMindLoopService(
    port,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      surfaceLimit: 4,
      breathLimit: 3,
      breathSemanticWeight: 0.8,
      breathSemanticMinScore: 0.6,
      maxContextItems: 8,
      maxContextChars: 4000,
    },
    {
      async score(input) {
        seen.push(...input.candidates.map((candidate) => candidate.stateId));
        return new Map([["eligible", 0.93]]);
      },
    },
  );

  await mind.prepareTurn({
    manifestId: "m3",
    userId: "u1",
    subjectId: "G",
    conversation: conversation(),
    userMessageId: "u-now",
    userText: "海边旅行",
    snapshotSequence: 1,
    assembledAt: "2026-09-22T10:00:00.000Z",
  });

  assert.deepEqual(seen, ["eligible"]);
});

test("Mind loop accepts a staged remote semantic snapshot without invoking the local scorer", async () => {
  const memory = state("remote", "那趟独自旅行让我长大了");
  const port = new Port([memory]);
  let localCalls = 0;
  const mind = new NativeLiveMindLoopService(
    port,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      surfaceLimit: 4,
      breathLimit: 3,
      breathSemanticWeight: 0.8,
      breathSemanticMinScore: 0.6,
      breathSemanticCandidateLimit: 64,
      breathSemanticCandidateMaxChars: 2000,
      maxContextItems: 8,
      maxContextChars: 4000,
    },
    {
      async score() {
        localCalls += 1;
        return new Map();
      },
    },
  );

  const assembled = await mind.prepareTurn({
    manifestId: "m-remote",
    userId: "u1",
    subjectId: "G",
    conversation: conversation(),
    userMessageId: "u-now",
    userText: "solo travel made me independent",
    snapshotSequence: 1,
    assembledAt: "2026-09-22T10:00:00.000Z",
    semanticCandidates: [{
      stateId: "remote",
      kind: "memory",
      text: "那趟独自旅行让我长大了",
    }],
    semanticScores: new Map([["remote", 0.93]]),
  });

  assert.equal(localCalls, 0);
  const selected = assembled.manifest.items.find(
    (item) => item.sourceId === "remote",
  );
  assert.ok(selected);
  assert.equal(selected.selection.reason, "breath_semantic_match");
});

test("stale remote semantic snapshots are discarded instead of scoring changed state text", async () => {
  const changed = state("remote", "这段记忆后来被改写了");
  const port = new Port([changed]);
  const mind = new NativeLiveMindLoopService(
    port,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      surfaceLimit: 4,
      breathLimit: 3,
      breathSemanticWeight: 0.8,
      breathSemanticMinScore: 0.6,
      maxContextItems: 8,
      maxContextChars: 4000,
    },
    null,
  );

  const assembled = await mind.prepareTurn({
    manifestId: "m-stale",
    userId: "u1",
    subjectId: "G",
    conversation: conversation(),
    userMessageId: "u-now",
    userText: "solo travel made me independent",
    snapshotSequence: 1,
    assembledAt: "2026-09-22T10:00:00.000Z",
    semanticCandidates: [{
      stateId: "remote",
      kind: "memory",
      text: "那趟独自旅行让我长大了",
    }],
    semanticScores: new Map([["remote", 0.99]]),
  });

  assert.equal(
    assembled.manifest.items.some(
      (item) =>
        item.sourceId === "remote"
        && item.selection.reason === "breath_semantic_match",
    ),
    false,
  );
});

test("partial semantic score maps are rejected and fall back to lexical scoring", async () => {
  const first = state("first", "Runtime 记忆");
  const second = state("second", "Runtime 对话");
  const port = new Port([first, second]);

  const mind = new NativeLiveMindLoopService(
    port,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      surfaceLimit: 4,
      breathLimit: 3,
      breathSemanticWeight: 0.8,
      breathSemanticMinScore: 0.6,
      maxContextItems: 8,
      maxContextChars: 4000,
    },
    {
      async score() {
        return new Map([["first", 0.95]]);
      },
    },
  );

  const assembled = await mind.prepareTurn({
    manifestId: "m4",
    userId: "u1",
    subjectId: "G",
    conversation: conversation(),
    userMessageId: "u-now",
    userText: "Runtime",
    snapshotSequence: 1,
    assembledAt: "2026-09-22T10:00:00.000Z",
  });

  assert.equal(
    assembled.manifest.items
      .filter((item) => item.selection.reason.startsWith("breath_"))
      .every((item) => item.selection.reason === "breath_lexical_match"),
    true,
  );
});
