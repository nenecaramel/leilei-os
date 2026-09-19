import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const favorites = readFileSync(
  new URL("../web/src/pages/ConversationFavoritesPanel.tsx", import.meta.url),
  "utf8",
);
const search = readFileSync(
  new URL("../web/src/pages/ConversationSearchPanel.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../web/src/pages/conversations.css", import.meta.url),
  "utf8",
);
const archive = readFileSync(
  new URL("../web/src/pages/ConversationArchivePage.tsx", import.meta.url),
  "utf8",
);
const importHistory = readFileSync(
  new URL("../web/src/pages/ConversationImportHistoryPanel.tsx", import.meta.url),
  "utf8",
);

test("Favorites shows compact MM/DD HH:mm timestamps", () => {
  assert.match(favorites, /pad2\(date\.getMonth\(\) \+ 1\)/);
  assert.match(favorites, /pad2\(date\.getDate\(\)\)/);
  assert.match(favorites, /pad2\(date\.getHours\(\)\)/);
  assert.match(favorites, /pad2\(date\.getMinutes\(\)\)/);
  assert.match(favorites, /\$\{month\}\/\$\{day\} \$\{hour\}:\$\{minute\}/);
});

test("Conversation search never shows a standalone 筛选 label below the search field", () => {
  assert.doesNotMatch(search, /\`筛选/);
  assert.match(search, /共 \$\{state\.total\.toLocaleString\(\)\} 条命中/);
});

test("Sources uses the same month wrapper, heading rhythm, and card shell as the sibling surfaces", () => {
  assert.match(importHistory, /<section className="memory-months" aria-label="Sources 列表">/);
  assert.match(importHistory, /<section className="memory-month-section">/);
  assert.match(importHistory, /<h2 className="memory-month-label">原始导入记录<\/h2>/);
  assert.match(importHistory, /className="memory-month-card conversation-import-history-list"/);
  assert.doesNotMatch(importHistory, /className="conversation-section-heading"/);
  assert.doesNotMatch(css, /conversation-import-history \.conversation-section-heading/);
});

test("Conversation list groups and displays by the source conversation creation time", () => {
  assert.match(
    archive,
    /groupConversationsByMonth\(list\.items, \(item\) => item\.sourceCreatedAt \?\? item\.sourceUpdatedAt\)/,
  );
  assert.match(
    archive,
    /formatRowDate\(item\.sourceCreatedAt \?\? item\.sourceUpdatedAt\)/,
  );
  assert.doesNotMatch(
    archive,
    /formatRowDate\(item\.sourceUpdatedAt \?\? item\.sourceCreatedAt\)/,
  );
});
