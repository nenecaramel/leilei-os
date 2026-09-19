import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/domains/conversation/conversation-pruning-repository.ts", import.meta.url),
  "utf8",
);
const pruneConversationSource = source.slice(source.indexOf("async pruneConversation"), source.indexOf("async pruneBranch"));
const pruneBranchSource = source.slice(source.indexOf("private async pruneBranchInTransaction"), source.indexOf("async archiveConversation"));
const permanentDeleteBranchSource = source.slice(source.indexOf("async permanentDeleteBranch"), source.indexOf("async listDeletedBranches"));
const permanentDeleteConversationSource = source.slice(source.indexOf("async permanentDeleteConversation"), source.indexOf("async restoreBranch"));

test("Conversation pruning is serializable and keeps a recoverable tombstone instead of deleting the conversation", () => {
  assert.match(source, /isolationLevel:\s*"serializable"/);
  assert.match(pruneConversationSource, /update\(conversations\)/);
  assert.match(pruneConversationSource, /deletedAt:\s*new Date\(\)/);
  assert.doesNotMatch(pruneConversationSource, /insert\(conversationExclusions\)/);
});

test("whole-window pruning does not delete immutable raw import sources or blobs", () => {
  assert.doesNotMatch(source, /delete\(conversationImportSources\)/);
  assert.doesNotMatch(source, /delete\(conversationImportBlobs\)/);
});

test("branch pruning walks source-node descendants and records a recoverable branch tombstone", () => {
  assert.match(pruneBranchSource, /children\.get\(message\.parentSourceNodeId\)/);
  assert.match(pruneBranchSource, /const queue = \[root\.sourceNodeId\]/);
  assert.match(pruneBranchSource, /excludedSourceNodes\.add\(sourceNodeId\)/);
  assert.match(pruneBranchSource, /insert\(conversationDeletedBranches\)/);
  assert.doesNotMatch(pruneBranchSource, /delete\(conversationMessages\)/);
});

test("branch pruning refuses to remove the entire window and repairs a removed current leaf", () => {
  assert.match(pruneBranchSource, /CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED/);
  assert.match(pruneBranchSource, /excludedSourceNodes\.has\(currentLeafSourceNodeId\)/);
  assert.match(pruneBranchSource, /currentPathIndex/);
});


test("permanent Conversation deletion accepts both legacy archived and recoverable-deleted rows", () => {
  assert.match(
    permanentDeleteConversationSource,
    /deletedAt\} IS NOT NULL OR \$\{conversations\.archivedAt\} IS NOT NULL/,
  );
  assert.match(permanentDeleteConversationSource, /scope: "conversation"/);
  assert.match(permanentDeleteConversationSource, /delete\(conversations\)/);
});

test("permanent branch deletion preserves the current-path pruning invariant before removing rows", () => {
  assert.match(permanentDeleteBranchSource, /currentLeafSourceNodeId: conversations\.currentLeafSourceNodeId/);
  assert.match(permanentDeleteBranchSource, /excluded\.has\(currentLeafSourceNodeId\)/);
  assert.match(permanentDeleteBranchSource, /isCurrentPath/);
  assert.match(permanentDeleteBranchSource, /currentPathIndex/);
  assert.match(permanentDeleteBranchSource, /const sourceFingerprint = hashCanonical/);
  assert.match(permanentDeleteBranchSource, /previous: conversation\.sourceFingerprint/);
  assert.match(permanentDeleteBranchSource, /scope: "branch"/);
  assert.match(permanentDeleteBranchSource, /update\(conversations\)/);
  assert.match(permanentDeleteBranchSource, /sourceFingerprint:/);
  assert.match(permanentDeleteBranchSource, /updatedAt:/);
});
