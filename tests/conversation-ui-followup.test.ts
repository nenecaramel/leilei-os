import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../web/src/pages/ConversationArchivePage.tsx", import.meta.url),
  "utf8",
);
const searchPanel = readFileSync(
  new URL("../web/src/pages/ConversationSearchPanel.tsx", import.meta.url),
  "utf8",
);
const importHistory = readFileSync(
  new URL("../web/src/pages/ConversationImportHistoryPanel.tsx", import.meta.url),
  "utf8",
);
const refinementCss = readFileSync(
  new URL("../web/src/pages/conversation-layout-refinement.css", import.meta.url),
  "utf8",
);

test("Conversation provider filter is vertically compact and clear of the first card", () => {
  assert.match(page, /conversation-provider-filter/);
  assert.match(refinementCss, /\.conversation-page \.conversation-list-heading\s*\{[^}]*top:\s*-8px/s);
  assert.match(refinementCss, /\.conversation-page \.conversation-provider-filter button\s*\{[^}]*min-height:\s*24px[^}]*padding:\s*2px 9px/s);
});

test("Located Conversation message keeps only a neutral left marker", () => {
  assert.match(refinementCss, /\.conversation-detail-page \.conversation-message--anchor\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*inset 3px 0 0 #bdbdbd/s);
  assert.doesNotMatch(refinementCss, /#fff9df|#e0ca71|background:\s*#f5f5f5/);
});

test("Source summary hides low-value raw hash and storage diagnostics", () => {
  assert.doesNotMatch(importHistory, /SHA-256/);
  assert.doesNotMatch(importHistory, /source\.rawSha256/);
  assert.match(importHistory, /最近：\{statusLabel\(latest\.status\)\}/);
});

test("Import run rows are fixed-height and vertically centered inside the expanded area", () => {
  assert.match(refinementCss, /\.conversation-page \.conversation-import-run-list\s*\{[^}]*padding-top:\s*0[^}]*padding-bottom:\s*0/s);
  assert.match(refinementCss, /\.conversation-page \.conversation-import-run\s*\{[^}]*height:\s*42px[^}]*min-height:\s*42px[^}]*align-items:\s*center[^}]*padding:\s*0/s);
  assert.match(refinementCss, /\.conversation-page \.conversation-import-run > strong,[\s\S]*line-height:\s*1\.2/s);
});

test("Import run action stays immediately left of the far-right date", () => {
  assert.match(refinementCss, /\.conversation-page \.conversation-import-run > \.conversation-history-inline-action\s*\{[^}]*grid-column:\s*4/s);
  assert.match(refinementCss, /\.conversation-page \.conversation-import-run > time\s*\{[^}]*grid-column:\s*5[^}]*justify-self:\s*end/s);
  assert.match(importHistory, /canConfirmImport\(run\)[\s\S]*conversation-history-inline-action[\s\S]*<time>/);
});

test("Search toolbar shows hit count and removes the duplicate footer count", () => {
  assert.match(searchPanel, /state\.status === "ready"\s*\? `共 \$\{state\.total\.toLocaleString\(\)\} 条命中`/);
  assert.doesNotMatch(searchPanel, /<p className="conversation-list-total">[\s\S]*条命中/);
});
