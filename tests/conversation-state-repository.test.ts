import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/domains/conversation/conversation-state-repository.ts", import.meta.url),
  "utf8",
);

test("Conversation Archive merge-state reads stay user-scoped and minimal", () => {
  assert.match(source, /where\(eq\(conversations\.userId, userId\)\)/);
  assert.match(source, /conversationMessages\.sourceFingerprint/);
  assert.match(source, /conversationMessages\.sourceUpdatedAt/);
  assert.match(source, /conversations\.sourceUpdatedAt/);
  assert.match(source, /conversationMessages\.isCurrentPath/);
  assert.match(source, /conversationMessages\.currentPathIndex/);
  assert.match(source, /conversationMessages\.turnIndex/);
  assert.doesNotMatch(source, /conversationContentBlocks/);
  assert.doesNotMatch(source, /conversationAttachments/);
});

test("Conversation Archive state reads can participate in serializable import execution", () => {
  assert.match(source, /isolationLevel:\s*"serializable"/);
});
