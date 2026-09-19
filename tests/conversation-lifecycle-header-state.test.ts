import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "web/src/pages/ConversationLifecyclePage.tsx"), "utf8");

test("Conversation Archive loading and error states keep the lifecycle header visible", () => {
  assert.match(source, /const count = state\.status === "ready" \? state\.total : 0/);
  assert.match(source, /memory-page-header memory-archive-header/);
  assert.match(source, /className="memory-page-title">Archive/);
  assert.match(source, /memory-page-count/);
  assert.match(source, />\s*Return\s*<\/button>/);
  assert.match(source, /<PageState state="loading" message="Reading\.\.\." \/>/);
  assert.match(source, /message="Unable to read conversation archive\."/);
  assert.doesNotMatch(source, /useLocation|deleted \? "Deleted" : "Archive"/);
});
