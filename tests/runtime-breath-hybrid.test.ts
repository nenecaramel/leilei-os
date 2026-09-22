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

test("semantic-only candidate can enter Breath when lexical overlap is zero", () => {
  const semantic = state("semantic", "那趟独自旅行让我第一次觉得自己真的长大了");
  const hits = recallBreath(
    "还记得韩国吗",
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
    state("semantic", "那趟独自旅行让我第一次觉得自己真的长大了"),
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
    userText: "还记得韩国吗",
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

test("semantic scorer failure falls back to lexical Breath instead of failing the turn", async () => {
  const port = new Port([state("lexical", "我们刚聊过 Runtime")]);
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
});
