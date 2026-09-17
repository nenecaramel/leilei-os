import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../web/src/pages/ConversationArchivePage.tsx", import.meta.url),
  "utf8",
);
const importHistory = readFileSync(
  new URL("../web/src/pages/ConversationImportHistoryPanel.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../web/src/pages/conversations.css", import.meta.url),
  "utf8",
);

test("Conversation provider filter sits above the first card without overlapping it", () => {
  assert.match(page, /conversation-provider-filter/);
  assert.match(css, /\.conversation-list-heading\s*\{[^}]*top:\s*-8px/s);
});

test("Sources starts on the same vertical rhythm as the other Conversation surfaces", () => {
  assert.match(css, /\.conversation-import-history\s*\{[^}]*margin-top:\s*0/s);
});

test("Located Conversation message uses neutral gray instead of yellow", () => {
  assert.match(css, /\.conversation-message--anchor\s*\{[^}]*background:\s*#f5f5f5[^}]*#bdbdbd/s);
  assert.doesNotMatch(css, /#fff9df|#e0ca71/);
});

test("Source summary hides low-value raw hash and storage diagnostics", () => {
  assert.doesNotMatch(importHistory, /SHA-256/);
  assert.doesNotMatch(importHistory, /source\.rawSha256/);
  assert.match(importHistory, /最近：\{statusLabel\(latest\.status\)\}/);
});

test("Import run rows are fixed-height and keep action immediately left of the right-aligned date", () => {
  assert.match(css, /\.conversation-import-run\s*\{[^}]*height:\s*42px[^}]*min-height:\s*42px[^}]*padding:\s*0/s);
  assert.match(css, /\.conversation-import-run > \.conversation-history-inline-action\s*\{[^}]*grid-column:\s*4/s);
  assert.match(css, /\.conversation-import-run > time\s*\{[^}]*grid-column:\s*5[^}]*justify-self:\s*end/s);
  assert.match(importHistory, /canConfirmImport\(run\)[\s\S]*conversation-history-inline-action[\s\S]*<time>/);
});
