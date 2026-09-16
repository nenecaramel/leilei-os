import assert from "node:assert/strict";
import test from "node:test";
import { ConversationImportService } from "../src/domains/conversation/conversation-import-service.js";
import type {
  ConversationImportRepository,
  ConversationStoredBlob,
  ConversationStoredRun,
  ConversationStoredSource,
} from "../src/domains/conversation/conversation-import-repository.js";
import type {
  ConversationImportExecutionTransaction,
  ConversationImportExecutor,
} from "../src/domains/conversation/conversation-import-executor.js";
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
import type { ConversationExclusionRule } from "../src/domains/conversation/conversation-exclusions.js";

async function *stream(buffer: Buffer): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < buffer.length; offset += 17) {
    yield buffer.subarray(offset, Math.min(buffer.length, offset + 17));
  }
}

class FakeImportRepository implements ConversationImportRepository {
  source: ConversationStoredSource | null = null;
  blob: ConversationStoredBlob | null = null;
  sourceCounter = 0;
  runCounter = 0;
  sourcesBySha = new Map<string, ConversationStoredSource>();
  blobsBySource = new Map<string, ConversationStoredBlob>();
  runs = new Map<string, ConversationStoredRun>();
  exclusions: ConversationExclusionRule[] = [];

  async findUserById() {
    return { status: "active" as const };
  }

  async findSourceBySha(_userId: string, rawSha256: string) {
    return this.sourcesBySha.get(rawSha256) ?? null;
  }

  async findSourceById(userId: string, sourceId: string) {
    return [...this.sourcesBySha.values()].find(
      (source) => source.userId === userId && source.id === sourceId,
    ) ?? null;
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
    const existing = this.sourcesBySha.get(input.rawSha256);
    if (existing) {
      this.source = existing;
      this.blob = this.blobsBySource.get(existing.id) ?? null;
      return { source: existing, reused: true };
    }
    this.sourceCounter += 1;
    const sourceId = `10000000-0000-4000-8000-${String(this.sourceCounter).padStart(12, "0")}`;
    const source: ConversationStoredSource = {
      id: sourceId,
      userId: input.userId,
      provider: input.provider,
      originalFilename: input.originalFilename,
      rawSha256: input.rawSha256,
      rawBytes: input.rawBytes,
      storageKind: "postgres_bytea",
      storageKey: sourceId,
    };
    const blob: ConversationStoredBlob = {
      sourceId,
      encoding: input.encoding,
      originalBytes: input.rawBytes,
      storedBytes: input.data.length,
      data: input.data,
    };
    this.sourcesBySha.set(input.rawSha256, source);
    this.blobsBySource.set(sourceId, blob);
    this.source = source;
    this.blob = blob;
    return { source, reused: false };
  }

  async createPreviewRun(input: {
    userId: string;
    sourceId: string;
    parserVersion: string;
    executionKey: string;
    previewFingerprint: string;
    summary: Record<string, unknown>;
    warningCount: number;
  }) {
    this.runCounter += 1;
    const source = [...this.sourcesBySha.values()]
      .find((candidate) => candidate.id === input.sourceId);
    if (!source) throw new Error("source missing");
    const id = `20000000-0000-4000-8000-${String(this.runCounter).padStart(12, "0")}`;
    this.runs.set(id, {
      id,
      userId: input.userId,
      sourceId: input.sourceId,
      parserVersion: input.parserVersion,
      executionKey: input.executionKey,
      status: "processing",
      previewFingerprint: input.previewFingerprint,
      summary: input.summary,
      warningCount: input.warningCount,
      completedAt: null,
      source,
    });
    return { id };
  }

  async findExecutedRun(input: {
    userId: string;
    sourceId: string;
    parserVersion: string;
    previewFingerprint: string;
    executionKey: string;
  }) {
    for (const run of this.runs.values()) {
      if (
        run.userId === input.userId
        && run.sourceId === input.sourceId
        && run.parserVersion === input.parserVersion
        && run.previewFingerprint === input.previewFingerprint
        && run.executionKey === input.executionKey
        && run.status === "executed"
      ) {
        return { id: run.id, summary: run.summary };
      }
    }
    return null;
  }

  async findRunById(input: { userId: string; runId: string }) {
    const run = this.runs.get(input.runId);
    return run?.userId === input.userId ? run : null;
  }

  async listExclusions() {
    return this.exclusions;
  }

  async readStoredBlob(input: { userId: string; sourceId: string }) {
    const source = [...this.sourcesBySha.values()]
      .find((candidate) => candidate.id === input.sourceId && candidate.userId === input.userId);
    return source ? this.blobsBySource.get(input.sourceId) ?? null : null;
  }
}

class FakeExecutor implements ConversationImportExecutor {
  applied: string[] = [];

  constructor(
    private readonly repository: FakeImportRepository,
    public state: ConversationMergeCurrentState = { conversations: [] },
  ) {}

  async serializable<T>(
    work: (transaction: ConversationImportExecutionTransaction) => Promise<T>,
  ): Promise<T> {
    const repository = this.repository;
    const executor = this;
    const transaction: ConversationImportExecutionTransaction = {
      async lockSource(userId, sourceId) {
        return [...repository.sourcesBySha.values()].some(
          (source) => source.id === sourceId && source.userId === userId,
        );
      },
      async lockRun(userId, runId) {
        const run = await repository.findRunById({ userId, runId });
        return run ? {
          id: run.id,
          sourceId: run.sourceId,
          parserVersion: run.parserVersion,
          executionKey: run.executionKey,
          status: run.status,
          previewFingerprint: run.previewFingerprint,
          summary: run.summary,
          warningCount: run.warningCount,
        } : null;
      },
      async findExecutedRun(input) {
        return repository.findExecutedRun(input);
      },
      async readMergeState() {
        return executor.state;
      },
      async readExclusions() {
        return repository.exclusions;
      },
      async readStoredBlob(input) {
        return repository.readStoredBlob(input);
      },
      async applyConversation(input) {
        executor.applied.push(input.item.sourceConversationId);
      },
      async markRunExecuted(input) {
        const run = repository.runs.get(input.runId);
        if (!run) throw new Error("run missing");
        run.status = "executed";
        run.summary = input.summary;
        run.warningCount = input.warningCount;
        run.completedAt = new Date();
      },
      async markRunSuperseded(input) {
        const run = repository.runs.get(input.runId);
        if (!run) throw new Error("run missing");
        run.status = "failed";
        run.summary = {
          superseded_by_executed_run_id: input.executedRunId,
          reason: "same_source_parser_already_executed",
        };
        run.completedAt = new Date();
      },
    };
    return work(transaction);
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


test("Execute verifies the complete Preview before the first canonical write", async () => {
  const repository = new FakeImportRepository();
  const previewState = new FakeStateRepository();
  const executor = new FakeExecutor(repository);
  const service = new ConversationImportService(repository, previewState, executor);
  const raw = Buffer.from(JSON.stringify([chatGptConversationFixture]), "utf8");

  const preview = await service.preview(stream(raw), "conversations.json", "user-id");
  executor.state = chatGptCurrentState();

  await assert.rejects(
    () => service.execute(
      preview.import_run_id,
      preview.preview_fingerprint,
      "user-id",
    ),
    (error: unknown) => (
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "CONVERSATION_IMPORT_PREVIEW_STALE"
    ),
  );
  assert.deepEqual(executor.applied, []);
  assert.equal(repository.runs.get(preview.import_run_id)?.status, "processing");
});

test("Execute applies a validated source once and replaying the same run is write-free", async () => {
  const repository = new FakeImportRepository();
  const executor = new FakeExecutor(repository);
  const service = new ConversationImportService(
    repository,
    new FakeStateRepository(),
    executor,
  );
  const raw = Buffer.from(JSON.stringify([chatGptConversationFixture]), "utf8");
  const preview = await service.preview(stream(raw), "conversations.json", "user-id");

  const first = await service.execute(
    preview.import_run_id,
    preview.preview_fingerprint,
    "user-id",
  );
  assert.equal(first.outcome, "executed");
  assert.deepEqual(executor.applied, ["conv-real-shape"]);
  assert.equal(repository.runs.get(preview.import_run_id)?.status, "executed");

  const replay = await service.execute(
    preview.import_run_id,
    preview.preview_fingerprint,
    "user-id",
  );
  assert.equal(replay.outcome, "replayed");
  assert.deepEqual(executor.applied, ["conv-real-shape"]);
});

test("Previewing an exact raw source after execution reuses the executed run", async () => {
  const repository = new FakeImportRepository();
  const executor = new FakeExecutor(repository);
  const service = new ConversationImportService(
    repository,
    new FakeStateRepository(),
    executor,
  );
  const raw = Buffer.from(JSON.stringify([chatGptConversationFixture]), "utf8");
  const firstPreview = await service.preview(stream(raw), "first.json", "user-id");
  await service.execute(
    firstPreview.import_run_id,
    firstPreview.preview_fingerprint,
    "user-id",
  );
  const runsBefore = repository.runCounter;

  const secondPreview = await service.preview(stream(raw), "second.json", "user-id");
  assert.equal(secondPreview.already_executed, true);
  assert.equal(secondPreview.import_run_id, firstPreview.import_run_id);
  assert.equal(repository.runCounter, runsBefore);
});


test("preserved-source re-preview creates a distinct explicit reapply run", async () => {
  const repository = new FakeImportRepository();
  const executor = new FakeExecutor(repository);
  const service = new ConversationImportService(
    repository,
    new FakeStateRepository(),
    executor,
  );
  const raw = Buffer.from(JSON.stringify([chatGptConversationFixture]), "utf8");
  const standard = await service.preview(stream(raw), "conversations.json", "user-id");
  await service.execute(
    standard.import_run_id,
    standard.preview_fingerprint,
    "user-id",
  );
  const standardRun = repository.runs.get(standard.import_run_id);
  assert.equal(standardRun?.executionKey, "standard");

  const reapply = await service.previewStoredSource(standard.source_id, "user-id");
  const reapplyRun = repository.runs.get(reapply.import_run_id);

  assert.notEqual(reapply.import_run_id, standard.import_run_id);
  assert.equal(reapply.source_id, standard.source_id);
  assert.equal(reapply.preview_fingerprint, standard.preview_fingerprint);
  assert.equal(reapply.already_executed, false);
  assert.match(reapplyRun?.executionKey ?? "", /^reapply:[0-9a-f-]{36}$/u);
  assert.equal(reapplyRun?.status, "processing");
});

test("explicit preserved-source reapply can execute after an identical standard run and then replays write-free", async () => {
  const repository = new FakeImportRepository();
  const executor = new FakeExecutor(repository);
  const service = new ConversationImportService(
    repository,
    new FakeStateRepository(),
    executor,
  );
  const raw = Buffer.from(JSON.stringify([chatGptConversationFixture]), "utf8");
  const standard = await service.preview(stream(raw), "conversations.json", "user-id");
  await service.execute(
    standard.import_run_id,
    standard.preview_fingerprint,
    "user-id",
  );
  const writesAfterStandard = executor.applied.length;

  const reapply = await service.previewStoredSource(standard.source_id, "user-id");
  const first = await service.execute(
    reapply.import_run_id,
    reapply.preview_fingerprint,
    "user-id",
  );

  assert.equal(first.outcome, "executed");
  assert.ok(executor.applied.length > writesAfterStandard);
  assert.equal(repository.runs.get(reapply.import_run_id)?.status, "executed");

  const writesAfterReapply = executor.applied.length;
  const replay = await service.execute(
    reapply.import_run_id,
    reapply.preview_fingerprint,
    "user-id",
  );
  assert.equal(replay.outcome, "replayed");
  assert.equal(executor.applied.length, writesAfterReapply);
});

test("Conversation-level exclusions skip canonical planning and survive in Preview metadata", async () => {
  const repository = new FakeImportRepository();
  repository.exclusions = [{
    provider: "chatgpt",
    scope: "conversation",
    sourceConversationId: "conv-real-shape",
    sourceNodeId: null,
  }];
  const service = new ConversationImportService(repository, new FakeStateRepository());
  const raw = Buffer.from(JSON.stringify([chatGptConversationFixture]), "utf8");

  const preview = await service.preview(stream(raw), "conversations.json", "user-id");

  assert.equal(preview.summary.conversations.create, 0);
  assert.equal(preview.summary.messages.create, 0);
  assert.equal(preview.exclusions.conversations, 1);
  assert.ok(preview.exclusions.messages > 0);
});

test("branch exclusions remove the source subtree from Preview and Execute planning", async () => {
  const repository = new FakeImportRepository();
  repository.exclusions = [{
    provider: "chatgpt",
    scope: "branch",
    sourceConversationId: "conv-real-shape",
    sourceNodeId: "assistant-alt",
  }];
  const executor = new FakeExecutor(repository);
  const service = new ConversationImportService(
    repository,
    new FakeStateRepository(),
    executor,
  );
  const raw = Buffer.from(JSON.stringify([chatGptConversationFixture]), "utf8");

  const preview = await service.preview(stream(raw), "conversations.json", "user-id");
  const fullCount = ChatGPTExportParser
    .normalizeConversation(chatGptConversationFixture)
    .conversation.messages.length;
  assert.equal(preview.exclusions.branch_roots, 1);
  assert.ok(preview.exclusions.messages >= 2);
  assert.equal(
    preview.summary.messages.create,
    fullCount - preview.exclusions.messages,
  );

  const executed = await service.execute(
    preview.import_run_id,
    preview.preview_fingerprint,
    "user-id",
  );
  assert.equal(executed.outcome, "executed");
  assert.equal(executed.exclusions.branch_roots, 1);
  assert.deepEqual(executor.applied, ["conv-real-shape"]);
});

test("changing exclusion rules after Preview makes Execute stale before canonical writes", async () => {
  const repository = new FakeImportRepository();
  const executor = new FakeExecutor(repository);
  const service = new ConversationImportService(
    repository,
    new FakeStateRepository(),
    executor,
  );
  const raw = Buffer.from(JSON.stringify([chatGptConversationFixture]), "utf8");
  const preview = await service.preview(stream(raw), "conversations.json", "user-id");

  repository.exclusions = [{
    provider: "chatgpt",
    scope: "branch",
    sourceConversationId: "conv-real-shape",
    sourceNodeId: "assistant-alt",
  }];

  await assert.rejects(
    () => service.execute(
      preview.import_run_id,
      preview.preview_fingerprint,
      "user-id",
    ),
    (error: unknown) => (
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "CONVERSATION_IMPORT_PREVIEW_STALE"
    ),
  );
  assert.deepEqual(executor.applied, []);
});


test("multi-file Preview accumulates disjoint sources and deduplicates exact raw sources", async () => {
  const repository = new FakeImportRepository();
  const service = new ConversationImportService(repository, new FakeStateRepository());

  const firstRaw = Buffer.from(JSON.stringify([claudeConversationFixture]), "utf8");
  const secondFixture = JSON.parse(JSON.stringify(claudeConversationFixture));
  secondFixture.uuid = "claude-conversation-second";
  secondFixture.name = "Claude fixture second";
  const secondRaw = Buffer.from(JSON.stringify([secondFixture]), "utf8");

  const first = await service.preview(stream(firstRaw), "conversations-000.json", "user-id");
  const second = await service.preview(stream(secondRaw), "conversations-001.json", "user-id");
  const duplicate = await service.preview(stream(firstRaw), "conversations-000-copy.json", "user-id");

  const batch = await service.previewBatch(
    [first.import_run_id, second.import_run_id, duplicate.import_run_id],
    "user-id",
  );

  assert.deepEqual(batch.files, {
    total: 3,
    unique: 2,
    duplicate: 1,
    already_executed: 0,
    pending: 2,
  });
  assert.equal(batch.summary.conversations.create, 2);
  assert.equal(batch.items[0]?.status, "pending");
  assert.equal(batch.items[1]?.status, "pending");
  assert.equal(batch.items[2]?.status, "duplicate_in_batch");
  assert.equal(batch.items[2]?.duplicate_of_import_run_id, first.import_run_id);
  assert.equal(batch.items[2]?.source_id, first.source_id);
});

test("multi-file Preview plans a later export against earlier files in the same batch", async () => {
  const repository = new FakeImportRepository();
  const service = new ConversationImportService(repository, new FakeStateRepository());

  const firstRaw = Buffer.from(JSON.stringify([claudeConversationFixture]), "utf8");
  const updated = JSON.parse(JSON.stringify(claudeConversationFixture));
  updated.updated_at = "2026-09-16T00:05:00.000000Z";
  const assistant = updated.chat_messages.find(
    (message: { uuid?: string }) => message.uuid === "assistant-main",
  );
  assert.ok(assistant);
  assistant.text = "answer updated in later export";
  assistant.updated_at = "2026-09-16T00:03:00.000000Z";
  const visibleText = assistant.content.find(
    (block: { type?: string }) => block.type === "text",
  );
  assert.ok(visibleText);
  visibleText.text = "answer updated in later export";
  const secondRaw = Buffer.from(JSON.stringify([updated]), "utf8");

  const first = await service.preview(stream(firstRaw), "conversations-000.json", "user-id");
  const second = await service.preview(stream(secondRaw), "conversations-001.json", "user-id");
  const batch = await service.previewBatch(
    [first.import_run_id, second.import_run_id],
    "user-id",
  );

  assert.equal(batch.items[0]?.summary.conversations.create, 1);
  assert.equal(batch.items[1]?.summary.conversations.create, 0);
  assert.equal(batch.items[1]?.summary.conversations.update, 1);
  assert.ok((batch.items[1]?.summary.messages.update ?? 0) >= 1);
});

test("multi-file Execute validates the whole batch before writes and replays idempotently", async () => {
  const repository = new FakeImportRepository();
  const executor = new FakeExecutor(repository);
  const service = new ConversationImportService(
    repository,
    new FakeStateRepository(),
    executor,
  );

  const firstRaw = Buffer.from(JSON.stringify([claudeConversationFixture]), "utf8");
  const secondFixture = JSON.parse(JSON.stringify(claudeConversationFixture));
  secondFixture.uuid = "claude-conversation-execute-second";
  secondFixture.name = "Claude execute second";
  const secondRaw = Buffer.from(JSON.stringify([secondFixture]), "utf8");

  const first = await service.preview(stream(firstRaw), "conversations-000.json", "user-id");
  const second = await service.preview(stream(secondRaw), "conversations-001.json", "user-id");
  const runIds = [first.import_run_id, second.import_run_id];
  const batch = await service.previewBatch(runIds, "user-id");

  await assert.rejects(
    () => service.executeBatch(runIds, "0".repeat(64), "user-id"),
    (error: unknown) => (
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "CONVERSATION_IMPORT_BATCH_PREVIEW_STALE"
    ),
  );
  assert.deepEqual(executor.applied, []);

  const executed = await service.executeBatch(
    runIds,
    batch.batch_fingerprint,
    "user-id",
  );
  assert.equal(executed.outcome, "executed");
  assert.deepEqual(executor.applied, [
    "claude-conversation-fixture",
    "claude-conversation-execute-second",
  ]);
  assert.equal(repository.runs.get(first.import_run_id)?.status, "executed");
  assert.equal(repository.runs.get(second.import_run_id)?.status, "executed");

  const writesAfterFirstExecute = executor.applied.length;
  const replay = await service.executeBatch(
    runIds,
    batch.batch_fingerprint,
    "user-id",
  );
  assert.equal(replay.outcome, "already_executed");
  assert.equal(executor.applied.length, writesAfterFirstExecute);
  assert.ok(replay.items.every((item) => item.outcome === "already_executed"));
});
