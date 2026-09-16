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
