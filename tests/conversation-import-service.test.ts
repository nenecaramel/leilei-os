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
  runCounter = 0;
  runs = new Map<string, ConversationStoredRun>();
  exclusions: ConversationExclusionRule[] = [];

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

  async createPreviewRun(input: {
    userId: string;
    sourceId: string;
    parserVersion: string;
    previewFingerprint: string;
    summary: Record<string, unknown>;
    warningCount: number;
  }) {
    this.runCounter += 1;
    if (!this.source) throw new Error("source missing");
    const id = `run-${this.runCounter}`;
    this.runs.set(id, {
      id,
      userId: input.userId,
      sourceId: input.sourceId,
      parserVersion: input.parserVersion,
      status: "processing",
      previewFingerprint: input.previewFingerprint,
      summary: input.summary,
      warningCount: input.warningCount,
      completedAt: null,
      source: this.source,
    });
    return { id };
  }

  async findExecutedRun(input: {
    userId: string;
    sourceId: string;
    parserVersion: string;
  }) {
    for (const run of this.runs.values()) {
      if (
        run.userId === input.userId
        && run.sourceId === input.sourceId
        && run.parserVersion === input.parserVersion
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

  async readStoredBlob() {
    return this.blob;
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
      async lockSource(_userId, sourceId) {
        return repository.source?.id === sourceId;
      },
      async lockRun(userId, runId) {
        const run = await repository.findRunById({ userId, runId });
        return run ? {
          id: run.id,
          sourceId: run.sourceId,
          parserVersion: run.parserVersion,
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
