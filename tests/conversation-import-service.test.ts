import assert from "node:assert/strict";
import test from "node:test";
import { ConversationImportService } from "../src/domains/conversation/conversation-import-service.js";
import type {
  ConversationImportRepository,
  ConversationStoredBlob,
  ConversationStoredSource,
} from "../src/domains/conversation/conversation-import-repository.js";
import type {
  ConversationArchiveStateRepository,
} from "../src/domains/conversation/conversation-state-repository.js";
import type {
  ConversationMergeCurrentState,
} from "../src/domains/conversation/conversation-merge-planner.js";
import {
  conversationMessageSourceFingerprint,
  conversationSourceFingerprint,
} from "../src/domains/conversation/conversation-fingerprint.js";
import { ChatGPTExportParser } from "../src/domains/conversation/chatgpt-export-parser.js";
import { chatGptConversationFixture } from "./fixtures/chatgpt-conversation-export.js";
import { claudeConversationFixture } from "./fixtures/claude-conversation-export.js";

async function *stream(buffer: Buffer): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < buffer.length; offset += 17) {
    yield buffer.subarray(offset, Math.min(buffer.length, offset + 17));
  }
}

class FakeImportRepository implements ConversationImportRepository {
  source: ConversationStoredSource | null = null;
  blob: ConversationStoredBlob | null = null;
  run = 0;
  executed = false;

  async findUserById() {
    return { status: "active" as const };
  }

  async findSourceBySha(_userId: string, rawSha256: string) {
    return this.source?.rawSha256 === rawSha256 ? this.source : null;
  }

  async createOrReuseSourceWithBlob(input: {
    userId: string;
    provider: "chatgpt" | "claude";
    originalFilename: string;
    rawSha256: string;
    rawBytes: number;
    encoding: "raw" | "gzip";
    data: Buffer;
  }) {
    if (this.source?.rawSha256 === input.rawSha256) {
      return { source: this.source, reused: true };
    }
    this.source = {
      id: "source-id",
      userId: input.userId,
      provider: input.provider,
      originalFilename: input.originalFilename,
      rawSha256: input.rawSha256,
      rawBytes: input.rawBytes,
      storageKind: "postgres_bytea",
      storageKey: "source-id",
    };
    this.blob = {
      sourceId: "source-id",
      encoding: input.encoding,
      originalBytes: input.rawBytes,
      storedBytes: input.data.length,
      data: input.data,
    };
    return { source: this.source, reused: false };
  }

  async createPreviewRun() {
    this.run += 1;
    return { id: `run-${this.run}` };
  }

  async findExecutedRun() {
    return this.executed ? { id: "executed-run" } : null;
  }

  async readStoredBlob() {
    return this.blob;
  }
}

class FakeStateRepository implements ConversationArchiveStateRepository {
  constructor(public state: ConversationMergeCurrentState = { conversations: [] }) {}

  async withTransaction<T>(
    work: (repository: ConversationArchiveStateRepository) => Promise<T>,
  ): Promise<T> {
    return work(this);
  }

  async readMergeState(): Promise<ConversationMergeCurrentState> {
    return this.state;
  }
}

function chatGptCurrentState(): ConversationMergeCurrentState {
  const conversation = ChatGPTExportParser
    .normalizeConversation(JSON.parse(JSON.stringify(chatGptConversationFixture)))
    .conversation;
  return {
    conversations: [{
      id: "conversation-db",
      provider: conversation.provider,
      sourceConversationId: conversation.sourceConversationId,
      sourceFingerprint: conversationSourceFingerprint(conversation),
      sourceCreatedAt: conversation.sourceCreatedAt,
      sourceUpdatedAt: conversation.sourceUpdatedAt,
      messages: conversation.messages.map((message, index) => ({
        id: `message-${index}`,
        sourceNodeId: message.sourceNodeId,
        sourceFingerprint: conversationMessageSourceFingerprint(message),
        sourceCreatedAt: message.sourceCreatedAt,
        sourceUpdatedAt: message.sourceUpdatedAt,
        isCurrentPath: message.isCurrentPath,
        currentPathIndex: message.currentPathIndex,
        turnIndex: message.turnIndex,
      })),
    }],
  };
}

test("Conversation import Preview detects ChatGPT, plans creates, and archives the exact source losslessly", async () => {
  const repository = new FakeImportRepository();
  const state = new FakeStateRepository();
  const service = new ConversationImportService(repository, state);
  const raw = Buffer.from(JSON.stringify([chatGptConversationFixture]), "utf8");

  const preview = await service.preview(stream(raw), "conversations.json", "user-id");

  assert.equal(preview.provider, "chatgpt");
  assert.equal(preview.parser_version, "chatgpt-v1");
  assert.equal(preview.summary.conversations.create, 1);
  assert.equal(
    preview.summary.messages.create,
    ChatGPTExportParser.normalizeConversation(chatGptConversationFixture).conversation.messages.length,
  );
  assert.equal(preview.warning_count, 0);
  assert.equal(preview.source_reused, false);
  assert.equal(repository.blob?.encoding, "gzip");
  assert.ok((repository.blob?.storedBytes ?? raw.length + 1) < raw.length);
});

test("re-previewing the same raw file reuses its immutable source archive", async () => {
  const repository = new FakeImportRepository();
  const service = new ConversationImportService(repository, new FakeStateRepository());
  const raw = Buffer.from(JSON.stringify([chatGptConversationFixture]), "utf8");

  const first = await service.preview(stream(raw), "first.json", "user-id");
  const second = await service.preview(stream(raw), "renamed.json", "user-id");

  assert.equal(first.source_id, second.source_id);
  assert.equal(second.source_reused, true);
  assert.equal(second.raw_sha256, first.raw_sha256);
});

test("Preview classifies an already-canonical ChatGPT export as unchanged", async () => {
  const repository = new FakeImportRepository();
  const state = new FakeStateRepository(chatGptCurrentState());
  const service = new ConversationImportService(repository, state);
  const raw = Buffer.from(JSON.stringify([chatGptConversationFixture]), "utf8");

  const preview = await service.preview(stream(raw), "conversations.json", "user-id");

  assert.deepEqual(preview.summary.conversations, {
    create: 0,
    update: 0,
    unchanged: 1,
    stale: 0,
  });
  assert.equal(preview.summary.messages.create, 0);
  assert.equal(preview.summary.messages.update, 0);
  assert.ok(preview.summary.messages.unchanged > 0);
  assert.equal(preview.summary.messages.path_changed, 0);
});

test("Claude Preview uses the real-shape adapter and surfaces preserved internal-block warnings", async () => {
  const repository = new FakeImportRepository();
  const service = new ConversationImportService(repository, new FakeStateRepository());
  const raw = Buffer.from(JSON.stringify([claudeConversationFixture]), "utf8");

  const preview = await service.preview(stream(raw), "conversations.json", "user-id");

  assert.equal(preview.provider, "claude");
  assert.equal(preview.parser_version, "claude-v1");
  assert.equal(preview.warning_codes.CLAUDE_UNKNOWN_CONTENT_TYPE, 1);
  assert.equal(preview.summary.conversations.create, 1);
});
