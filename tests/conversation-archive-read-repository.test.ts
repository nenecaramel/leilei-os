import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repositorySource = readFileSync(
  new URL("../src/domains/conversation/conversation-archive-read-repository.ts", import.meta.url),
  "utf8",
);

test("ordinary Conversation counts use ChatGPT current path but Claude branch-inclusive primary messages", () => {
  assert.match(
    repositorySource,
    /conversations\.provider[^\n]*'chatgpt'[\s\S]*conversationMessages\.isCurrentPath[^\n]*true/,
  );
  assert.match(
    repositorySource,
    /or\([\s\S]*provider, "chatgpt"[\s\S]*isCurrentPath, true[\s\S]*provider, "claude"/,
  );
  assert.match(repositorySource, /eq\(conversationMessages\.isPrimary, true\)/);
  assert.match(repositorySource, /inArray\(conversationMessages\.role, \["user", "assistant"\]\)/);
});

test("Conversation day boundaries are computed in an explicit caller timezone", () => {
  assert.match(
    repositorySource,
    /timezone\(\$\{input\.timeZone\}, \$\{conversationMessages\.sourceCreatedAt\}\)::date/,
  );
  assert.doesNotMatch(repositorySource, /Asia\/Shanghai|America\/|UTC'::/);
});

test("Conversation read queries remain user scoped", () => {
  assert.match(repositorySource, /eq\(conversations\.userId, input\.userId\)/);
  assert.match(repositorySource, /eq\(conversationMessages\.userId, input\.userId\)/);
});


test("Conversation dedicated search scans canonical primary user/assistant text across saved branches", () => {
  assert.match(
    repositorySource,
    /strpos\(lower\(\$\{conversationMessages\.displayText\}\), lower\(\$\{input\.query\}\)\) > 0/,
  );
  assert.match(repositorySource, /eq\(conversationMessages\.isPrimary, true\)/);
  assert.match(repositorySource, /inArray\(conversationMessages\.role, \["user", "assistant"\]\)/);
  const searchStart = repositorySource.indexOf("async searchMessages");
  const searchEnd = repositorySource.indexOf("async findMessageOrdinal", searchStart);
  const searchSource = repositorySource.slice(searchStart, searchEnd);
  assert.doesNotMatch(searchSource, /isCurrentPath.*true/);
});

test("exact-message context uses the same provider/view visibility and stable ordering as ordinary reads", () => {
  assert.match(repositorySource, /async findMessageOrdinal/);
  assert.match(repositorySource, /messageVisibility\(input\.provider, input\.view\)/);
  assert.match(repositorySource, /orderBy\(\.\.\.messageOrder\(input\.provider, input\.view\)\)/);
});


test("Favorites-only Conversation search uses an existence filter without multiplying search rows", () => {
  const searchStart = repositorySource.indexOf("async searchMessages");
  const searchEnd = repositorySource.indexOf("async findMessageOrdinal", searchStart);
  const searchSource = repositorySource.slice(searchStart, searchEnd);
  assert.match(searchSource, /conversationFavoriteMessages/);
  assert.match(searchSource, /exists \(/);
  assert.match(searchSource, /messageId/);
  assert.doesNotMatch(searchSource, /innerJoin\(\s*conversationFavoriteMessages/);
});


test("canonical model payload hydration reads blocks and attachments only from current canonical message ids", () => {
  const start = repositorySource.indexOf("async readMessagePayloads");
  const end = repositorySource.indexOf("async searchMessages", start);
  const source = repositorySource.slice(start, end);
  assert.ok(start >= 0);
  assert.match(source, /conversationContentBlocks/);
  assert.match(source, /conversationAttachments/);
  assert.match(source, /eq\(conversationContentBlocks\.userId, input\.userId\)/);
  assert.match(source, /eq\(conversationAttachments\.userId, input\.userId\)/);
  assert.match(source, /inArray\(conversationContentBlocks\.messageId, input\.messageIds\)/);
  assert.match(source, /inArray\(conversationAttachments\.messageId, input\.messageIds\)/);
  assert.doesNotMatch(source, /conversationImportSources|rawBlob|rawBytes/);
});
