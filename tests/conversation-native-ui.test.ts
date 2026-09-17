import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../web/src/pages/ConversationArchivePage.tsx", import.meta.url),
  "utf8",
);
const searchPanel = readFileSync(
  new URL("../web/src/pages/ConversationSearchPanel.tsx", import.meta.url),
  "utf8",
);
const favoritesPanel = readFileSync(
  new URL("../web/src/pages/ConversationFavoritesPanel.tsx", import.meta.url),
  "utf8",
);
const importHistoryPanel = readFileSync(
  new URL("../web/src/pages/ConversationImportHistoryPanel.tsx", import.meta.url),
  "utf8",
);
const batchPreview = readFileSync(
  new URL("../web/src/pages/ConversationBatchImportPreview.tsx", import.meta.url),
  "utf8",
);
const cssUrl = new URL("../web/src/pages/conversations.css", import.meta.url);
const css = existsSync(cssUrl) ? readFileSync(cssUrl, "utf8") : "";
const navigationCss = readFileSync(
  new URL("../web/src/layout/navigation-panel.css", import.meta.url),
  "utf8",
);

test("Conversation pages use one canonical stylesheet instead of layered legacy CSS", () => {
  const canonicalCss = new URL("../web/src/pages/conversations.css", import.meta.url);
  assert.equal(existsSync(canonicalCss), true);
  for (const legacyFile of [
    "conversation-archive.css",
    "conversation-native-ui.css",
    "conversation-search-controls.css",
    "conversation-ui-polish.css",
  ]) {
    assert.equal(existsSync(new URL(`../web/src/pages/${legacyFile}`, import.meta.url)), false, legacyFile);
  }
  assert.match(page, /import \"\.\/conversations\.css\"/);
  assert.doesNotMatch(page, /conversation-(archive|native-ui)\.css/);
  assert.doesNotMatch(searchPanel, /conversation-search-controls\.css/);
});

test("Conversation Archive native UI keeps one primary archive surface with Favorites and Sources tabs", () => {
  assert.match(page, /surface, setSurface/);
  assert.match(page, /Conversations/);
  assert.match(page, /Favorites/);
  assert.match(page, /Sources/);
  assert.match(page, /surface === "archive"/);
  assert.match(page, /surface === "favorites"/);
  assert.match(page, /surface === "sources"/);
});

test("Conversation archive no longer requests or renders the removed Recent 30 days stats block", () => {
  assert.doesNotMatch(page, /dailyStats|ConversationDailyStat|Recent 30 days|日统计/);
});

test("Favorite cards lead with the message and keep provider and 原消息 labels out of the card", () => {
  assert.doesNotMatch(favoritesPanel, /conversation-provider/);
  assert.doesNotMatch(favoritesPanel, />原消息</);
  assert.match(favoritesPanel, /conversation-favorite-original/);
  assert.match(favoritesPanel, /conversation-favorite-footer/);
});

test("Conversation surfaces keep shared tab, provider, destructive, and loading contracts", () => {
  assert.match(css, /\.conversation-surface-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.conversation-surface-tabs\s*\{[^}]*background:\s*transparent/s);
  assert.match(css, /\.conversation-surface-tabs button[\s\S]*?border-radius:\s*0/);
  assert.match(css, /\.conversation-provider--chatgpt,[\s\S]*?\.conversation-provider--claude\s*\{[^}]*color:\s*#666/);
  assert.doesNotMatch(css, /\.conversation-danger-button[^}]*color:\s*#(?:a14d46|974a44)/);
  assert.match(css, /\.conversation-import-run\s*\{[^}]*min-height:\s*42px[^}]*align-items:\s*center/s);
  assert.match(css, /\.conversation-import-run > (?:strong|span|small|time|\.conversation-history-inline-action)/);
  assert.match(page, /className="system-state-copy"/);
  assert.match(favoritesPanel, /className="conversation-message-favorite active"/);
  assert.match(importHistoryPanel, /className="secondary-button"/);
  assert.match(batchPreview, /className="secondary-button"/);
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
  assert.doesNotMatch(searchPanel, /conversation-search-controls\.css/);

  assert.match(css, /\.conversation-search-toolbar\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
  assert.match(css, /\.conversation-search-filter-toggle[^\{]*\{[^}]*font-size:\s*12px;[^}]*color:\s*#8a8a8a;/s);
  assert.match(css, /\.conversation-search-clear[^\{]*\{[^}]*font-size:\s*12px;/s);
  assert.match(css, /\.conversation-search-filters\s*\{[^}]*margin-top:\s*10px;/s);
});
