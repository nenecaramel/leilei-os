import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/domains/conversation/conversation-exclusion-management-repository.ts", import.meta.url),
  "utf8",
);

test("Conversation exclusion management remains user scoped", () => {
  assert.match(source, /eq\(conversationExclusions\.userId, input\.userId\)/);
  assert.match(source, /eq\(conversations\.userId, input\.userId\)/);
  assert.match(source, /eq\(conversationMessages\.userId, input\.userId\)/);
});

test("exclusion listing reports whether canonical conversation/node currently exists", () => {
  assert.match(source, /canonicalConversationExists/);
  assert.match(source, /canonicalNodeExists/);
  assert.match(source, /leftJoin\([\s\S]*conversations/);
  assert.match(source, /leftJoin\([\s\S]*conversationMessages/);
  assert.match(source, /title: conversations\.title/);
  assert.match(source, /rootRole: conversationMessages\.role/);
  assert.match(source, /rootSnippet: conversationMessages\.displayText/);
});

test("exclusion removal locks and deletes only the selected rule in a serializable transaction", () => {
  assert.match(source, /isolationLevel:\s*"serializable"/);
  assert.match(source, /\.for\("update"\)/);
  assert.match(source, /\.delete\(conversationExclusions\)/);
  assert.doesNotMatch(source, /\.insert\(conversations\)|\.insert\(conversationMessages\)/);
});

test("exclusion removal never touches immutable raw import source storage", () => {
  assert.doesNotMatch(source, /conversationImportSources|conversationImportBlobs/);
});
