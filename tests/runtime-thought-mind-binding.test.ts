import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeLiveConversation,
  NativeLiveMessage,
} from "../src/domains/conversation/native-live-conversation-types.js";
import {
  DefaultNativeLiveMindRuntime,
} from "../src/domains/runtime/native-live-mind-runtime.js";
import {
  NativeLiveMindLoopService,
  type SubjectStateRuntimePort,
} from "../src/domains/runtime/native-live-mind-loop-service.js";

const now = "2026-09-22T15:30:00.000Z";

class Port implements SubjectStateRuntimePort {
  async list() {
    return [];
  }
  async append() {}
  async transition() {}
  async saveContextManifest() {}
}

class Evolution {
  calls: unknown[] = [];
  shouldFail = false;

  async runOnce(input: unknown) {
    this.calls.push(input);
    if (this.shouldFail) throw new Error("simulated thought evolution failure");
    return {};
  }
}

function userMessage(): NativeLiveMessage {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    conversationId: "11111111-1111-4111-8111-111111111111",
    parentMessageId: null,
    role: "user",
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [{
      id: "33333333-3333-4333-8333-333333333333",
      ordinal: 0,
      kind: "text",
      rawType: "text",
      text: "hello",
      payload: null,
      createdAt: now,
    }],
  };
}

function conversation(): NativeLiveConversation {
  const user = userMessage();
  return {
    id: user.conversationId,
    userId: "u1",
    title: null,
    lifecycleStatus: "active",
    currentHeadMessageId: user.id,
    createdAt: now,
    updatedAt: now,
    messages: [user],
  };
}

function createMind(
  thoughtEvolution: Evolution,
  driveEvolution: Evolution | null = null,
  topicEvolution: Evolution | null = null,
) {
  const service = new NativeLiveMindLoopService(
    new Port(),
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      surfaceLimit: 4,
      breathLimit: 3,
      fixationLimit: 3,
      maxContextItems: 10,
      maxContextChars: 4000,
    },
    null,
  );

  return new DefaultNativeLiveMindRuntime(service, {
    subjectId: "G",
    now: () => now,
    createManifestId: () =>
      "44444444-4444-4444-8444-444444444444",
    thoughtEvolution,
    driveEvolution,
    topicEvolution,
  });
}

test("fresh Mind preparation evolves Drive, Thought and Topic state before Context Assembly", async () => {
  const thoughtEvolution = new Evolution();
  const driveEvolution = new Evolution();
  const topicEvolution = new Evolution();
  const mind = createMind(thoughtEvolution, driveEvolution, topicEvolution);
  const user = userMessage();

  await mind.prepareUserTurn({
    userId: "u1",
    conversation: conversation(),
    userMessage: user,
    userText: "hello",
    surfaceHeadMessageId: null,
  });

  assert.equal(driveEvolution.calls.length, 1);
  assert.equal(thoughtEvolution.calls.length, 1);
  assert.equal(topicEvolution.calls.length, 1);
  assert.deepEqual(driveEvolution.calls[0], {
    userId: "u1",
    subjectId: "G",
    now,
  });
  assert.deepEqual(topicEvolution.calls[0], {
    userId: "u1",
    subjectId: "G",
    now,
  });
});

test("fresh Mind preparation evolves settled Thoughts before Context Assembly", async () => {
  const evolution = new Evolution();
  const mind = createMind(evolution);
  const user = userMessage();

  const prompt = await mind.prepareUserTurn({
    userId: "u1",
    conversation: conversation(),
    userMessage: user,
    userText: "hello",
    surfaceHeadMessageId: null,
  });

  assert.equal(evolution.calls.length, 1);
  assert.deepEqual(evolution.calls[0], {
    userId: "u1",
    subjectId: "G",
    now,
  });
  assert.equal(prompt.includes("<user_message>hello</user_message>"), true);
});

test("Thought evolution maintenance failure is fail-soft for the user turn", async () => {
  const evolution = new Evolution();
  evolution.shouldFail = true;
  const mind = createMind(evolution);
  const user = userMessage();

  const prompt = await mind.prepareUserTurn({
    userId: "u1",
    conversation: conversation(),
    userMessage: user,
    userText: "hello",
    surfaceHeadMessageId: null,
  });

  assert.equal(prompt.includes("<user_message>hello</user_message>"), true);
});

test("semantic planning evolves Thoughts once and completion reuses that snapshot without re-evolving", async () => {
  const evolution = new Evolution();
  const mind = createMind(evolution);
  const user = userMessage();

  const plan = await mind.planSemanticUserTurn({
    userId: "u1",
    conversation: conversation(),
    userMessage: user,
    userText: "hello",
    surfaceHeadMessageId: null,
  });

  assert.equal(plan, null);
  assert.equal(evolution.calls.length, 1);
});
