import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/domains/conversation/conversation-pruning-repository.ts", import.meta.url),
  "utf8",
);

test("Conversation pruning is serializable and records exclusions before canonical deletion", () => {
  assert.match(source, /isolationLevel:\s*"serializable"/);
  const insert = source.indexOf(".insert(conversationExclusions)");
  const deleteConversation = source.indexOf(".delete(conversations)");
  assert.ok(insert >= 0);
  assert.ok(deleteConversation > insert);
});

test("whole-window pruning does not delete immutable raw import sources or blobs", () => {
  assert.doesNotMatch(source, /delete\(conversationImportSources\)/);
  assert.doesNotMatch(source, /delete\(conversationImportBlobs\)/);
});

test("branch pruning walks source-node descendants and physically deletes only canonical message rows", () => {
  assert.match(source, /children\.get\(message\.parentSourceNodeId\)/);
  assert.match(source, /const queue = \[root\.sourceNodeId\]/);
  assert.match(source, /excludedSourceNodes\.add\(sourceNodeId\)/);
  assert.match(source, /delete\(conversationMessages\)/);
  assert.match(source, /scope:\s*"branch"/);
});

test("branch pruning refuses to remove the entire window and repairs a removed current leaf", () => {
  assert.match(source, /CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED/);
  assert.match(source, /excludedSourceNodes\.has\(currentLeafSourceNodeId\)/);
  assert.match(source, /currentPathIndex/);
  assert.match(source, /sourceFingerprint:\s*hashCanonical/);
});
