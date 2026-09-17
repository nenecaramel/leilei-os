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

test("Favorites uses the Memory row hierarchy without a separate count row", () => {
  assert.doesNotMatch(panel, /conversation-section-heading conversation-list-heading/);
  assert.match(panel, /className="memory-row conversation-favorite-card conversation-favorite-card--quote"/);
  assert.match(panel, /className="memory-row-title conversation-favorite-original"/);
  assert.match(panel, /className="memory-row-meta conversation-favorite-footer"/);
});

test("Favorites keeps current content while matching Memory row geometry", () => {
  assert.match(panel, /窗口：/);
  assert.match(panel, /定位原文/);
  assert.match(panel, /取消收藏/);
  assert.doesNotMatch(panel, /conversation-provider/);
  assert.doesNotMatch(panel, />原消息</);

  assert.match(
    css,
    /\.conversation-favorite-card\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*gap:\s*6px[^}]*padding:\s*11px 13px/s,
  );
  assert.match(
    css,
    /\.conversation-favorite-main\s*\{[^}]*display:\s*grid[^}]*gap:\s*6px[^}]*padding-right:/s,
  );
  assert.match(
    css,
    /\.conversation-favorite-actions\s*\{[^}]*position:\s*absolute[^}]*top:\s*11px[^}]*right:\s*13px/s,
  );
  assert.match(
    css,
    /\.conversation-favorite-original\s*\{[^}]*font-size:\s*14px[^}]*font-weight:\s*500[^}]*line-height:\s*1\.3/s,
  );
  assert.match(
    css,
    /\.conversation-favorite-footer\s*\{[^}]*margin-top:\s*0[^}]*color:\s*#8a8a8a[^}]*font-size:\s*12px[^}]*line-height:\s*1\.3/s,
  );
});
