import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeLiveContentBlock,
  NativeLiveConversation,
  NativeLiveMessage,
} from "../src/domains/conversation/native-live-conversation-types.js";
import type { InitialContextManifest } from "../src/domains/runtime/context/context-assembly-contract.js";
import {
  NativeLiveMindLoopService,
  type SubjectStateRuntimePort,
  type SubjectStateTransition,
} from "../src/domains/runtime/mind/native-live-mind-loop-service.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state/subject-state-contract.js";

const now = "2026-09-22T08:30:00.000Z";

function block(id: string, text: string): NativeLiveContentBlock {
  return {
    id,
    ordinal: 0,
    kind: "text",
    rawType: "text",
    text,
    payload: null,
    createdAt: now,
  };
}

function message(
  id: string,
  role: "user" | "assistant",
  parentMessageId: string | null,
  text: string,
): NativeLiveMessage {
  return {
    id,
    conversationId: "c1",
    parentMessageId,
    role,
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [block(`b-${id}`, text)],
  };
}

function conversation(
  messages: NativeLiveMessage[],
  currentHeadMessageId: string | null,
): NativeLiveConversation {
  return {
    id: "c1",
    userId: "u1",
    title: null,
    lifecycleStatus: "active",
    currentHeadMessageId,
    createdAt: now,
    updatedAt: now,
    messages,
  };
}

class InMemorySubjectStatePort implements SubjectStateRuntimePort {
  states: SubjectStateWrite[] = [];
  manifests: InitialContextManifest[] = [];
  transitions: SubjectStateTransition[] = [];

  async list(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
  }): Promise<SubjectStateWrite[]> {
    return this.states.filter((state) => {
      const scope = state.envelope.scope;
      return scope.userId === input.userId && scope.subjectId === input.subjectId;
    });
  }

  async append(input: {
    userId: string;
    subjectId: string;
    states: SubjectStateWrite[];
  }): Promise<void> {
    this.states.push(...input.states);
  }

  async transition(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    transitions: SubjectStateTransition[];
  }): Promise<void> {
    this.transitions.push(...input.transitions);

    for (const transition of input.transitions) {
      const index = this.states.findIndex((state) => state.id === transition.stateId);
      const state = this.states[index];
      if (!state) continue;

      const nextScope = transition.promoteScopeToGlobal
        ? {
            ...state.envelope.scope,
            applicability: "global" as const,
            conversationId: null,
            pathHeadMessageId: null,
          }
        : state.envelope.scope;

      this.states[index] = {
        ...state,
        envelope: {
          ...state.envelope,
          scope: nextScope,
          status: {
            ...state.envelope.status,
            settlementStatus:
              transition.settlementStatus ?? state.envelope.status.settlementStatus,
            pathStatus:
              transition.pathStatus ?? state.envelope.status.pathStatus,
            validityStatus:
              transition.validityStatus ?? state.envelope.status.validityStatus,
          },
        },
      };
    }
  }

  async saveContextManifest(input: {
    manifest: InitialContextManifest;
  }): Promise<void> {
    this.manifests.push(input.manifest);
  }
}

function service(port: SubjectStateRuntimePort): NativeLiveMindLoopService {
  return new NativeLiveMindLoopService(port, {
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v1",
    ruleVersion: "mind-v1",
    processVersion: "subject-write-v1",
    surfaceLimit: 8,
    breathLimit: 4,
    maxContextItems: 16,
    maxContextChars: 8000,
  });
}

const unsettledStatus = {
  generationStatus: "committed",
  presentationStatus: "presented",
  pathStatus: "current",
  settlementStatus: "unsettled",
  validityStatus: "valid",
} as const;

test("Milestone 1 positive path: explicit Memory settles and Breath injects it later", async () => {
  const port = new InMemorySubjectStatePort();
  const mind = service(port);
  let nextId = 0;

  const finalized = await mind.finalizeAssistantBlocks({
    userId: "u1",
    subjectId: "G",
    conversationId: "c1",
    assistantMessageId: "a1",
    blocks: [
      {
        kind: "text",
        rawType: "text",
        text: "好。<memory>蕾蕾说 Runtime 要以 Non 为主参考</memory>",
      },
    ],
    createStateId: () => `mind-${++nextId}`,
    producer: { kind: "model", id: "claude-code" },
    committer: { kind: "service", id: "leileios-runtime" },
    sourceOccurredAt: now,
    sourceStatus: unsettledStatus,
    visibility: "subject_private",
    sensitivity: "normal",
    audience: ["G"],
  });

  assert.equal(finalized.visibleBlocks[0]?.text, "好。");
  assert.equal(finalized.states.length, 1);
  assert.equal(port.states[0]?.envelope.status.settlementStatus, "unsettled");
  assert.equal(port.states[0]?.envelope.scope.pathHeadMessageId, "a1");

  const u1 = message("u1", "user", null, "我们做 Runtime");
  const a1 = message("a1", "assistant", "u1", "好。");
  const u2 = message("u2", "user", "a1", "Non 这块继续怎么做");

  const transitions = await mind.reconcilePath({
    userId: "u1",
    subjectId: "G",
    conversation: conversation([u1, a1, u2], "u2"),
  });

  assert.deepEqual(transitions, [
    {
      stateId: "mind-1",
      stateKind: "memory",
      reason: "user_continued_current_path",
      settlementStatus: "settled",
      pathStatus: "current",
      validityStatus: "valid",
      promoteScopeToGlobal: true,
    },
  ]);
  assert.equal(port.states[0]?.envelope.status.settlementStatus, "settled");
  assert.equal(port.states[0]?.envelope.scope.applicability, "global");

  const assembled = await mind.prepareTurn({
    manifestId: "manifest-positive",
    userId: "u1",
    subjectId: "G",
    conversation: conversation([u1, a1, u2], "u2"),
    userMessageId: "u2",
    userText: "Non 这块继续怎么做",
    snapshotSequence: 3,
    assembledAt: now,
    surfaceHeadMessageId: "a1",
  });

  assert.deepEqual(assembled.breathStateIds, ["mind-1"]);
  assert.equal(
    assembled.prompt.includes("蕾蕾说 Runtime 要以 Non 为主参考"),
    true,
  );
  assert.equal(port.manifests.length, 1);
});

test("Milestone 1 abandoned branch: Retry sibling invalidates provisional Memory and Breath cannot recall it", async () => {
  const port = new InMemorySubjectStatePort();
  const mind = service(port);
  let nextId = 0;

  await mind.finalizeAssistantBlocks({
    userId: "u1",
    subjectId: "G",
    conversationId: "c1",
    assistantMessageId: "a-old",
    blocks: [
      {
        kind: "text",
        rawType: "text",
        text: "旧回复。<memory>这是旧分支里关于蓝色火箭的记忆</memory>",
      },
    ],
    createStateId: () => `old-${++nextId}`,
    producer: { kind: "model", id: "claude-code" },
    committer: { kind: "service", id: "leileios-runtime" },
    sourceOccurredAt: now,
    sourceStatus: unsettledStatus,
    visibility: "subject_private",
    sensitivity: "normal",
    audience: ["G"],
  });

  const u1 = message("u1", "user", null, "给我一个答案");
  const oldReply = message("a-old", "assistant", "u1", "旧回复。");
  const newReply = message("a-new", "assistant", "u1", "Retry 后的新回复。");

  const transitions = await mind.reconcilePath({
    userId: "u1",
    subjectId: "G",
    conversation: conversation([u1, oldReply, newReply], "a-new"),
  });

  assert.deepEqual(transitions, [
    {
      stateId: "old-1",
      stateKind: "memory",
      reason: "path_superseded",
      pathStatus: "superseded",
      validityStatus: "invalidated",
    },
  ]);
  assert.equal(port.states[0]?.envelope.status.validityStatus, "invalidated");

  const u2 = message("u2", "user", "a-new", "蓝色火箭是什么");
  const assembled = await mind.prepareTurn({
    manifestId: "manifest-abandoned",
    userId: "u1",
    subjectId: "G",
    conversation: conversation([u1, oldReply, newReply, u2], "u2"),
    userMessageId: "u2",
    userText: "蓝色火箭是什么",
    snapshotSequence: 4,
    assembledAt: now,
    surfaceHeadMessageId: "a-new",
  });

  assert.deepEqual(assembled.breathStateIds, []);
  assert.equal(
    assembled.prompt.includes("这是旧分支里关于蓝色火箭的记忆"),
    false,
  );
});
