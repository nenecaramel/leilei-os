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
  listCalls = 0;
  saved = 0;

  async list() {
    this.listCalls += 1;
    return [];
  }
  async append() {}
  async transition() {}
  async saveContextManifest() {
    this.saved += 1;
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

function createMind(port: Port) {
  const service = new NativeLiveMindLoopService(
    port,
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
  });
}

test("foreground Mind binding now owns Context Assembly only, not general Subject evolution", async () => {
  const port = new Port();
  const mind = createMind(port);
  const user = userMessage();

  const prompt = await mind.prepareUserTurn({
    userId: "u1",
    conversation: conversation(),
    userMessage: user,
    userText: "hello",
    surfaceHeadMessageId: null,
  });

  assert.equal(prompt.includes("<user_message>hello</user_message>"), true);
  assert.equal(port.listCalls, 1);
  assert.equal(port.saved, 1);
});

test("semantic planning remains independent from Background Loop maintenance", async () => {
  const port = new Port();
  const mind = createMind(port);
  const user = userMessage();

  const plan = await mind.planSemanticUserTurn({
    userId: "u1",
    conversation: conversation(),
    userMessage: user,
    userText: "hello",
    surfaceHeadMessageId: null,
  });

  assert.equal(plan, null);
  assert.equal(port.listCalls, 0);
  assert.equal(port.saved, 0);
});
