import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveConversationOrchestrator,
  type NativeLiveClaudeRuntime,
  type NativeLiveConversationPort,
  type NativeLiveNormalizedEvent,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";
import type {
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../src/domains/conversation/native-live-conversation-types.js";

const now = "2026-09-21T00:00:00.000Z";

function userMessage(id: string, parentMessageId: string | null): NativeLiveMessage {
  return {
    id,
    conversationId: "c1",
    parentMessageId,
    role: "user",
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [{ id: "ub", ordinal: 0, kind: "text", rawType: "text", text: "hello", payload: null, createdAt: now }],
  };
}

function assistantMessage(id: string, parentMessageId: string, blocks: NativeLiveContentBlockInput[]): NativeLiveMessage {
  return {
    id,
    conversationId: "c1",
    parentMessageId,
    role: "assistant",
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: blocks.map((block, ordinal) => ({
      id: `b-${ordinal}`,
      ordinal,
      kind: block.kind,
      rawType: block.rawType ?? block.kind,
      text: block.text ?? null,
      payload: block.payload ?? null,
      createdAt: now,
    })),
  };
}

class FakePort implements NativeLiveConversationPort {
  currentHeadMessageId: string | null = null;
  checkpoint: NativeLiveProviderCheckpoint | null = null;
  completedBlocks: NativeLiveContentBlockInput[] | null = null;
  completeCalls = 0;
  nextUserId = 0;

  async getConversation(): Promise<NativeLiveConversation> {
    return {
      id: "c1",
      userId: "u1",
      title: null,
      lifecycleStatus: "active",
      currentHeadMessageId: this.currentHeadMessageId,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }

  async appendUserMessage(input: {
    parentMessageId: string | null;
  }): Promise<NativeLiveMessage> {
    this.nextUserId += 1;
    return userMessage(`u${this.nextUserId}`, input.parentMessageId);
  }

  async completeAssistantTurn(input: {
    parentMessageId: string;
    blocks: NativeLiveContentBlockInput[];
    checkpoint: {
      provider: "claude_code";
      providerSessionId: string;
      providerCheckpointId?: string | null;
    };
  }): Promise<{ message: NativeLiveMessage; checkpoint: NativeLiveProviderCheckpoint }> {
    this.completeCalls += 1;
    this.completedBlocks = input.blocks;
    const message = assistantMessage("a-next", input.parentMessageId, input.blocks);
    const checkpoint: NativeLiveProviderCheckpoint = {
      id: "p-next",
      conversationId: "c1",
      canonicalMessageId: message.id,
      provider: "claude_code",
      providerSessionId: input.checkpoint.providerSessionId,
      providerCheckpointId: null,
      createdAt: now,
    };
    return { message, checkpoint };
  }

  async getProviderCheckpointForHead(): Promise<NativeLiveProviderCheckpoint | null> {
    return this.checkpoint;
  }
}

function events(values: NativeLiveNormalizedEvent[]): NativeLiveNormalizedEvent[] {
  return values;
}

test("first send uses sendNew and maps normalized text/tool events into canonical blocks", async () => {
  const port = new FakePort();
  const calls: string[] = [];
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew(prompt) {
      calls.push(`new:${prompt}`);
      return {
        providerSessionId: "session-1",
        normalizedEvents: events([
          { type: "session", payload: { provider_session_id: "session-1" } },
          { type: "text", payload: { text: "READY" } },
          { type: "tool_use", payload: { tool_use_id: "tu1", tool_name: "Read", input: { path: "x" } } },
          { type: "tool_result", payload: { tool_use_id: "tu1", output: "ok", is_error: false } },
          { type: "result", payload: { status: "success", final_text: "READY" } },
        ]),
      };
    },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
  };

  const result = await new NativeLiveConversationOrchestrator(port, runtime).send({
    userId: "u1",
    conversationId: "c1",
    text: "hello",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["new:hello"]);
  assert.deepEqual(port.completedBlocks?.map((block) => block.kind), [
    "text",
    "tool_use",
    "tool_result",
  ]);
});

test("later send forks from the checkpoint bound to the current canonical assistant head", async () => {
  const port = new FakePort();
  port.currentHeadMessageId = "a1";
  port.checkpoint = {
    id: "p1",
    conversationId: "c1",
    canonicalMessageId: "a1",
    provider: "claude_code",
    providerSessionId: "session-parent",
    providerCheckpointId: null,
    createdAt: now,
  };

  const calls: string[][] = [];
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork(sessionId, prompt) {
      calls.push([sessionId, prompt]);
      return {
        providerSessionId: "session-child",
        normalizedEvents: events([
          { type: "result", payload: { status: "success", final_text: "child reply" } },
        ]),
      };
    },
  };

  const result = await new NativeLiveConversationOrchestrator(port, runtime).send({
    userId: "u1",
    conversationId: "c1",
    text: "next",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [["session-parent", "next"]]);
  assert.equal(port.completedBlocks?.[0]?.rawType, "result");
  assert.equal(port.completedBlocks?.[0]?.text, "child reply");
});

test("runtime failure leaves the persisted user turn without fabricating an assistant turn", async () => {
  const port = new FakePort();
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() { throw new Error("offline"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
  };

  const result = await new NativeLiveConversationOrchestrator(port, runtime).send({
    userId: "u1",
    conversationId: "c1",
    text: "hello",
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "RUNTIME_FAILURE");
  assert.equal(port.completeCalls, 0);
});

test("normalized error events fail closed before canonical assistant completion", async () => {
  const port = new FakePort();
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() {
      return {
        providerSessionId: "session-1",
        normalizedEvents: events([
          { type: "error", payload: { code: "CONFLICTING_SESSION_ID", message: "bad stream" } },
        ]),
      };
    },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
  };

  const result = await new NativeLiveConversationOrchestrator(port, runtime).send({
    userId: "u1",
    conversationId: "c1",
    text: "hello",
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "RUNTIME_PROTOCOL_ERROR");
  assert.equal(port.completeCalls, 0);
});


test("later send fails closed when the current canonical assistant head has no exact checkpoint", async () => {
  const port = new FakePort();
  port.currentHeadMessageId = "a1";
  port.checkpoint = null;

  const calls: string[] = [];
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() {
      calls.push("new");
      return { providerSessionId: "unexpected", normalizedEvents: [] };
    },
    async resume() {
      calls.push("resume");
      return { providerSessionId: "unexpected", normalizedEvents: [] };
    },
    async fork() {
      calls.push("fork");
      return { providerSessionId: "unexpected", normalizedEvents: [] };
    },
  };

  const result = await new NativeLiveConversationOrchestrator(port, runtime).send({
    userId: "u1",
    conversationId: "c1",
    text: "next",
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "CANONICAL_CHECKPOINT_MISSING");
  assert.deepEqual(calls, []);
  assert.equal(port.completeCalls, 0);
});


test("Mind-aware send uses assembled prompt, strips Mind tags before canonical write, and records intents", async () => {
  const port = new FakePort();
  const runtimeCalls: string[] = [];
  const mindCalls: string[] = [];
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew(prompt) {
      runtimeCalls.push(prompt);
      return {
        providerSessionId: "session-mind",
        normalizedEvents: events([
          {
            type: "text",
            payload: {
              text: "VISIBLE <memory>remember this</memory>",
            },
          },
          {
            type: "result",
            payload: {
              status: "success",
              final_text: "VISIBLE <memory>remember this</memory>",
            },
          },
        ]),
      };
    },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
  };

  const mind = {
    async prepareUserTurn() {
      mindCalls.push("prepare");
      return "ASSEMBLED_PROMPT";
    },
    parseAssistantBlocks(blocks: NativeLiveContentBlockInput[]) {
      mindCalls.push("parse");
      return {
        visibleBlocks: blocks.map((block) =>
          block.kind === "text"
            ? { ...block, text: "VISIBLE" }
            : block
        ),
        intents: [{
          kind: "memory" as const,
          text: "remember this",
          sourceStart: 8,
          sourceEnd: 39,
          raw: "<memory>remember this</memory>",
        }],
      };
    },
    async recordAssistantIntents(input: { assistantMessageId: string }) {
      mindCalls.push(`record:${input.assistantMessageId}`);
      return [];
    },
    async reconcileSelectedPath() {
      mindCalls.push("reconcile");
      return [];
    },
  };

  const result = await new NativeLiveConversationOrchestrator(
    port,
    runtime,
    mind,
  ).send({
    userId: "u1",
    conversationId: "c1",
    text: "hello",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(runtimeCalls, ["ASSEMBLED_PROMPT"]);
  assert.deepEqual(mindCalls, [
    "reconcile",
    "prepare",
    "parse",
    "record:a-next",
  ]);
  assert.equal(port.completedBlocks?.[0]?.text, "VISIBLE");
});
