import assert from "node:assert/strict";
import test from "node:test";
import {
  ConversationExclusionManagementError,
  ConversationExclusionManagementService,
} from "../src/domains/conversation/conversation-exclusion-management-service.js";
import type {
  ConversationExclusionListItem,
  ConversationExclusionManagementRepository,
} from "../src/domains/conversation/conversation-exclusion-management-repository.js";
import type { ConversationImportService } from "../src/domains/conversation/conversation-import-service.js";

const EXCLUSION_ID = "11111111-1111-4111-8111-111111111111";

function item(): ConversationExclusionListItem {
  return {
    id: EXCLUSION_ID,
    provider: "chatgpt",
    scope: "branch",
    sourceConversationId: "source-conversation",
    sourceNodeId: "source-node",
    canonicalConversationExists: true,
    canonicalNodeExists: false,
    title: "A conversation",
    sourceCreatedAt: "2026-09-15T00:00:00.000Z",
    rootRole: "user",
    rootSnippet: "A retained canonical anchor",
    createdAt: "2026-09-16T00:00:00.000Z",
  };
}

class FakeRepository implements ConversationExclusionManagementRepository {
  status: "active" | "disabled" | null = "active";
  value: ConversationExclusionListItem | null = item();
  listInput: Parameters<ConversationExclusionManagementRepository["listExclusions"]>[0] | null = null;

  async findUserStatus() { return this.status; }

  async listExclusions(input: Parameters<ConversationExclusionManagementRepository["listExclusions"]>[0]) {
    this.listInput = input;
    return {
      items: this.value ? [this.value] : [],
      total: this.value ? 1 : 0,
    };
  }

  async deleteExclusion() {
    return this.value;
  }

  async getExclusion() {
    return this.value;
  }
}

test("Conversation exclusion list validates filters and pagination", async () => {
  const repository = new FakeRepository();
  const service = new ConversationExclusionManagementService(repository);

  await service.list({
    userId: "user",
    provider: "claude",
    scope: "conversation",
    limit: "25",
    offset: "5",
  });

  assert.deepEqual(repository.listInput, {
    userId: "user",
    provider: "claude",
    scope: "conversation",
    limit: 25,
    offset: 5,
  });
});

test("removing an exclusion only re-enables future import and does not claim immediate restore", async () => {
  const service = new ConversationExclusionManagementService(new FakeRepository());

  const result = await service.remove({
    userId: "user",
    exclusionId: EXCLUSION_ID,
  });

  assert.equal(result.removed, true);
  assert.equal(result.canonicalRestored, false);
  assert.equal(result.eligibleOnNextImport, true);
  assert.equal(result.exclusion.id, EXCLUSION_ID);
});

test("Conversation exclusion management enforces active users and stable not-found semantics", async () => {
  const repository = new FakeRepository();
  const service = new ConversationExclusionManagementService(repository);

  repository.status = "disabled";
  await assert.rejects(
    () => service.list({ userId: "user" }),
    (error: unknown) =>
      error instanceof ConversationExclusionManagementError
      && error.code === "CONVERSATION_EXCLUSION_UNAVAILABLE",
  );

  repository.status = "active";
  repository.value = null;
  await assert.rejects(
    () => service.remove({ userId: "user", exclusionId: EXCLUSION_ID }),
    (error: unknown) =>
      error instanceof ConversationExclusionManagementError
      && error.code === "CONVERSATION_EXCLUSION_NOT_FOUND",
  );
});

test("Conversation exclusion management rejects malformed ids and filters", async () => {
  const service = new ConversationExclusionManagementService(new FakeRepository());

  await assert.rejects(
    () => service.remove({ userId: "user", exclusionId: "bad" }),
    (error: unknown) =>
      error instanceof ConversationExclusionManagementError
      && error.code === "CONVERSATION_EXCLUSION_INVALID_REQUEST",
  );

  await assert.rejects(
    () => service.list({ userId: "user", provider: "other" }),
    (error: unknown) =>
      error instanceof ConversationExclusionManagementError
      && error.code === "CONVERSATION_EXCLUSION_INVALID_REQUEST",
  );
});

test("legacy restore uses only the selected exclusion and retained source", async () => {
  const repository = new FakeRepository();
  let previewInput: unknown;
  let executeInput: unknown;
  const importService = {
    async previewStoredSource(sourceId: string, userId: string, options: unknown) {
      previewInput = { sourceId, userId, options };
      return {
        import_run_id: "22222222-2222-4222-8222-222222222222",
        preview_fingerprint: "f".repeat(64),
      };
    },
    async execute(runId: string, fingerprint: string, userId: string, options: unknown) {
      executeInput = { runId, fingerprint, userId, options };
      return {};
    },
  } as unknown as ConversationImportService;
  const service = new ConversationExclusionManagementService(repository, importService);

  const result = await service.restore({
    userId: "user",
    exclusionId: EXCLUSION_ID,
    sourceId: "33333333-3333-4333-8333-333333333333",
  });

  assert.deepEqual(result, {
    restored: true,
    sourceId: "33333333-3333-4333-8333-333333333333",
  });
  assert.deepEqual(previewInput, {
    sourceId: "33333333-3333-4333-8333-333333333333",
    userId: "user",
    options: {
      ignoreExclusion: {
        provider: "chatgpt",
        scope: "branch",
        sourceConversationId: "source-conversation",
        sourceNodeId: "source-node",
      },
      requireExclusion: {
        provider: "chatgpt",
        scope: "branch",
        sourceConversationId: "source-conversation",
        sourceNodeId: "source-node",
      },
    },
  });
  assert.deepEqual(executeInput, {
    runId: "22222222-2222-4222-8222-222222222222",
    fingerprint: "f".repeat(64),
    userId: "user",
    options: {
      ignoreExclusion: {
        provider: "chatgpt",
        scope: "branch",
        sourceConversationId: "source-conversation",
        sourceNodeId: "source-node",
      },
      requireExclusion: {
        provider: "chatgpt",
        scope: "branch",
        sourceConversationId: "source-conversation",
        sourceNodeId: "source-node",
      },
      exclusionIdToRemove: EXCLUSION_ID,
    },
  });
});
