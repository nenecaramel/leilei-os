import assert from "node:assert/strict";
import test from "node:test";

test("attachment bucket migration API exists before production cutover", async () => {
  const migrationModule = await import(
    "../src/domains/bridge/native-live-attachment-migration.js"
  ).catch(() => ({}));

  assert.equal(
    typeof (migrationModule as Record<string, unknown>)
      .migrateNativeLiveAttachmentInlineContentBatch,
    "function",
  );
});
