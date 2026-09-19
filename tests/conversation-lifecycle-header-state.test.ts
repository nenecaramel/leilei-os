import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "web/src/pages/ConversationLifecyclePage.tsx"), "utf8");

test("Conversation archive/deleted loading and error states keep the lifecycle header visible", () => {
  assert.match(source, /const count = state\.status === "ready" \? state\.total : 0/);
  const block = source.slice(
    source.indexOf('if (state.status === "loading" || state.status === "error")'),
    source.indexOf('const items: LifecycleItem[]'),
  );
  assert.match(block, /memory-page-header memory-archive-header/);
  assert.match(block, /deleted \? "Deleted" : "Archive"/);
  assert.match(block, /memory-page-count/);
  assert.match(block, />Return<\/button>/);
  assert.match(block, /<PageState state="loading" message="Reading\.\.\."/);
  assert.match(block, /<PageState state="error"/);
});
