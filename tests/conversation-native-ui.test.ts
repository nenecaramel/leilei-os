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
const searchCss = readFileSync(
  new URL("../web/src/pages/conversation-search-controls.css", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../web/src/pages/conversation-native-ui.css", import.meta.url),
  "utf8",
);
const navigationCss = readFileSync(
  new URL("../web/src/layout/navigation-panel.css", import.meta.url),
  "utf8",
);

test("Conversation Archive native UI keeps one primary archive surface with Favorites and Sources tabs", () => {
  assert.match(page, /surface, setSurface/);
  assert.match(page, />Conversations</);
  assert.match(page, />Favorites</);
  assert.match(page, />Sources</);
  assert.match(page, /surface === "archive"/);
  assert.match(page, /surface === "favorites"/);
  assert.match(page, /surface === "sources"/);
});

test("Conversation native UI aligns with accepted LeileiOS white grouped-list language", () => {
  assert.match(css, /body:has\(\.conversation-page\)/);
  assert.match(css, /background:\s*#ffffff/);
  assert.match(css, /width:\s*min\(860px,/);
  assert.match(css, /border-radius:\s*14px/);
  assert.match(css, /BlinkMacSystemFont/);
  assert.match(css, /conversation-list,/);
  assert.match(css, /conversation-message-list/);
});

test("Conversation UI redesign keeps import search Favorites Sources and pruning functionality wired", () => {
  assert.match(page, /client\.previewBatch/);
  assert.match(page, /client\.executeBatch/);
  assert.match(page, /ConversationSearchPanel/);
  assert.match(page, /ConversationFavoritesPanel/);
  assert.match(page, /ConversationImportHistoryPanel/);
  assert.match(page, /deleteConversation/);
  assert.match(page, /deleteBranch/);
  assert.match(page, /createFavorite/);
});

test("Conversation detail is a continuous reading surface rather than independent cream cards", () => {
  assert.match(css, /\.conversation-message-list\s*\{/);
  assert.match(css, /\.conversation-message \{/);
  assert.match(css, /\.conversation-message \+ \.conversation-message/);
  assert.match(css, /background:\s*#fafafa/);
  assert.doesNotMatch(css, /conversation-message[^}]*Newsreader/s);
});

test("desktop navigation owns its typography so route-level fonts cannot shift the sidebar", () => {
  assert.match(navigationCss, /\.navigation-panel\s*\{[^}]*font-family:/s);
  assert.match(navigationCss, /-apple-system/);
  assert.match(navigationCss, /BlinkMacSystemFont/);
});

test("Conversation list reuses the native module header and search chrome", () => {
  assert.match(page, /className="memory-page-header conversation-page-header"/);
  assert.match(page, /className="memory-page-title">Conversations/);
  assert.match(page, /className="memory-page-count"/);
  assert.match(page, /<ModuleSearchButton/);
  assert.match(page, /<ModuleSearchField/);
  assert.match(css, /conversation-page-header \.memory-page-title/);
  assert.match(css, /font-size:\s*18px/);
  assert.match(css, /conversation-page-header \.memory-page-count/);
  assert.match(css, /font-size:\s*12px/);
  assert.match(css, /width:\s*44px/);
  assert.match(css, /min-height:\s*42px/);
});

test("Conversation rows use the approved Memory inset-card geometry", () => {
  assert.match(css, /\.conversation-card\s*\{[^}]*min-height:\s*60px/s);
  assert.match(css, /\.conversation-card\s*\{[^}]*padding:\s*11px 13px/s);
  assert.match(css, /\.conversation-card \+ \.conversation-card::before/);
  assert.match(css, /right:\s*13px/);
  assert.match(css, /left:\s*13px/);
  assert.match(css, /border-radius:\s*14px/);
});

test("Conversation advanced search filters stay secondary until requested", () => {
  assert.match(searchPanel, /className="conversation-search-toolbar"/);
  assert.match(searchPanel, /conversation-search-filter-toggle/);
  assert.match(searchPanel, /aria-expanded=\{filtersOpen\}/);
  assert.match(searchPanel, /filtersOpen \? \(/);
  assert.match(searchPanel, /className="conversation-search-filters"/);
  assert.match(searchPanel, /conversation-search-clear/);
  assert.match(searchPanel, /conversation-search-controls\.css/);

  assert.match(searchCss, /\.conversation-search-toolbar\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
  assert.match(searchCss, /\.conversation-search-filter-toggle[^\{]*\{[^}]*font-size:\s*12px;[^}]*color:\s*#8a8a8a;/s);
  assert.match(searchCss, /\.conversation-search-clear[^\{]*\{[^}]*font-size:\s*12px;/s);
  assert.match(searchCss, /\.conversation-search-filters\s*\{[^}]*margin-top:\s*10px;/s);
});
