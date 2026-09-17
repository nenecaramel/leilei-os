import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const executorSource = readFileSync(
  new URL("../src/domains/conversation/conversation-import-executor.ts", import.meta.url),
  "utf8",
);
const serviceSource = readFileSync(
  new URL("../src/domains/conversation/conversation-import-service.ts", import.meta.url),
  "utf8",
);

test("Conversation Execute is serializable and source/run locked", () => {
  assert.match(executorSource, /isolationLevel:\s*"serializable"/);
  assert.match(executorSource, /\.for\("update"\)/);
  assert.match(executorSource, /lockSource/);
  assert.match(executorSource, /lockRun/);
});

test("Conversation Execute snapshots changed messages before replacing child records", () => {
  const snapshot = executorSource.indexOf("snapshotUpdatedMessages");
  const deleteBlocks = executorSource.indexOf(".delete(conversationContentBlocks)");
  const deleteAttachments = executorSource.indexOf(".delete(conversationAttachments)");
  assert.ok(snapshot >= 0);
  assert.ok(deleteBlocks > snapshot);
  assert.ok(deleteAttachments > snapshot);
  assert.match(executorSource, /conversationMessageVersions/);
  assert.match(executorSource, /previousFingerprint/);
});

test("Conversation Execute clears authoritative path state before assigning new path indices", () => {
  const clear = executorSource.indexOf("isCurrentPath: false");
  const assign = executorSource.indexOf('update "conversation_messages" as m');
  assert.ok(clear >= 0);
  assert.ok(assign > clear);
});

test("Conversation Execute batches messages and child blocks instead of per-message transaction calls", () => {
  assert.match(executorSource, /const MESSAGE_BATCH = 200/);
  assert.match(executorSource, /const CHILD_BATCH = 500/);
  assert.match(executorSource, /onConflictDoUpdate/);
  assert.match(executorSource, /sql\.join\(rows/);
});

test("Conversation Execute strips PostgreSQL-incompatible NUL only at text persistence", async () => {
  const executorModule = await import("../src/domains/conversation/conversation-import-executor.js");
  const sanitizer = (executorModule as unknown as Record<string, unknown>).sanitizePostgresText;
  assert.equal(typeof sanitizer, "function");
  if (typeof sanitizer !== "function") return;
  const sanitizePostgresText = sanitizer as (value: string) => string;

  assert.equal(
    sanitizePostgresText("before\u0000middle\u0000after"),
    "beforemiddleafter",
  );
  assert.equal(sanitizePostgresText("保留\nemoji🙂"), "保留\nemoji🙂");
  assert.match(
    executorSource,
    /displayText:\s*sanitizePostgresText\(message\.displayText\)/u,
  );
  assert.match(
    executorSource,
    /text:\s*block\.text === null\s*\?\s*null\s*:\s*sanitizePostgresText\(block\.text\)/u,
  );
});

test("full preview fingerprint validation precedes the first canonical apply pass", () => {
  const fingerprintCheck = serviceSource.indexOf(
    "recomputedFingerprint !== expectedPreviewFingerprint",
  );
  const applyComment = serviceSource.indexOf(
    "The complete preview fingerprint is verified before the first canonical",
  );
  const firstApply = serviceSource.indexOf(
    "await transaction.applyConversation",
    applyComment,
  );
  assert.ok(fingerprintCheck >= 0);
  assert.ok(applyComment > fingerprintCheck);
  assert.ok(firstApply > applyComment);
  assert.equal(
    serviceSource.indexOf("await transaction.applyConversation", 0),
    firstApply,
  );
});
