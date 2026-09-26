import assert from "node:assert/strict";
import test from "node:test";
import { NativeLiveConversationOrchestrator } from "../src/domains/conversation/native-live-conversation-orchestrator.js";
import { NativeLiveConversationBranchOrchestrator } from "../src/domains/conversation/native-live-conversation-branch-orchestrator.js";
import type {
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../src/domains/conversation/native-live-conversation-types.js";

const now = "2026-09-22T09:55:00.000Z";

function block(text: string) {
  return {
    id: crypto.randomUUID(),
    ordinal: 0,
    kind: "text" as const,
    rawType: "text",
    text,
    payload: null,
    createdAt: now,
  };
}

function user(id: string, parentMessageId: string | null, text: string): NativeLiveMessage {
  return {
    id,
    conversationId: "c1",
    parentMessageId,
    role: "user",
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [block(text)],
  };
}

function assistant(id: string, parentMessageId: string, text = "reply"): NativeLiveMessage {
  return {
    id,
    conversationId: "c1",
    parentMessageId,
    role: "assistant",
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [block(text)],
  };
}

class Port {
  messages: NativeLiveMessage[] = [];
  currentHeadMessageId: string | null = null;
  checkpoint: NativeLiveProviderCheckpoint | null = null;
  nextUser = 0;
  nextAssistant = 0;

  async getConversation(): Promise<NativeLiveConversation> {
    return {
      id: "c1",
      userId: "u1",
      title: null,
      lifecycleStatus: "active",
      currentHeadMessageId: this.currentHeadMessageId,
      createdAt: now,
      updatedAt: now,
      messages: [...this.messages],
    };
  }

  async appendUserMessage(input: {
    parentMessageId: string | null;
    blocks: NativeLiveContentBlockInput[];
  }) {
    const next = user(
      `u-${++this.nextUser}`,
      input.parentMessageId,
      input.blocks[0]?.text ?? "",
    );
    this.messages.push(next);
    return next;
  }

  async completeAssistantTurn(input: {
    parentMessageId: string;
    blocks: NativeLiveContentBlockInput[];
    checkpoint: { provider: "claude_code"; providerSessionId: string };
  }) {
    const next = assistant(
      `a-${++this.nextAssistant}`,
      input.parentMessageId,
      input.blocks[0]?.text ?? "",
    );
    this.messages.push(next);
    this.currentHeadMessageId = next.id;
    const checkpoint: NativeLiveProviderCheckpoint = {
      id: `p-${this.nextAssistant}`,
      conversationId: "c1",
      canonicalMessageId: next.id,
      provider: "claude_code",
      providerSessionId: input.checkpoint.providerSessionId,
      providerCheckpointId: null,
      createdAt: now,
    };
    this.checkpoint = checkpoint;
    return { message: next, checkpoint };
  }

  async getProviderCheckpointForHead() {
    return this.checkpoint;
  }
}

const runtime = {
  async sendNew() {
    return {
      providerSessionId: "session-new",
      normalizedEvents: [{
        type: "result" as const,
        payload: { status: "success", final_text: "READY" },
      }],
    };
  },
  async resume() {
    throw new Error("unused");
  },
  async fork() {
    return {
      providerSessionId: "session-child",
      normalizedEvents: [{
        type: "result" as const,
        payload: { status: "success", final_text: "READY" },
      }],
    };
  },
};

test("successful ordinary send schedules background Distillation exactly once", async () => {
  const port = new Port();
  const scheduled: unknown[] = [];
  const trigger = {
    schedule(input: unknown) {
      scheduled.push(input);
    },
  };

  const result = await new NativeLiveConversationOrchestrator(
    port,
    runtime,
    null,
    trigger,
  ).send({
    userId: "u1",
    conversationId: "c1",
    text: "hello",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(scheduled, [{ userId: "u1", conversationId: "c1" }]);
});

test("failed ordinary send never schedules background Distillation", async () => {
  const port = new Port();
  const scheduled: unknown[] = [];
  const trigger = {
    schedule(input: unknown) {
      scheduled.push(input);
    },
  };
  const failing = {
    async sendNew() {
      throw new Error("offline");
    },
    async resume() {
      throw new Error("unused");
    },
    async fork() {
      throw new Error("unused");
    },
  };

  const result = await new NativeLiveConversationOrchestrator(
    port,
    failing,
    null,
    trigger,
  ).send({
    userId: "u1",
    conversationId: "c1",
    text: "hello",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(scheduled, []);
});

test("successful historical Retry schedules background Distillation after the new sibling commits", async () => {
  const port = new Port();
  const root = user("u-root", null, "root");
  const a1 = assistant("a-root", "u-root");
  const target = user("u-target", "a-root", "retry me");
  const old = assistant("a-old", "u-target");
  port.messages = [root, a1, target, old];
  port.currentHeadMessageId = "a-old";
  port.checkpoint = {
    id: "p-root",
    conversationId: "c1",
    canonicalMessageId: "a-root",
    provider: "claude_code",
    providerSessionId: "session-parent",
    providerCheckpointId: null,
    createdAt: now,
  };

  const scheduled: unknown[] = [];
  const result = await new NativeLiveConversationBranchOrchestrator(
    port,
    runtime,
    null,
    {
      schedule(input: unknown) {
        scheduled.push(input);
      },
    },
  ).retry({
    userId: "u1",
    conversationId: "c1",
    targetUserMessageId: "u-target",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(scheduled, [{ userId: "u1", conversationId: "c1" }]);
});
