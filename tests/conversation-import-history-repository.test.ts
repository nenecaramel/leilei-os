import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/domains/conversation/conversation-import-history-repository.ts", import.meta.url),
  "utf8",
);

test("Conversation import history source and run reads remain user scoped", () => {
  assert.match(source, /eq\(conversationImportSources\.userId, input\.userId\)/);
  assert.match(source, /eq\(conversationImportBlobs\.userId, input\.userId\)/);
  assert.match(source, /eq\(conversationImportRuns\.userId, userId\)/);
});

test("Conversation import history reports actual raw-source retention state", () => {
  assert.match(source, /storageKind === "postgres_bytea"/);
  assert.match(source, /blobSourceId !== null/);
  assert.match(source, /encoding: row\.encoding/);
  assert.match(source, /storedBytes: row\.storedBytes/);
});

test("Conversation import history distinguishes superseded failed runs", () => {
  assert.match(source, /superseded_by_executed_run_id/);
  assert.match(source, /row\.status === "failed" && supersededByImportRunId/);
  assert.match(
    source,
    /status:\s*row\.status === "failed" && supersededByImportRunId\s*\?\s*"superseded"\s*:\s*row\.status/,
  );
});

test("Conversation import history is read-only and preserves immutable raw sources", () => {
  assert.doesNotMatch(source, /\.delete\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.insert\(/);
});
