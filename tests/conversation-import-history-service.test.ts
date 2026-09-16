import assert from "node:assert/strict";
import test from "node:test";
import {
  ConversationImportHistoryError,
  ConversationImportHistoryService,
} from "../src/domains/conversation/conversation-import-history-service.js";
import type {
  ConversationImportHistoryDetail,
  ConversationImportHistoryListItem,
  ConversationImportHistoryRepository,
} from "../src/domains/conversation/conversation-import-history-repository.js";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";

function item(): ConversationImportHistoryListItem {
  return {
    sourceId: SOURCE_ID,
    provider: "claude",
    filename: "conversations-000.zip",
    rawSha256: "a".repeat(64),
    rawBytes: 123,
    receivedAt: "2026-09-16T00:00:00.000Z",
    rawSource: {
      kind: "postgres_bytea",
      retained: true,
      encoding: "raw",
      storedBytes: 123,
    },
    runCount: 1,
    processingRunCount: 0,
    executedRunCount: 1,
    failedRunCount: 0,
    supersededRunCount: 0,
    latestRun: {
      id: "22222222-2222-4222-8222-222222222222",
      sourceId: SOURCE_ID,
      parserVersion: "claude-v1",
      status: "executed",
      rawStatus: "executed",
      previewFingerprint: "b".repeat(64),
      warningCount: 0,
      createdAt: "2026-09-16T00:01:00.000Z",
      completedAt: "2026-09-16T00:02:00.000Z",
      supersededByImportRunId: null,
    },
  };
}

function detail(): ConversationImportHistoryDetail {
  const value = item();
  return {
    ...value,
    runs: [{
      ...value.latestRun!,
      summary: { executed: true },
    }],
  };
}

class FakeRepository implements ConversationImportHistoryRepository {
  status: "active" | "disabled" | null = "active";
  source: ConversationImportHistoryDetail | null = detail();
  listInput: Parameters<ConversationImportHistoryRepository["listSources"]>[0] | null = null;
  getInput: Parameters<ConversationImportHistoryRepository["getSource"]>[0] | null = null;

  async findUserStatus() { return this.status; }

  async listSources(input: Parameters<ConversationImportHistoryRepository["listSources"]>[0]) {
    this.listInput = input;
    return {
      items: this.source ? [this.source] : [],
      total: this.source ? 1 : 0,
    };
  }

  async getSource(input: Parameters<ConversationImportHistoryRepository["getSource"]>[0]) {
    this.getInput = input;
    return this.source;
  }
}

test("Conversation import history validates provider and pagination", async () => {
  const repository = new FakeRepository();
  const service = new ConversationImportHistoryService(repository);

  await service.list({
    userId: "user",
    provider: "claude",
    limit: "25",
    offset: "5",
  });

  assert.deepEqual(repository.listInput, {
    userId: "user",
    provider: "claude",
    limit: 25,
    offset: 5,
  });
});

test("Conversation import history source detail validates source ownership input", async () => {
  const repository = new FakeRepository();
  const service = new ConversationImportHistoryService(repository);

  const result = await service.get({
    userId: "user",
    sourceId: SOURCE_ID,
  });

  assert.equal(result.sourceId, SOURCE_ID);
  assert.deepEqual(repository.getInput, {
    userId: "user",
    sourceId: SOURCE_ID,
  });
});

test("Conversation import history rejects disabled users, malformed ids, and missing sources", async () => {
  const repository = new FakeRepository();
  const service = new ConversationImportHistoryService(repository);

  repository.status = "disabled";
  await assert.rejects(
    () => service.list({ userId: "user" }),
    (error: unknown) =>
      error instanceof ConversationImportHistoryError
      && error.code === "CONVERSATION_IMPORT_HISTORY_UNAVAILABLE",
  );

  repository.status = "active";
  await assert.rejects(
    () => service.get({ userId: "user", sourceId: "bad" }),
    (error: unknown) =>
      error instanceof ConversationImportHistoryError
      && error.code === "CONVERSATION_IMPORT_HISTORY_INVALID_REQUEST",
  );

  repository.source = null;
  await assert.rejects(
    () => service.get({ userId: "user", sourceId: SOURCE_ID }),
    (error: unknown) =>
      error instanceof ConversationImportHistoryError
      && error.code === "CONVERSATION_IMPORT_HISTORY_NOT_FOUND",
  );
});

test("Conversation import history rejects invalid provider and pagination", async () => {
  const service = new ConversationImportHistoryService(new FakeRepository());

  await assert.rejects(
    () => service.list({ userId: "user", provider: "other" }),
    (error: unknown) =>
      error instanceof ConversationImportHistoryError
      && error.code === "CONVERSATION_IMPORT_HISTORY_INVALID_REQUEST",
  );
  await assert.rejects(
    () => service.list({ userId: "user", limit: "0" }),
    (error: unknown) =>
      error instanceof ConversationImportHistoryError
      && error.code === "CONVERSATION_IMPORT_HISTORY_INVALID_REQUEST",
  );
});
