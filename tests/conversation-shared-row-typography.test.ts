import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);
const conversationCss = readFileSync(
  new URL("../web/src/pages/conversations.css", import.meta.url),
  "utf8",
);
const archivePage = readFileSync(
  new URL("../web/src/pages/ConversationArchivePage.tsx", import.meta.url),
  "utf8",
);
const favoritesPanel = readFileSync(
  new URL("../web/src/pages/ConversationFavoritesPanel.tsx", import.meta.url),
  "utf8",
);

test("shared Memory row title and metadata typography apply at every viewport width", () => {
  const mobileMediaIndex = styles.indexOf("@media (max-width: 760px)");
  const titleIndex = styles.indexOf(".memory-row-title {");
  const metaIndex = styles.indexOf(".memory-row-meta {");

  assert.ok(titleIndex >= 0);
  assert.ok(metaIndex >= 0);
  assert.ok(mobileMediaIndex >= 0);
  assert.ok(titleIndex < mobileMediaIndex);
  assert.ok(metaIndex < mobileMediaIndex);

  assert.match(styles, /\.memory-row-title\s*\{[^}]*color:\s*#171717;[^}]*font-size:\s*14px;[^}]*font-weight:\s*500;[^}]*line-height:\s*1\.3;/s);
  assert.match(styles, /\.memory-row-meta\s*\{[^}]*color:\s*#8a8a8a;[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.3;/s);
});

test("Conversation list title, date, and right-side metadata use only the shared Memory row typography", () => {
  assert.match(archivePage, /className="memory-row-title"/);
  assert.match(archivePage, /className="memory-row-meta"/);
  assert.doesNotMatch(archivePage, /conversation-card-title/);
  assert.doesNotMatch(archivePage, /conversation-card-meta/);
  assert.doesNotMatch(conversationCss, /\.conversation-card-title\s*\{/);
  assert.doesNotMatch(conversationCss, /\.conversation-card-meta\s*\{/);
});

test("Favorites title, date, and right-side metadata stay on the shared Memory row typography", () => {
  assert.match(favoritesPanel, /className="memory-row-title"/);
  assert.match(favoritesPanel, /className="memory-row-meta"/);
  assert.match(conversationCss, /\.conversation-favorite-window a\s*\{[^}]*color:\s*inherit;/s);
});
