import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const desktopPageCssUrl = new URL(
  "../web/src/desktop-page-unification.css",
  import.meta.url,
);
const mainTsx = readFileSync(
  new URL("../web/src/main.tsx", import.meta.url),
  "utf8",
);
const diaryPageTsx = readFileSync(
  new URL("../web/src/pages/DiaryPage.tsx", import.meta.url),
  "utf8",
);
const taskPageTsx = readFileSync(
  new URL("../web/src/pages/TaskPage.tsx", import.meta.url),
  "utf8",
);

function readDesktopPageCss() {
  assert.equal(
    existsSync(desktopPageCssUrl),
    true,
    "desktop-page-unification.css must exist",
  );
  return readFileSync(desktopPageCssUrl, "utf8");
}

function assertSingleDesktopMediaBlock(css: string) {
  const mediaStart = css.match(/^\s*@media\s*\(min-width:\s*761px\)\s*\{/);
  assert.ok(mediaStart, "stylesheet must start with the desktop media block");
  const openingBrace = mediaStart[0].lastIndexOf("{");
  let depth = 0;
  let closingBrace = -1;
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        closingBrace = index;
        break;
      }
    }
  }
  assert.notEqual(closingBrace, -1, "desktop media block must be closed");
  assert.equal(css.slice(closingBrace + 1).trim(), "", "all CSS rules must stay inside the desktop media block");
}

test("desktop page unification stylesheet is imported after navigation panel styles", () => {
  assert.match(
    mainTsx,
    /import "\.\/layout\/navigation-panel\.css";\s*import "\.\/desktop-page-unification\.css";/s,
  );
});

test("desktop page unification stays scoped to target pages and desktop", () => {
  const css = readDesktopPageCss();
  assertSingleDesktopMediaBlock(css);
  assert.match(css, /\.memory-page/);
  assert.match(css, /\.diary-page/);
  assert.match(css, /\.task-page/);
  assert.match(css, /\.day-space-page/);
  assert.match(css, /\.global-search-page/);
  assert.doesNotMatch(css, /\.universe-|\.sidebar|\.navigation-panel/);
  assert.doesNotMatch(css, /@media\s*\(max-width/);
  assert.doesNotMatch(css, /\.app-shell|\.mobile-(?:drawer|top-bar|menu|search)/);
});

test("desktop Memory and Global Search use the compact paper page frame", () => {
  const css = readDesktopPageCss();

  assert.match(
    css,
    /\.memory-page,\s*\.global-search-page\s*\{[^}]*width:\s*min\(100%,\s*860px\);[^}]*max-width:\s*860px;[^}]*margin:\s*0 auto;/s,
  );
  assert.match(
    css,
    /\.memory-page,\s*\.global-search-page\s*\{[^}]*font-family:\s*-apple-system,/s,
  );
  assert.match(
    css,
    /\.memory-page,\s*\.global-search-page\s*\{[^}]*padding:\s*0\s*(?:20|22|24)px;/s,
  );
});

test("desktop Memory and Global Search headers and controls stay neutral and compact", () => {
  const css = readDesktopPageCss();

  assert.match(
    css,
    /\.memory-page \.memory-page-header,\s*\.global-search-page \.memory-page-header\s*\{[^}]*min-height:\s*auto;[^}]*border-bottom:\s*1px solid #(?:e[0-9a-f]{5}|d[0-9a-f]{5});/s,
  );
  assert.match(
    css,
    /\.memory-page \.memory-page-search,\s*\.global-search-page \.memory-page-search,\s*\.memory-page \.memory-page-popover,\s*\.global-search-page \.memory-page-popover\s*\{[^}]*border:\s*1px solid #(?:e[0-9a-f]{5}|d[0-9a-f]{5});[^}]*border-radius:\s*(?:8|9|10|11|12)px;[^}]*background:\s*#(?:fff|ffffff);/s,
  );
  assert.match(
    css,
    /\.memory-page \.global-search-compact-form,\s*\.global-search-page \.global-search-compact-form,\s*\.memory-page \.global-search-domain-list,\s*\.global-search-page .global-search-domain-list\s*\{[^}]*border:\s*1px solid #(?:e[0-9a-f]{5}|d[0-9a-f]{5});[^}]*border-radius:\s*(?:8|9|10|11|12)px;[^}]*background:\s*#(?:fff|ffffff);/s,
  );
  assert.doesNotMatch(css, /Newsreader|\bgreen\b|#(?:0[0-9a-f]|1[0-9a-f]|2[0-9a-f]|3[0-9a-f]|4[0-9a-f]|5[0-9a-f]|6[0-9a-f]|7[0-9a-f])[0-9a-f]{3,4}/i);
});

test("desktop Memory and Global Search retain bounded paper rows instead of legacy cards", () => {
  const css = readDesktopPageCss();

  assert.match(
    css,
    /\.memory-page \.memory-month-card,\s*\.global-search-page \.global-search-result-group\s*\{[^}]*border:\s*1px solid #(?:e[0-9a-f]{5}|d[0-9a-f]{5});[^}]*border-radius:\s*(?:8|9|10|11|12)px;[^}]*box-shadow:\s*none;/s,
  );
  assert.match(
    css,
    /\.memory-page \.memory-row,\s*\.global-search-page \.global-search-result-button\s*\{[^}]*display:\s*grid;[^}]*min-height:\s*(?:5[6-9]|6[0-8])px;[^}]*background:\s*#(?:fff|ffffff);/s,
  );
  assert.match(
    css,
    /\.memory-page \.memory-row-title,\s*\.global-search-page \.global-search-result-title\s*\{[^}]*font-size:\s*(?:13|14|15)px;/s,
  );
  assert.match(
    css,
    /\.global-search-page \.global-search-result-group\s*\{[^}]*box-shadow:\s*none;[^}]*overflow:\s*clip;/s,
  );
});

test("Diary uses its paper header and rows as the common presentation", () => {
  assert.match(diaryPageTsx, /<DiaryPageHeader\b/);
  assert.match(diaryPageTsx, /<MobileDiaryRows\b/);
  assert.doesNotMatch(
    diaryPageTsx,
    /<PageHeader[\s\S]*?eyebrow="Personal journal"/,
  );
  assert.doesNotMatch(
    diaryPageTsx,
    /<section className="memory-message diary-filters">/,
  );
});

test("Task uses its paper header and rows as the common presentation", () => {
  assert.match(taskPageTsx, /<TaskPageHeader\b/);
  assert.match(taskPageTsx, /<MobileTaskRows\b/);
  assert.doesNotMatch(taskPageTsx, /<PageHeader\b/);
  assert.doesNotMatch(
    taskPageTsx,
    /<PageHeader[\s\S]*?eyebrow="Execution queue"/,
  );
});

test("shared Task paper keeps quick-create focus and completion metadata", () => {
  assert.match(
    taskPageTsx,
    /createPaperEditorRef\.current\?\.focusTitle\(\)/,
  );
  assert.match(
    taskPageTsx,
    /<TaskPaperEditor\s+ref=\{createPaperEditorRef\}/,
  );
  assert.match(
    taskPageTsx,
    /完成时间：\{formatTaskPaperDeadline\(task\.completed_at, task\.timezone\)\}/,
  );
});
