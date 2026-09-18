import assert from "node:assert/strict";
import test from "node:test";
import {
  ConversationPruningError,
  ConversationPruningService,
} from "../src/domains/conversation/conversation-pruning-service.js";
import type {
  ConversationPruningRepository,
  ConversationPruneBranchResult,
  ConversationPruneConversationResult,
} from "../src/domains/conversation/conversation-pruning-repository.js";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";

class FakePruningRepository implements ConversationPruningRepository {
  status: "active" | "disabled" | null = "active";
  conversationResult: ConversationPruneConversationResult | null = {
    provider: "chatgpt",
    sourceConversationId: "source-conversation",
    deletedMessages: 12,
  };
  branchResult: ConversationPruneBranchResult | null = {
    provider: "chatgpt",
    sourceConversationId: "source-conversation",
    sourceNodeId: "source-node",
    deletedMessages: 4,
    remainingMessages: 8,
    currentLeafSourceNodeId: "remaining-leaf",
  };
  branchError: string | null = null;

  async findUserStatus() { return this.status; }

  async pruneConversation() {
    return this.conversationResult;
  }

  async pruneBranch() {
    if (this.branchError) {
      throw Object.assign(new Error(this.branchError), { code: this.branchError });
    }
    return this.branchResult;
  }
}

test("whole-window pruning preserves raw source by contract", async () => {
  const service = new ConversationPruningService(new FakePruningRepository());
  const result = await service.deleteConversation({
    userId: "user",
    conversationId: CONVERSATION_ID,
  });
  assert.equal(result.deletedMessages, 12);
  assert.equal(result.rawSourcePreserved, true);
});

test("branch pruning preserves raw source and returns subtree counts", async () => {
  const service = new ConversationPruningService(new FakePruningRepository());
  const result = await service.deleteBranch({
    userId: "user",
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
  });
  assert.equal(result.deletedMessages, 4);
  assert.equal(result.remainingMessages, 8);
  assert.equal(result.rawSourcePreserved, true);
});

test("branch pruning converts whole-window subtree conflicts into an explicit API-domain error", async () => {
  const repository = new FakePruningRepository();
  repository.branchError = "CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED";
  const service = new ConversationPruningService(repository);

  await assert.rejects(
    () => service.deleteBranch({
      userId: "user",
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
    }),
    (error: unknown) =>
      error instanceof ConversationPruningError
      && error.code === "CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED",
  );
});

test("Conversation pruning validates ids, active user status, and not-found results", async () => {
  const repository = new FakePruningRepository();
  const service = new ConversationPruningService(repository);

  await assert.rejects(
    () => service.deleteConversation({
      userId: "user",
      conversationId: "bad",
    }),
    (error: unknown) =>
      error instanceof ConversationPruningError
      && error.code === "CONVERSATION_PRUNE_INVALID_REQUEST",
  );

  repository.status = "disabled";
  await assert.rejects(
    () => service.deleteConversation({
      userId: "user",
      conversationId: CONVERSATION_ID,
    }),
    (error: unknown) =>
      error instanceof ConversationPruningError
      && error.code === "CONVERSATION_PRUNE_UNAVAILABLE",
  );

  repository.status = "active";
  repository.conversationResult = null;
  await assert.rejects(
    () => service.deleteConversation({
      userId: "user",
      conversationId: CONVERSATION_ID,
    }),
    (error: unknown) =>
      error instanceof ConversationPruningError
      && error.code === "CONVERSATION_PRUNE_NOT_FOUND",
  );
});

test("Conversation lifecycle actions keep archive, recoverable delete, and permanent delete explicit", async () => {
  const repository = new FakePruningRepository();
  let archived = false;
  let restored = false;
  let deletedRestored = false;
  let permanentlyDeleted = false;
  repository.archiveConversation = async () => (archived = true);
  repository.restoreConversation = async () => (restored = true);
  repository.restoreDeletedConversation = async () => (deletedRestored = true);
  repository.permanentDeleteConversation = async () => {
    permanentlyDeleted = true;
    return repository.conversationResult;
  };
  const service = new ConversationPruningService(repository);

  assert.deepEqual(await service.archiveConversation({ userId: "user", conversationId: CONVERSATION_ID }), { archived: true });
  assert.deepEqual(await service.restoreConversation({ userId: "user", conversationId: CONVERSATION_ID }), { restored: true });
  assert.deepEqual(await service.restoreDeletedConversation({ userId: "user", conversationId: CONVERSATION_ID }), { restored: true });
  assert.deepEqual(await service.permanentlyDeleteConversation({ userId: "user", conversationId: CONVERSATION_ID }), { deleted: true, rawSourcePreserved: true });
  assert.equal(archived, true);
  assert.equal(restored, true);
  assert.equal(deletedRestored, true);
  assert.equal(permanentlyDeleted, true);
});
