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
