import assert from "node:assert/strict";
import test from "node:test";
import {
  DefaultNativeLiveBackendMindRuntime,
} from "../src/domains/bridge/mind/native-live-backend-mind-runtime.js";
import type { NativeLivePreparedTurn } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import type {
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveMessage,
} from "../src/domains/conversation/native-live-conversation-types.js";
import type { NativeLiveMindRuntime } from "../src/domains/runtime/mind/native-live-mind-runtime.js";
import type { ContextLineageState } from "../src/domains/runtime/context/context-lineage.js";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const conversationId = "33333333-3333-4333-8333-333333333333";
const userMessageId = "44444444-4444-4444-8444-444444444444";
const parentId = "55555555-5555-4555-8555-555555555555";
const assistantId = "66666666-6666-4666-8666-666666666666";
const oldAssistantId = "77777777-7777-4777-8777-777777777777";
const now = "2026-09-22T11:00:00.000Z";

function userMessage(): NativeLiveMessage {
  return {
    id: userMessageId,
    conversationId,
    parentMessageId: parentId,
    role: "user",
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [{
      id: "b-user",
      ordinal: 0,
      kind: "text",
      rawType: "text",
      text: "hello",
      payload: null,
      createdAt: now,
    }],
  };
}

function parentAssistant(): NativeLiveMessage {
  return {
    id: parentId,
    conversationId,
    parentMessageId: null,
    role: "assistant",
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [],
  };
}

function oldAssistant(): NativeLiveMessage {
  return {
    id: oldAssistantId,
    conversationId,
    parentMessageId: userMessageId,
    role: "assistant",
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [],
  };
}

function finalizedAssistant(): NativeLiveMessage {
  return {
    id: assistantId,
    conversationId,
    parentMessageId: userMessageId,
    role: "assistant",
    status: "completed",
    createdAt: "2026-09-22T11:02:03.000Z",
    completedAt: "2026-09-22T11:02:04.000Z",
    blocks: [],
  };
}

function conversation(head: string | null = parentId): NativeLiveConversation {
  return {
    id: conversationId,
    userId,
    title: null,
    lifecycleStatus: "active",
    currentHeadMessageId: head,
    createdAt: now,
    updatedAt: now,
    messages: [
      parentAssistant(),
      userMessage(),
      oldAssistant(),
      ...(head === assistantId ? [finalizedAssistant()] : []),
    ],
  };
}

function prepared(
  operation: NativeLivePreparedTurn["operation"] = "send",
): NativeLivePreparedTurn {
  return {
    prepareId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    userId,
    conversationId,
    operation,
    canonicalUserMessageId: userMessageId,
    replacementTargetUserMessageId:
      operation === "send" ? null : userMessageId,
    runtimeMode: "fork",
    parentProviderSessionId: "provider-parent",
    prompt: "hello",
    mindPrepared: false,
  };
}

class Reader {
  value: NativeLiveConversation | null = conversation();
  calls: unknown[] = [];

  async getConversation(input: unknown) {
    this.calls.push(input);
    return this.value;
  }
}

class LineageReader {
  calls: unknown[] = [];
  value: ContextLineageState = {
    epoch: 2,
    seenStateIds: ["memory-seen"],
    thoughtRevision: 7,
    thoughtFingerprint: "a".repeat(64),
  };

  async readForMessage(input: unknown) {
    this.calls.push(input);
    return this.value;
  }
}

class Mind implements NativeLiveMindRuntime {
  calls: string[] = [];
  excludedReferenceIds: string[][] = [];
  manifestIds: Array<string | undefined> = [];
  recallInputs: unknown[] = [];
  recordInputs: unknown[] = [];
  contextLineages: Array<ContextLineageState | null | undefined> = [];
  transitions: Awaited<
    ReturnType<NativeLiveMindRuntime["reconcileSelectedPath"]>
  > = [];

  async prepareUserTurn(input: {
    surfaceHeadMessageId: string | null;
    userText: string;
    manifestId?: string;
    excludedReferenceIds?: ReadonlySet<string>;
    contextLineage?: ContextLineageState | null;
  }) {
    this.calls.push(
      `prepare:${input.surfaceHeadMessageId}:${input.userText}`,
    );
    this.excludedReferenceIds.push(
      [...(input.excludedReferenceIds ?? [])].sort(),
    );
    this.manifestIds.push(input.manifestId);
    this.contextLineages.push(input.contextLineage);
    return "ASSEMBLED_PROMPT";
  }

  async recordFinalizedBreathRecall(input: unknown) {
    this.calls.push("recall");
    this.recallInputs.push(input);
    return [];
  }

  parseAssistantBlocks(blocks: readonly NativeLiveContentBlockInput[]) {
    this.calls.push("parse");
    return {
      visibleBlocks: [...blocks],
      intents: [],
    };
  }

  async recordAssistantIntents(input: unknown) {
    this.calls.push("record");
    this.recordInputs.push(input);
    return [];
  }

  async reconcileSelectedPath(input: {
    conversation: NativeLiveConversation;
  }) {
    this.calls.push(`reconcile:${input.conversation.currentHeadMessageId}`);
    return this.transitions;
  }
}

test("send preparation settles the continued path, then assembles context", async () => {
  const reader = new Reader();
  const mind = new Mind();
  mind.transitions = [{
    stateId: "thought-1",
    stateKind: "thought",
    reason: "user_continued_current_path",
    settlementStatus: "settled",
    pathStatus: "current",
    validityStatus: "valid",
    promoteScopeToGlobal: true,
  }];
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);

  const prompt = await runtime.preparePrompt({
    userId,
    preparation: prepared("send"),
  });

  assert.equal(prompt, "ASSEMBLED_PROMPT");
  // A settled thought is injectable immediately; nothing else has to run
  // between settlement and context assembly.
  assert.deepEqual(mind.calls, [
    `reconcile:${userMessageId}`,
    `prepare:${parentId}:hello`,
  ]);
  assert.deepEqual(mind.excludedReferenceIds, [[]]);
  assert.deepEqual(mind.manifestIds, [prepared("send").prepareId]);
});


test("Mind preparation inherits context lineage from the canonical parent message", async () => {
  const reader = new Reader();
  const mind = new Mind();
  const lineage = new LineageReader();
  const runtime = new DefaultNativeLiveBackendMindRuntime(
    reader,
    mind,
    lineage,
  );

  await runtime.preparePrompt({
    userId,
    preparation: prepared("send"),
  });

  assert.deepEqual(lineage.calls, [{
    userId,
    conversationId,
    canonicalMessageId: parentId,
  }]);
  assert.deepEqual(mind.contextLineages, [lineage.value]);
});

test("bootstrap fork with no canonical parent forces one authoritative Thought snapshot", async () => {
  const reader = new Reader();
  const bootstrapUser = {
    ...userMessage(),
    parentMessageId: null,
  };
  reader.value = {
    ...conversation(null),
    currentHeadMessageId: null,
    messages: [bootstrapUser],
  };
  const mind = new Mind();
  const lineage = new LineageReader();
  lineage.value = {
    epoch: 0,
    seenStateIds: [],
    thoughtRevision: 0,
    thoughtFingerprint: null,
  };
  const runtime = new DefaultNativeLiveBackendMindRuntime(
    reader,
    mind,
    lineage,
  );

  await runtime.preparePrompt({
    userId,
    preparation: prepared("send"),
  });

  assert.deepEqual(lineage.calls, [{
    userId,
    conversationId,
    canonicalMessageId: null,
  }]);
  assert.deepEqual(mind.contextLineages, [{
    ...lineage.value,
    forceThoughtSnapshot: true,
  }]);
});

test("native Claude schedule command bypasses Mind prompt assembly but still settles the current path", async () => {
  const reader = new Reader();
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
  const preparation = {
    ...prepared("send"),
    prompt: "/schedule daily at 9am review open pull requests",
  };

  const prompt = await runtime.preparePrompt({
    userId,
    preparation,
  });

  assert.equal(prompt, preparation.prompt);
  assert.deepEqual(mind.calls, [
    `reconcile:${userMessageId}`,
  ]);
});

test("schedule aliases bypass semantic planning while retry remains an ordinary replacement turn", async () => {
  const reader = new Reader();
  const mind = new Mind();
  Object.assign(mind, {
    planSemanticUserTurn: async () => {
      throw new Error("native schedule must not enter semantic planning");
    },
  });
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);

  assert.equal(
    await runtime.planSemanticPrompt({
      userId,
      preparation: {
        ...prepared("send"),
        prompt: "/routines list",
      },
    }),
    null,
  );

  reader.value = conversation(oldAssistantId);
  await runtime.preparePrompt({
    userId,
    preparation: {
      ...prepared("retry"),
      prompt: "/schedule daily at 9am must not execute on retry",
    },
  });
  assert.deepEqual(mind.calls, [
    `prepare:${parentId}:/schedule daily at 9am must not execute on retry`,
  ]);
});

test("retry preparation excludes the old assistant suffix before replacement generation", async () => {
  const reader = new Reader();
  reader.value = conversation(oldAssistantId);
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);

  await runtime.preparePrompt({
    userId,
    preparation: prepared("retry"),
  });

  assert.deepEqual(mind.calls, [
    `prepare:${parentId}:hello`,
  ]);
  assert.deepEqual(mind.excludedReferenceIds, [[oldAssistantId]]);
  assert.deepEqual(mind.manifestIds, [prepared("retry").prepareId]);
});

test("Retry and Edit inherit lineage from the replacement branch point, not the abandoned suffix", async () => {
  for (const operation of ["retry", "edit"] as const) {
    const reader = new Reader();
    reader.value = conversation(oldAssistantId);
    const mind = new Mind();
    const lineage = new LineageReader();
    lineage.value = {
      epoch: 3,
      seenStateIds: ["seen-before-branch"],
      thoughtRevision: 9,
      thoughtFingerprint: "b".repeat(64),
    };
    const runtime = new DefaultNativeLiveBackendMindRuntime(
      reader,
      mind,
      lineage,
    );

    await runtime.preparePrompt({
      userId,
      preparation: prepared(operation),
    });

    assert.deepEqual(lineage.calls, [{
      userId,
      conversationId,
      canonicalMessageId: parentId,
    }]);
    assert.deepEqual(mind.contextLineages, [lineage.value]);
  }
});

test("branch finalize records intents and then reconciles the finalized canonical head", async () => {
  const reader = new Reader();
  reader.value = conversation(assistantId);
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);

  await runtime.afterFinalize({
    userId,
    preparation: prepared("edit"),
    assistantMessageId: assistantId,
    intents: [{
      kind: "memory",
      text: "remember",
      sourceStart: 0,
      sourceEnd: 1,
      raw: "<memory>remember</memory>",
    }],
  });

  assert.deepEqual(mind.calls, [
    "recall",
    "record",
    `reconcile:${assistantId}`,
  ]);
  assert.deepEqual(mind.recallInputs, [{
    userId,
    manifestId: prepared("edit").prepareId,
  }]);
  assert.equal(
    (mind.recordInputs[0] as { assistantMessageCreatedAt: string })
      .assistantMessageCreatedAt,
    "2026-09-22T11:02:03.000Z",
  );
});

test("ordinary send finalize records intents but leaves the new state provisional until next user continuation", async () => {
  const reader = new Reader();
  reader.value = conversation(assistantId);
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);

  await runtime.afterFinalize({
    userId,
    preparation: prepared("send"),
    assistantMessageId: assistantId,
    intents: [{
      kind: "feel",
      text: "warm",
      sourceStart: 0,
      sourceEnd: 1,
      raw: "<feel>warm</feel>",
    }],
  });

  assert.deepEqual(mind.calls, ["recall", "record"]);
  assert.deepEqual(mind.recallInputs, [{
    userId,
    manifestId: prepared("send").prepareId,
  }]);
  assert.equal(reader.calls.length, 1);
});

test("archived conversation blocks delayed Mind finalization before any mutation", async () => {
  const reader = new Reader();
  reader.value = {
    ...conversation(assistantId),
    lifecycleStatus: "archived",
  };
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);

  await assert.rejects(
    runtime.afterFinalize({
      userId,
      preparation: prepared("send"),
      assistantMessageId: assistantId,
      intents: [{
        kind: "memory",
        text: "must not write",
        sourceStart: 0,
        sourceEnd: 1,
        raw: "<memory>must not write</memory>",
      }],
    }),
    /not active/i,
  );
  assert.deepEqual(mind.calls, []);
});
