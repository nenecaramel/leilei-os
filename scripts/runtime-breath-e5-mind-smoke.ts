import assert from "node:assert/strict";
import type { NativeLiveConversation } from "../src/domains/conversation/native-live-conversation-types.js";
import type { InitialContextManifest } from "../src/domains/runtime/context-assembly-contract.js";
import { LocalE5BreathSemanticScorer } from "../src/domains/runtime/local-e5-embedding.js";
import {
  NativeLiveMindLoopService,
  type SubjectStateRuntimePort,
} from "../src/domains/runtime/native-live-mind-loop-service.js";
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
      authority: "derived",
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
        ruleVersion: "e5-mind-smoke",
        processVersion: "e5-mind-smoke",
      },
    },
  };
}

class Port implements SubjectStateRuntimePort {
  manifests: InitialContextManifest[] = [];

  constructor(readonly states: SubjectStateWrite[]) {}

  async list() {
    return this.states;
  }

  async append() {}

  async transition() {}

  async saveContextManifest(input: { manifest: InitialContextManifest }) {
    this.manifests.push(input.manifest);
  }
}

const conversation: NativeLiveConversation = {
  id: "c1",
  userId: "u1",
  title: null,
  lifecycleStatus: "active",
  currentHeadMessageId: null,
  createdAt: "2026-09-22T10:00:00.000Z",
  updatedAt: "2026-09-22T10:00:00.000Z",
  messages: [],
};

const relevant = state(
  "travel-related",
  "那趟独自旅行让我第一次真切感到自己可以照顾好自己",
);
const port = new Port([
  relevant,
  state("food", "晚饭吃了炸鸡，第二天又想吃甜点"),
  state("database", "数据库迁移完成后所有集成测试都通过了"),
  state("ui", "聊天页面的底部输入框需要支持附件"),
]);

const mind = new NativeLiveMindLoopService(
  port,
  {
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v1",
    ruleVersion: "mind-v1",
    processVersion: "mind-v1",
    surfaceLimit: 4,
    breathLimit: 1,
    breathCooldownHours: 0,
    breathSalienceWeight: 0,
    breathSemanticWeight: 1,
    breathSemanticMinScore: 0,
    maxContextItems: 8,
    maxContextChars: 4000,
  },
  new LocalE5BreathSemanticScorer(),
);

const assembled = await mind.prepareTurn({
  manifestId: "e5-mind-smoke",
  userId: "u1",
  subjectId: "G",
  conversation,
  userMessageId: "u-now",
  userText: "solo travel made me feel independent",
  snapshotSequence: 1,
  assembledAt: "2026-09-22T10:00:00.000Z",
});

assert.deepEqual(assembled.breathStateIds, ["travel-related"]);
const selected = assembled.manifest.items.find(
  (item) => item.sourceId === "travel-related",
);
assert.ok(selected);
assert.equal(selected.selection.reason, "breath_semantic_match");
assert.equal(
  assembled.prompt.includes(relevant.text!),
  true,
);

process.stdout.write(
  JSON.stringify({
    status: "accepted",
    provider: "multilingual_e5_small_q8",
    path: "semantic_scorer_to_mind_context",
    selectedStateId: selected.sourceId,
    selectionReason: selected.selection.reason,
    selectionScore: selected.selection.score,
  }, null, 2) + "\n",
);
