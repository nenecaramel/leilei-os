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
const refinement = readFileSync(
  new URL("../web/src/pages/conversation-layout-refinement.css", import.meta.url),
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

test("Sources title and card align to the same top rhythm as Conversations and Favorites", () => {
  assert.doesNotMatch(refinement, /\.conversation-page \.conversation-import-history\s*\{[^}]*margin-top:\s*-\d+/s);
  assert.match(refinement, /\.conversation-page \.conversation-import-history \.conversation-section-heading\s*\{[^}]*min-height:\s*0[^}]*align-items:\s*baseline[^}]*margin:\s*0 0 6px/s);
});
