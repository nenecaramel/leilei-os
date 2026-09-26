import assert from "node:assert/strict";
import test from "node:test";
import { NativeLiveConversationBranchOrchestrator } from "../src/domains/conversation/native-live-conversation-branch-orchestrator.js";
import type {
  NativeLiveClaudeRuntime,
  NativeLiveConversationPort,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";
import type {
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../src/domains/conversation/native-live-conversation-types.js";

const now = "2026-09-21T00:00:00.000Z";

function textBlock(id: string, text: string) {
  return { id, ordinal: 0, kind: "text" as const, rawType: "text", text, payload: null, createdAt: now };
}

function user(id: string, parentMessageId: string | null, text: string): NativeLiveMessage {
  return {
    id, conversationId: "c1", parentMessageId, role: "user", status: "completed",
    createdAt: now, completedAt: now, blocks: [textBlock(`b-${id}`, text)],
  };
}

function assistant(id: string, parentMessageId: string): NativeLiveMessage {
  return {
    id, conversationId: "c1", parentMessageId, role: "assistant", status: "completed",
    createdAt: now, completedAt: now, blocks: [textBlock(`b-${id}`, "assistant")],
  };
}

class FakePort implements NativeLiveConversationPort {
  messages: NativeLiveMessage[] = [
    user("u-root", null, "root prompt"),
    assistant("a1", "u-root"),
    user("u2", "a1", "original prompt"),
    assistant("a-old", "u2"),
  ];
  checkpoints = new Map<string, NativeLiveProviderCheckpoint>([
    ["a1", {
      id: "p-a1", conversationId: "c1", canonicalMessageId: "a1", provider: "claude_code",
      providerSessionId: "session-parent", providerCheckpointId: null, createdAt: now,
    }],
  ]);
  appendCalls: Array<{ parentMessageId: string | null; blocks: NativeLiveContentBlockInput[] }> = [];
  completeCalls: Array<{ parentMessageId: string; blocks: NativeLiveContentBlockInput[]; providerSessionId: string }> = [];
  nextUser = 0;

  async getConversation(): Promise<NativeLiveConversation> {
    return {
      id: "c1", userId: "u1", title: null, lifecycleStatus: "active",
      currentHeadMessageId: "a-old", createdAt: now, updatedAt: now, messages: [...this.messages],
    };
  }

  async appendUserMessage(input: { parentMessageId: string | null; blocks: NativeLiveContentBlockInput[] }): Promise<NativeLiveMessage> {
    this.appendCalls.push({ parentMessageId: input.parentMessageId, blocks: input.blocks });
    this.nextUser += 1;
    const message = user(`u-edit-${this.nextUser}`, input.parentMessageId, input.blocks[0]?.text ?? "");
    this.messages.push(message);
    return message;
  }

  async completeAssistantTurn(input: {
    parentMessageId: string;
    blocks: NativeLiveContentBlockInput[];
    checkpoint: { provider: "claude_code"; providerSessionId: string; providerCheckpointId?: string | null };
  }): Promise<{ message: NativeLiveMessage; checkpoint: NativeLiveProviderCheckpoint }> {
    this.completeCalls.push({
      parentMessageId: input.parentMessageId, blocks: input.blocks, providerSessionId: input.checkpoint.providerSessionId,
    });
    const message = assistant(`a-new-${this.completeCalls.length}`, input.parentMessageId);
    const checkpoint: NativeLiveProviderCheckpoint = {
      id: `p-new-${this.completeCalls.length}`, conversationId: "c1", canonicalMessageId: message.id,
      provider: "claude_code", providerSessionId: input.checkpoint.providerSessionId, providerCheckpointId: null, createdAt: now,
    };
    return { message, checkpoint };
  }

  async getProviderCheckpointForHead(input: { canonicalMessageId: string }): Promise<NativeLiveProviderCheckpoint | null> {
    return this.checkpoints.get(input.canonicalMessageId) ?? null;
  }
}

function successfulRuntime(calls: string[][]): NativeLiveClaudeRuntime {
  return {
    async sendNew(prompt) {
      calls.push(["new", prompt]);
      return { providerSessionId: "session-new", normalizedEvents: [{ type: "result", payload: { status: "success", final_text: "READY" } }] };
    },
    async resume() { throw new Error("resume must not be used"); },
    async fork(sessionId, prompt) {
      calls.push(["fork", sessionId, prompt]);
      return { providerSessionId: "session-child", normalizedEvents: [{ type: "result", payload: { status: "success", final_text: "READY" } }] };
    },
  };
}

test("retry creates an assistant sibling from the checkpoint before the target user message", async () => {
  const port = new FakePort();
  const calls: string[][] = [];
  const result = await new NativeLiveConversationBranchOrchestrator(port, successfulRuntime(calls)).retry({
    userId: "u1", conversationId: "c1", targetUserMessageId: "u2",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [["fork", "session-parent", "original prompt"]]);
  assert.equal(port.appendCalls.length, 0);
  assert.equal(port.completeCalls[0]?.parentMessageId, "u2");
  assert.equal(port.completeCalls[0]?.providerSessionId, "session-child");
});

test("retrying the root user message starts a fresh provider checkpoint", async () => {
  const port = new FakePort();
  const calls: string[][] = [];
  const result = await new NativeLiveConversationBranchOrchestrator(port, successfulRuntime(calls)).retry({
    userId: "u1", conversationId: "c1", targetUserMessageId: "u-root",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [["new", "root prompt"]]);
  assert.equal(port.completeCalls[0]?.parentMessageId, "u-root");
});

test("edit creates a new user sibling under the historical assistant then forks that checkpoint", async () => {
  const port = new FakePort();
  const calls: string[][] = [];
  const result = await new NativeLiveConversationBranchOrchestrator(port, successfulRuntime(calls)).edit({
    userId: "u1", conversationId: "c1", targetUserMessageId: "u2", text: "edited prompt",
  });
  assert.equal(result.ok, true);
  assert.equal(port.appendCalls.length, 1);
  assert.equal(port.appendCalls[0]?.parentMessageId, "a1");
  assert.equal(port.appendCalls[0]?.blocks[0]?.text, "edited prompt");
  assert.deepEqual(calls, [["fork", "session-parent", "edited prompt"]]);
  assert.equal(port.completeCalls[0]?.parentMessageId, result.userMessage.id);
});

test("edit runtime failure keeps the edited user row and does not fabricate an assistant", async () => {
  const port = new FakePort();
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() { throw new Error("offline"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("offline"); },
  };
  const result = await new NativeLiveConversationBranchOrchestrator(port, runtime).edit({
    userId: "u1", conversationId: "c1", targetUserMessageId: "u2", text: "edited prompt",
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "RUNTIME_FAILURE");
  assert.equal(port.appendCalls.length, 1);
  assert.equal(port.completeCalls.length, 0);
});

test("historical retry fails closed when its parent assistant checkpoint is missing", async () => {
  const port = new FakePort();
  port.checkpoints.clear();
  const calls: string[][] = [];
  await assert.rejects(
    new NativeLiveConversationBranchOrchestrator(port, successfulRuntime(calls)).retry({
      userId: "u1", conversationId: "c1", targetUserMessageId: "u2",
    }),
    /checkpoint not found/i,
  );
  assert.deepEqual(calls, []);
  assert.equal(port.completeCalls.length, 0);
});


test("Mind-aware Retry assembles from the historical path and reconciles only after the sibling assistant commits", async () => {
  const port = new FakePort();
  const runtimeCalls: string[][] = [];
  const mindCalls: string[] = [];
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew(prompt) {
      runtimeCalls.push(["new", prompt]);
      return {
        providerSessionId: "session-new",
        normalizedEvents: [{
          type: "result",
          payload: { status: "success", final_text: "VISIBLE <memory>new path</memory>" },
        }],
      };
    },
    async resume() { throw new Error("unused"); },
    async fork(sessionId, prompt) {
      runtimeCalls.push(["fork", sessionId, prompt]);
      return {
        providerSessionId: "session-child",
        normalizedEvents: [{
          type: "result",
          payload: { status: "success", final_text: "VISIBLE <memory>new path</memory>" },
        }],
      };
    },
  };
  const mind = {
    async prepareUserTurn(input: { surfaceHeadMessageId: string | null }) {
      mindCalls.push(`prepare:${input.surfaceHeadMessageId ?? "root"}`);
      return "HISTORICAL_MIND_PROMPT";
    },
    parseAssistantBlocks(blocks: NativeLiveContentBlockInput[]) {
      mindCalls.push("parse");
      return {
        visibleBlocks: blocks.map((block) =>
          block.kind === "text" ? { ...block, text: "VISIBLE" } : block
        ),
        intents: [{
          kind: "memory" as const,
          text: "new path",
          sourceStart: 8,
          sourceEnd: 33,
          raw: "<memory>new path</memory>",
        }],
      };
    },
    async recordAssistantIntents(input: { assistantMessageId: string }) {
      mindCalls.push(`record:${input.assistantMessageId}`);
      return [];
    },
    async reconcileSelectedPath(input: { conversation: NativeLiveConversation }) {
      mindCalls.push(`reconcile:${input.conversation.currentHeadMessageId}`);
      return [];
    },
  };

  const result = await new NativeLiveConversationBranchOrchestrator(
    port,
    runtime,
    mind,
  ).retry({
    userId: "u1",
    conversationId: "c1",
    targetUserMessageId: "u2",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(runtimeCalls, [[
    "fork",
    "session-parent",
    "HISTORICAL_MIND_PROMPT",
  ]]);
  assert.deepEqual(mindCalls, [
    "prepare:a1",
    "parse",
    "record:a-new-1",
    "reconcile:a-new-1",
  ]);
  assert.equal(port.completeCalls[0]?.blocks[0]?.text, "VISIBLE");
});
