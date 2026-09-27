import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import type {
  NativeLiveContentBlock,
  NativeLiveConversation,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../src/domains/conversation/native-live-conversation-types.js";

function message(id: string, role: "user" | "assistant"): NativeLiveMessage {
  return {
    id,
    conversationId: "c1",
    parentMessageId: role === "assistant" ? "u1" : null,
    role,
    status: "completed",
    createdAt: "2026-09-21T00:00:00.000Z",
    completedAt: "2026-09-21T00:00:00.000Z",
    blocks: [],
  };
}

class FakeRepository implements NativeLiveConversationRepository {
  events: string[] = [];
  throwOnCheckpoint = false;

  async withTransaction<T>(
    work: (repository: NativeLiveConversationRepository) => Promise<T>,
  ): Promise<T> {
    this.events.push("tx:start");
    try {
      const result = await work(this);
      this.events.push("tx:commit");
      return result;
    } catch (error) {
      this.events.push("tx:rollback");
      throw error;
    }
  }

  async createConversation(): Promise<NativeLiveConversation> {
    throw new Error("unused");
  }

  async getConversation(): Promise<NativeLiveConversation | null> {
    return null;
  }

  async renameConversation() {
    this.events.push("rename");
    return {
      id: "c1",
      title: "Renamed",
      currentHeadMessageId: null,
      lastMessageAt: null,
      createdAt: "2026-09-21T00:00:00.000Z",
      updatedAt: "2026-09-21T00:01:00.000Z",
    };
  }

  async archiveConversation() {
    this.events.push("archive");
    return {
      outcome: "archived" as const,
      archivedAt: "2026-09-21T00:00:00.000Z",
    };
  }

  async restoreConversation() {
    this.events.push("restore");
    return { outcome: "restored" as const };
  }

  async deleteConversation() {
    this.events.push("delete");
    return { outcome: "deleted" as const };
  }

  async appendUserMessage(): Promise<NativeLiveMessage> {
    this.events.push("user");
    return message("u1", "user");
  }

  async appendAssistantMessage(): Promise<NativeLiveMessage> {
    this.events.push("assistant");
    return message("a1", "assistant");
  }

  async appendContentBlock(input: { ordinal: number }): Promise<NativeLiveContentBlock> {
    this.events.push(`block:${input.ordinal}`);
    return {
      id: `b${input.ordinal}`,
      ordinal: input.ordinal,
      kind: "text",
      rawType: "text",
      text: null,
      payload: null,
      createdAt: "2026-09-21T00:00:00.000Z",
    };
  }

  async setCurrentHead(): Promise<void> {
    this.events.push("head");
  }

  async bindProviderCheckpoint(): Promise<NativeLiveProviderCheckpoint> {
    this.events.push("checkpoint");
    if (this.throwOnCheckpoint) throw new Error("checkpoint failed");
    return {
      id: "p1",
      conversationId: "c1",
      canonicalMessageId: "a1",
      provider: "claude_code",
      providerSessionId: "session-1",
      providerCheckpointId: "checkpoint-1",
      createdAt: "2026-09-21T00:00:00.000Z",
    };
  }

  async getProviderCheckpointForHead(): Promise<NativeLiveProviderCheckpoint | null> {
    return null;
  }
}

test("appendUserMessage writes the immutable user row and blocks in one transaction", async () => {
  const repository = new FakeRepository();
  const service = new NativeLiveConversationService(repository);

  await service.appendUserMessage({
    userId: "user-1",
    conversationId: "c1",
    parentMessageId: null,
    blocks: [
      { kind: "text", text: "hello" },
      { kind: "attachment", payload: { name: "a.txt" } },
    ],
  });

  assert.deepEqual(repository.events, [
    "tx:start",
    "user",
    "block:0",
    "block:1",
    "tx:commit",
  ]);
});

test("completeAssistantTurn orders assistant, blocks, checkpoint, then head inside one transaction", async () => {
  const repository = new FakeRepository();
  const service = new NativeLiveConversationService(repository);

  await service.completeAssistantTurn({
    userId: "user-1",
    conversationId: "c1",
    parentMessageId: "u1",
    blocks: [{ kind: "text", text: "reply" }],
    checkpoint: {
      provider: "claude_code",
      providerSessionId: "session-1",
      providerCheckpointId: "checkpoint-1",
    },
  });

  assert.deepEqual(repository.events, [
    "tx:start",
    "assistant",
    "block:0",
    "checkpoint",
    "head",
    "tx:commit",
  ]);
});

test("completeAssistantTurn never advances head after checkpoint failure", async () => {
  const repository = new FakeRepository();
  repository.throwOnCheckpoint = true;
  const service = new NativeLiveConversationService(repository);

  await assert.rejects(
    service.completeAssistantTurn({
      userId: "user-1",
      conversationId: "c1",
      parentMessageId: "u1",
      blocks: [{ kind: "text", text: "reply" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: "session-1",
      },
    }),
    /checkpoint failed/,
  );

  assert.deepEqual(repository.events, [
    "tx:start",
    "assistant",
    "block:0",
    "checkpoint",
    "tx:rollback",
  ]);
});


test("archive and restore delegate to the repository lifecycle boundary", async () => {
  const repository = new FakeRepository();
  const service = new NativeLiveConversationService(repository);

  const archived = await service.archiveConversation({
    userId: "user-1",
    conversationId: "c1",
  });
  assert.equal(archived.outcome, "archived");

  const restored = await service.restoreConversation({
    userId: "user-1",
    conversationId: "c1",
  });
  assert.equal(restored.outcome, "restored");
  assert.deepEqual(repository.events, ["archive", "restore"]);
});

test("deleteConversation delegates to the repository lifecycle boundary", async () => {
  const repository = new FakeRepository();
  const service = new NativeLiveConversationService(repository);

  const result = await service.deleteConversation({
    userId: "user-1",
    conversationId: "c1",
  });

  assert.equal(result.outcome, "deleted");
  assert.deepEqual(repository.events, ["delete"]);
});


test("renameConversation delegates to the repository lifecycle boundary", async () => {
  const repository = new FakeRepository();
  const service = new NativeLiveConversationService(repository);

  const result = await service.renameConversation({
    userId: "user-1",
    conversationId: "c1",
    title: "Renamed",
  });

  assert.equal(result?.title, "Renamed");
  assert.deepEqual(repository.events, ["rename"]);
});
