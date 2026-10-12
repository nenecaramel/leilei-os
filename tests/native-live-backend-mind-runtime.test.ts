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
import { parseMindWriteIntentsFromBlocks } from "../src/domains/runtime/mind/mind-block-parser.js";

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

test("send settles the selected path but leaves recall and timestamps to installed Hooks", async () => {
  const reader = new Reader();
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
  assert.equal(await runtime.preparePrompt({userId, preparation: prepared()}), "hello");
  assert.deepEqual(mind.calls, [`reconcile:${userMessageId}`]);
  assert.deepEqual(mind.manifestIds, []);
});

test("bootstrap and native slash commands remain raw prompts", async () => {
  for (const prompt of ["hello", "/schedule daily at 9am review", "/routines list"]) {
    const reader = new Reader();
    reader.value = {...conversation(null), messages: [{...userMessage(), parentMessageId: null}]};
    const mind = new Mind();
    const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
    assert.equal(await runtime.preparePrompt({userId, preparation: {...prepared(), prompt}}), prompt);
    assert.deepEqual(mind.calls, [`reconcile:${userMessageId}`]);
  }
});

test("voice keeps its input-mode annotation without another timestamp or Mind context", async () => {
  const reader = new Reader();
  const voice = userMessage();
  voice.blocks[0]!.payload = {input_mode: "voice"};
  reader.value = {...conversation(), messages: [parentAssistant(), voice]};
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, new Mind());
  assert.equal(await runtime.preparePrompt({userId, preparation: {...prepared(), prompt: "tea & <milk>"}}),
    '<user_message input_mode="voice">[voice] tea &amp; &lt;milk&gt;</user_message>');
});

test("backend does not stage semantic recall or fall back to assembly for old staged plans", async () => {
  const reader = new Reader();
  const mind = new Mind();
  Object.assign(mind, {
    planSemanticUserTurn: async () => assert.fail("second automatic recall pipeline"),
    prepareUserTurnFromSemanticPlan: async () => assert.fail("legacy plan re-injected Mind"),
  });
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
  assert.equal(await runtime.planSemanticPrompt({userId, preparation: prepared()}), null);
  assert.equal(await runtime.completeSemanticPrompt({userId, preparation: prepared(), plan: {} as never, scores: null}), "hello");
  assert.deepEqual(mind.calls, [`reconcile:${userMessageId}`]);
});

test("Retry/Edit still validate the current branch target without a backend recall", async () => {
  for (const operation of ["retry", "edit"] as const) {
    const reader = new Reader();
    reader.value = conversation(oldAssistantId);
    const mind = new Mind();
    const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
    assert.equal(await runtime.preparePrompt({userId, preparation: prepared(operation)}), "hello");
    assert.deepEqual(mind.calls, []);
    await assert.rejects(runtime.preparePrompt({userId, preparation: {...prepared(operation), replacementTargetUserMessageId: "missing"}}), /valid current-path target/);
  }
});

test("missing canonical user and archived conversations remain fail-closed", async () => {
  const reader = new Reader();
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
  await assert.rejects(runtime.preparePrompt({userId, preparation: {...prepared(), canonicalUserMessageId: null}}), /no canonical user/);
  reader.value = {...conversation(), lifecycleStatus: "archived"};
  await assert.rejects(runtime.preparePrompt({userId, preparation: prepared()}), /not active/);
  await assert.rejects(runtime.afterFinalize({userId, preparation: prepared(), assistantMessageId: assistantId, intents: []}), /not active/);
  assert.deepEqual(mind.calls, []);
});

test("complete assistant prose and attachments cannot implicitly write Memory", () => {
  const mind = new Mind();
  // Use the real legacy parser behind the adapter: the production boundary
  // must stop it, rather than merely trusting a fake parser to return no intents.
  mind.parseAssistantBlocks = parseMindWriteIntentsFromBlocks;
  const runtime = new DefaultNativeLiveBackendMindRuntime(new Reader(), mind);
  const blocks: NativeLiveContentBlockInput[] = [
    {kind: "text", text: "hello <memory>remember tea</memory>"},
    {kind: "image", payload: {attachment_id: "synthetic-image"}},
  ];
  const original = structuredClone(blocks);
  const parsed = runtime.parseAssistantBlocks(blocks);
  assert.deepEqual(parsed.visibleBlocks, original);
  assert.deepEqual(parsed.intents, []);
  assert.deepEqual(parsed.actions ?? [], []);
  assert.deepEqual(blocks, original);
});

test("delayed legacy follow-ups cannot write tags or confirm a backend recall; branch reconciliation remains", async () => {
  for (const operation of ["send", "wake", "retry", "edit"] as const) {
    const reader = new Reader();
    reader.value = conversation(assistantId);
    const mind = new Mind();
    const runtime = new DefaultNativeLiveBackendMindRuntime(reader, mind);
    await runtime.afterFinalize({userId, preparation: prepared(operation), assistantMessageId: assistantId,
      intents: [{kind: "memory", text: "remember", sourceStart: 0, sourceEnd: 1, raw: "<memory>remember</memory>"}], stateIds: ["old-id"]});
    assert.deepEqual(mind.calls, operation === "send" || operation === "wake" ? [] : [`reconcile:${assistantId}`]);
    assert.deepEqual(mind.recordInputs, []);
    assert.deepEqual(mind.recallInputs, []);
  }
});

test("legacy follow-up cannot reconcile on a missing finalized assistant", async () => {
  const mind = new Mind();
  const runtime = new DefaultNativeLiveBackendMindRuntime(new Reader(), mind);
  await assert.rejects(runtime.afterFinalize({
    userId, preparation: prepared("edit"), assistantMessageId: "missing",
    intents: [{kind: "memory", text: "remember", sourceStart: 0, sourceEnd: 1, raw: "<memory>remember</memory>"}],
  }), /Finalized canonical assistant/);
  assert.deepEqual(mind.calls, []);
});

test("active call receives spoken-response context, while dictation remains unchanged", async () => {
  const reader = new Reader();
  const voiceCall = userMessage();
  voiceCall.blocks[0]!.payload = {input_mode:"voice", interaction_mode:"call"};
  reader.value = {...conversation(), messages:[parentAssistant(), voiceCall]};
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, new Mind());
  const prompt = await runtime.preparePrompt({
    userId, preparation:{...prepared(), prompt:"喂 & <我>"},
  });
  assert.match(prompt, /<interaction_context kind="voice_call" state="active">/);
  assert.match(prompt, /<user_message input_mode="voice" interaction_mode="call">\[voice\] 喂 &amp; &lt;我&gt;<\/user_message>/);
  assert.match(prompt, /spoken conversation/);
  assert.doesNotMatch(prompt, /ASSEMBLED_PROMPT/);
});

test("text sent after a call exits call mode; unrelated turns stay untouched", async () => {
  const reader = new Reader();
  const lastCall = {...userMessage(), id:"88888888-8888-4888-8888-888888888888"};
  lastCall.blocks = [{...lastCall.blocks[0]!, payload:{input_mode:"voice",interaction_mode:"call"}}];
  const answer = {...parentAssistant(), id:parentId, parentMessageId:lastCall.id};
  const typed = userMessage();
  reader.value = {...conversation(), messages:[lastCall, answer, typed]};
  const runtime = new DefaultNativeLiveBackendMindRuntime(reader, new Mind());
  const prompt = await runtime.preparePrompt({
    userId, preparation:{...prepared(), prompt:"我们打完电话了"},
  });
  assert.match(prompt, /<interaction_context kind="voice_call" state="ended">/);
  assert.match(prompt, /我们打完电话了$/);
  reader.value = {...conversation(), messages:[parentAssistant(), typed]};
  assert.equal(await runtime.preparePrompt({
    userId, preparation:{...prepared(), prompt:"普通文字消息"},
  }), "普通文字消息");
});
