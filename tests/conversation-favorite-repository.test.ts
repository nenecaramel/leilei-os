import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/domains/conversation/conversation-favorite-repository.ts", import.meta.url),
  "utf8",
);

test("Conversation favorite capture is serializable and reads canonical conversation/messages before snapshot insert", () => {
  assert.match(source, /isolationLevel:\s*"serializable"/);
  const conversationRead = source.indexOf(".from(conversations)");
  const messageRead = source.indexOf(".from(conversationMessages)");
  const favoriteInsert = source.indexOf(".insert(conversationFavorites)");
  const childInsert = source.indexOf(".insert(conversationFavoriteMessages)");
  assert.ok(conversationRead >= 0);
  assert.ok(messageRead > conversationRead);
  assert.ok(favoriteInsert > messageRead);
  assert.ok(childInsert > favoriteInsert);
});

test("favorite snapshots include visible message state plus content blocks and attachments", () => {
  assert.match(source, /contentBlocks:/);
  assert.match(source, /attachments:/);
  assert.match(source, /parentSourceNodeId:/);
  assert.match(source, /currentPathIndex:/);
  assert.match(source, /turnIndex:/);
  assert.match(source, /sourceUpdatedAt:/);
});

test("favorite capture uses ChatGPT current path for default view and all ordinary messages otherwise", () => {
  assert.match(
    source,
    /provider === "chatgpt" && view === "default"[\s\S]*isCurrentPath, true/,
  );
  assert.match(source, /inArray\(conversationMessages\.role, \["user", "assistant"\]\)/);
  assert.match(source, /eq\(conversationMessages\.isPrimary, true\)/);
});

test("favorites remain readable when canonical conversations or messages are later pruned", () => {
  assert.match(source, /canonicalConversationExists:/);
  assert.match(source, /canonicalMessageExists:/);
  assert.match(source, /leftJoin\([\s\S]*conversations/);
  assert.match(source, /leftJoin\([\s\S]*conversationMessages/);
});

test("favorite list supports provider, conversation and case-insensitive tag filters", () => {
  assert.match(source, /input\.provider \? eq\(conversationFavorites\.provider/);
  assert.match(source, /input\.conversationId[\s\S]*conversationFavorites\.conversationId/);
  assert.match(source, /jsonb_array_elements_text/);
  assert.match(source, /lower\(favorite_tag\.value\) = lower/);
});
