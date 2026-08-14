import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile("web/src/styles.css", "utf8");
const app = await readFile("web/src/App.tsx", "utf8");
const placeholder = await readFile(
  "web/src/pages/PlaceholderPage.tsx",
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

test("Chat Archive keeps its placeholder while Universe uses the spatial page", () => {
  assert.doesNotMatch(app, /ArchiveIcon|UniverseIcon/);
  assert.match(
    app,
    /path="chat-archive"[\s\S]*?<PlaceholderPage title="Chat Archive"\s*\/>/,
  );
  assert.match(
    app,
    /import \{ UniversePage \} from "\.\/pages\/UniversePageContainer"/,
  );
  assert.match(app, /path="universe"[\s\S]*?<UniversePage\s*\/>/);
  assert.match(universePage, /className="universe-cosmos"/);

  assert.doesNotMatch(
    placeholder,
    /PageHeader|eyebrow|description|note|icon|placeholder-panel/,
  );
  assert.match(
    placeholder,
    /className="page memory-page simple-placeholder-page"/,
  );
  assert.match(placeholder, /className="memory-page-header"/);
  assert.match(placeholder, /className="memory-page-heading"/);
  assert.match(placeholder, /className="memory-page-title"/);
});

test("simple placeholder pages force a white content surface", () => {
  const start =
    "/* leilei-simple-placeholder-pages-2026-08-08:start */";
  const end =
    "/* leilei-simple-placeholder-pages-2026-08-08:end */";

  const startIndex = css.indexOf(start);
  const endIndex = css.indexOf(end);

  assert.notEqual(startIndex, -1);
  assert.notEqual(endIndex, -1);

  const block = css.slice(startIndex, endIndex + end.length);
  assert.match(
    block,
    /\.simple-placeholder-page\s*\{[\s\S]*?background:\s*#ffffff\s*!important;/,
  );
  assert.match(
    block,
    /\.main-content:has\(\.simple-placeholder-page\)/,
  );
});
