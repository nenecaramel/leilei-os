import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile("web/src/styles.css", "utf8");
const app = await readFile("web/src/App.tsx", "utf8");
const navigation = await readFile(
  "web/src/layout/NavigationGroups.tsx",
  "utf8",
);
const routeScroll = await readFile(
  "web/src/layout/RouteScrollManager.tsx",
  "utf8",
);
const universePage = await readFile(
  "web/src/pages/UniversePage.tsx",
  "utf8",
);

test("Memory and Diary content search stays real 16px while looking like 14px", () => {
  const start =
    "/* leilei-mobile-search-focus-safe-2026-08-08:start */";
  const end =
    "/* leilei-mobile-search-focus-safe-2026-08-08:end */";

  const startIndex = css.indexOf(start);
  const endIndex = css.indexOf(end);

  assert.notEqual(startIndex, -1);
  assert.notEqual(endIndex, -1);

  const block = css.slice(startIndex, endIndex + end.length);
  const input = block.match(
    /\.memory-page-search input\s*\{([\s\S]*?)\}/,
  )?.[1] ?? "";

  assert.match(input, /font-size:\s*16px\s*!important;/);
  assert.match(input, /transform:\s*scale\(0\.875\);/);
  assert.match(input, /transform-origin:\s*left center;/);
  assert.match(input, /width:\s*114\.285714%\s*!important;/);
  assert.match(input, /max-width:\s*114\.285714%\s*!important;/);
});

test("Chat Archive is removed from navigation, routing, and placeholder surfaces", async () => {
  assert.doesNotMatch(navigation, /Chat Archive|chat-archive|ArchiveIcon/);
  assert.doesNotMatch(app, /Chat Archive|chat-archive|PlaceholderPage/);
  assert.doesNotMatch(routeScroll, /chat-archive/);
  assert.equal(existsSync("web/src/pages/PlaceholderPage.tsx"), false);
  assert.doesNotMatch(css, /simple-placeholder-page|leilei-simple-placeholder/);
  assert.match(
    app,
    /import \{ UniversePage \} from "\.\/pages\/UniversePageContainer"/,
  );
  assert.match(app, /path="universe"[\s\S]*?<UniversePage\s*\/>/);
  assert.match(universePage, /import \{ UniverseMobileMap \}/);
  assert.match(universePage, /<UniverseFrame><UniverseLoadingState \/><\/UniverseFrame>/);
  // Loading chrome moved with the presentation helpers in 7d4c54b2.
  const presentation = await readFile("web/src/pages/universe/UniversePagePresentation.tsx", "utf8");
  assert.match(presentation, /className="universe-cosmos universe-cosmos-loading"/);
});
