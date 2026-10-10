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

test("ordinary sends settle existing memory scope without new memory context or timestamps", async () => {
  const reader = new Reader();
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
  const prompt = await runtime.preparePrompt({
    userId,
    preparation: { ...prepared("send"), prompt: "Hello <Claude> & G" },
  });

  assert.equal(prompt, "<user_message>Hello &lt;Claude&gt; &amp; G</user_message>");
  assert.deepEqual(mind.calls, [`reconcile:${userMessageId}`]);
  assert.deepEqual(mind.manifestIds, []);
  assert.doesNotMatch(prompt, /leileios_context|Relevant memories:|\[\d{2}-\d{2}/);
});

test("only canonical voice input keeps the voice flag", async () => {
  for (const mode of ["voice", "text", "audio", null] as const) {
    const reader = new Reader();
    const user = userMessage();
    user.blocks[0]!.payload = mode === null ? null : { input_mode: mode };
    reader.value = { ...conversation(), messages: [parentAssistant(), user] };
    const runtime = new DefaultNativeLiveBackendMindRuntime(reader, new Mind());
    const prompt = await runtime.preparePrompt({ userId, preparation: prepared("send") });
    assert.equal(
      prompt,
      mode === "voice"
        ? '<user_message input_mode="voice">[voice] hello</user_message>'
        : "<user_message>hello</user_message>",
    );
  }
});

test("native schedule and routines remain verbatim on send", async () => {
  for (const command of ["/schedule daily at 9am", "/routines list"]) {
    const runtime = new DefaultNativeLiveBackendMindRuntime(new Reader(), new Mind());
    assert.equal(
      await runtime.preparePrompt({
        userId, preparation: { ...prepared("send"), prompt: command },
      }),
      command,
    );
  }
});

test("retry and edit are still ordinary prompts with no second Mind recall", async () => {
  for (const operation of ["retry", "edit"] as const) {
    const reader = new Reader();
    reader.value = conversation(oldAssistantId);
    const mind = new Mind();
    const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
    const prompt = await runtime.preparePrompt({
      userId,
      preparation: { ...prepared(operation), prompt: "/schedule must not execute here" },
    });
    assert.equal(prompt, "<user_message>/schedule must not execute here</user_message>");
    assert.deepEqual(mind.calls, []);
  }
});

test("semantic Mind preparation stays disabled even when legacy runtime offers it", async () => {
  const reader = new Reader();
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
  assert.equal(await runtime.planSemanticPrompt({
    userId, preparation: prepared("send"),
  }), null);
  assert.deepEqual(mind.calls, []);
  assert.deepEqual(reader.calls, []);
});

test("already queued semantic request completes without adding legacy memories", async () => {
  const reader = new Reader();
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
  const prompt = await runtime.completeSemanticPrompt({
    userId,
    preparation: prepared("send"),
    plan: {
      manifestId: prepared("send").prepareId,
      assembledAt: now,
      snapshotSequence: 1,
      query: "hello",
      candidates: [],
    },
    scores: null,
  });
  assert.equal(prompt, "<user_message>hello</user_message>");
  assert.deepEqual(mind.calls, []);
});

test("new assistant <memory> tags are not parsed into Mind writes", () => {
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(new Reader(), mind);
  const blocks: NativeLiveContentBlockInput[] = [{
    kind: "text",
    rawType: "text",
    text: "Hello <memory>an old memory tag</memory>",
  }];
  const parsed = runtime.parseAssistantBlocks(blocks);
  assert.deepEqual(parsed.intents, []);
  assert.deepEqual(parsed.actions, []);
  assert.deepEqual(parsed.visibleBlocks, blocks);
  assert.deepEqual(mind.calls, []);
});

test("an already queued legacy Mind intent can still finalize without discarding existing data", async () => {
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
      text: "historical queued memory",
      sourceStart: 0,
      sourceEnd: 1,
      raw: "<memory>historical queued memory</memory>",
    }],
  });
  assert.deepEqual(mind.calls, ["recall", "record", `reconcile:${assistantId}`]);
});

test("normal completed turns make no new Mind writes", async () => {
  const reader = new Reader();
  reader.value = conversation(assistantId);
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
  await runtime.afterFinalize({
    userId, preparation: prepared("send"), assistantMessageId: assistantId, intents: [],
  });
  assert.deepEqual(mind.calls, ["recall"]);
});

test("archived conversations still reject a stale finalization", async () => {
  const reader = new Reader();
  reader.value = { ...conversation(assistantId), lifecycleStatus: "archived" };
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
  await assert.rejects(
    runtime.afterFinalize({
      userId, preparation: prepared("send"), assistantMessageId: assistantId, intents: [],
    }),
    /not active/i,
  );
  assert.deepEqual(mind.calls, []);
});
