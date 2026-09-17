import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(
  new URL("../web/src/pages/ConversationFavoritesPanel.tsx", import.meta.url),
  "utf8",
);

test("Favorites is only a Memory-style month list with no extra count row", () => {
  assert.doesNotMatch(panel, /conversation-section-heading conversation-list-heading/);
  assert.match(panel, /className="memory-months"/);
  assert.match(panel, /className="memory-month-section"/);
  assert.match(panel, /className="memory-month-label"/);
  assert.match(panel, /className="memory-month-card conversation-favorite-list"/);
});

test("Favorite rows use the same title/meta hierarchy as Memory", () => {
  assert.match(panel, /<article className="memory-row"/);
  assert.match(panel, /className="memory-row-title"/);
  assert.match(panel, /className="memory-row-meta"/);
  assert.doesNotMatch(panel, /conversation-favorite-card/);
  assert.doesNotMatch(panel, /conversation-favorite-main/);
  assert.doesNotMatch(panel, /conversation-favorite-footer/);
});

test("Favorite rows keep the current content and actions", () => {
  assert.match(panel, /favoriteExcerpt\(detail\)/);
  assert.match(panel, /formatDateTime\(firstMessage\?\.sourceCreatedAt \?\? null\)/);
  assert.match(panel, /窗口：/);
  assert.match(panel, /定位原文/);
  assert.match(panel, /取消收藏/);
  assert.doesNotMatch(panel, /conversation-provider/);
  assert.doesNotMatch(panel, />原消息</);
});
