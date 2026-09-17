import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(
  new URL("../web/src/pages/ConversationFavoritesPanel.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../web/src/pages/conversations.css", import.meta.url),
  "utf8",
);

test("Favorites aligns the total count with the first month label", () => {
  assert.doesNotMatch(panel, /conversation-section-heading conversation-list-heading/);
  assert.match(panel, /className="conversation-favorites-month-heading"/);
  assert.match(panel, /className="memory-month-label">\{group\.label\}<\/h2>/);
  assert.match(panel, /index === 0 \? \(/);
  assert.match(panel, /className="memory-month-label conversation-favorites-total"/);
  assert.match(panel, /共 \{state\.total\.toLocaleString\(\)\} 条/);
  assert.match(panel, /className="memory-month-card conversation-favorite-list"/);
  assert.match(css, /\.conversation-favorites-month-heading\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/s);
  assert.match(css, /\.conversation-favorites-total\s*\{[^}]*text-align:\s*right/s);
});

test("Favorite rows use the same title/meta hierarchy as Memory", () => {
  assert.match(panel, /<article className="memory-row conversation-favorite-row"/);
  assert.match(panel, /className="memory-row-title"/);
  assert.match(panel, /className="memory-row-meta"/);
  assert.doesNotMatch(panel, /conversation-favorite-card/);
  assert.doesNotMatch(panel, /conversation-favorite-main/);
  assert.doesNotMatch(panel, /conversation-favorite-footer/);
});

test("Favorite rows keep current content and pin cancel action to the top right", () => {
  assert.match(panel, /favoriteExcerpt\(detail\)/);
  assert.match(panel, /formatDateTime\(firstMessage\?\.sourceCreatedAt \?\? null\)/);
  assert.match(panel, /窗口：/);
  assert.match(panel, /定位原文/);
  assert.match(panel, /className="conversation-message-favorite active conversation-favorite-remove"/);
  assert.match(panel, /取消收藏/);
  assert.doesNotMatch(panel, /\{\" · \"\}[\s\S]*取消收藏/);
  assert.match(css, /\.conversation-favorite-row\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.conversation-favorite-row > \.memory-row-title\s*\{[^}]*padding-right:/s);
  assert.match(css, /\.conversation-favorite-remove\s*\{[^}]*position:\s*absolute[^}]*top:\s*11px[^}]*right:\s*13px/s);
  assert.doesNotMatch(panel, /conversation-provider/);
  assert.doesNotMatch(panel, />原消息</);
});
