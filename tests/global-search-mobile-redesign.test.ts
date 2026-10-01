import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperPath = "web/src/pages/global-search-result.ts";
const headerPath = "web/src/pages/GlobalSearchPageHeader.tsx";

test("Global Search shared result helpers provide neutral labels, compact dates, and safe detail routes", async () => {
  assert.equal(existsSync(helperPath), true, "global-search-result.ts must exist");
  const helpers = await import("../web/src/pages/global-search-result.js");

  const active: any = {
    entity_type: "diary",
    entity_id: "diary-1",
    stable_name: "UI",
    snippet: "mobile search",
    matched_field: "content",
    match_reason: "field_match",
    lifecycle_status: "active",
    business_time: "2026-08-09T07:30:00.000Z",
    time_basis: "diary_date",
    updated_at: "2026-08-09T07:30:00.000Z",
    detail_tool: "get_diary",
    detail_arguments: { id: "diary-1", scope: "active" },
  };

  assert.equal(helpers.GLOBAL_SEARCH_MODULE_LABELS.diary, "Diary");
  assert.equal(helpers.GLOBAL_SEARCH_MODULE_LABELS.todo, "Todo");
  assert.equal(helpers.GLOBAL_SEARCH_MODULE_LABELS.universe, "Universe");
  assert.match(helpers.formatGlobalSearchBusinessDate(active.business_time), /^\d{2}\/\d{2}$/);
  assert.match(
    helpers.createGlobalSearchResultDetailLocation(active, "/search?q=mobile"),
    /^\/diary\?diary=diary-1/,
  );

  const archived = {
    ...active,
    entity_type: "diary",
    entity_id: "diary-1",
    lifecycle_status: "archived",
    detail_tool: "get_diary",
    detail_arguments: { id: "diary-1", scope: "archived" },
  };
  assert.match(
    helpers.createGlobalSearchResultDetailLocation(archived, "/search?q=mobile"),
    /^\/diary\?archivedDiary=diary-1/,
  );
});

test("Global Search full page uses the active-module mobile presentation", async () => {
  assert.equal(existsSync(headerPath), true, "GlobalSearchPageHeader.tsx must exist");
  const [pageSource, headerSource, css] = await Promise.all([
    readFile("web/src/pages/GlobalSearchPage.tsx", "utf8"),
    readFile(headerPath, "utf8"),
    readFile("web/src/styles.css", "utf8"),
  ]);

  assert.match(pageSource, /GlobalSearchPageHeader/);
  assert.doesNotMatch(pageSource, /匹配方式/);
  assert.doesNotMatch(pageSource, /exact_phrase|精确短语/);
  assert.match(pageSource, /默认搜索 Diary、Todo 与 Universe；Conversations 可在模块筛选中开启/);
  assert.match(pageSource, /没有找到匹配内容/);
  assert.match(pageSource, /SEARCH_MODULES\.map/);
  assert.match(pageSource, /global-search-result-button/);
  assert.match(pageSource, /global-search-result-snippet/);
  assert.match(pageSource, /global-search-result-date/);
  assert.match(pageSource, /Archived/);

  assert.match(headerSource, /Global Search/);
  assert.match(headerSource, /DashboardIcon/);
  assert.match(headerSource, /CalendarIcon/);
  assert.match(headerSource, /ScopeIcon/);
  assert.match(headerSource, /全部模块/);
  assert.match(headerSource, /自定义范围/);
  assert.match(headerSource, /Archived|已归档/);
  assert.match(headerSource, /global-search-query/);

  assert.match(css, /global-search-redesign-2026-08-09:start/);
  assert.match(css, /\.global-search-result-group/);
  assert.match(css, /\.global-search-search/);
});


test("Global Search mobile geometry reuses the accepted shared visual language", async () => {
  const [headerSource, css] = await Promise.all([
    readFile("web/src/pages/GlobalSearchPageHeader.tsx", "utf8"),
    readFile("web/src/styles.css", "utf8"),
  ]);

  assert.match(headerSource, /global-search-module-popover/);
  assert.match(headerSource, /global-search-scope-popover/);
  assert.match(headerSource, /aria-label="Global Search 自定义开始时间"/);
  assert.match(headerSource, /aria-label="Global Search 自定义结束时间"/);

  assert.match(css, /global-search-visual-parity-2026-08-09:start/);
  assert.match(
    css,
    /\.global-search-page\s*\{[\s\S]*?width:\s*min\(860px,\s*calc\(100% - 48px\)\)/,
  );
  assert.match(
    css,
    /\.global-search-search\s*\{[\s\S]*?margin-top:\s*2px/,
  );
  assert.match(
    css,
    /\.global-search-date-popover\s*\{[\s\S]*?width:\s*244px/,
  );
  assert.match(
    css,
    /\.global-search-result-group\s*\{[\s\S]*?box-shadow:\s*0 10px 28px rgba\(0,\s*0,\s*0,\s*0\.055\)/,
  );
  assert.match(
    css,
    /\.quick-search-panel\s*\{[\s\S]*?right:\s*max\(24px/,
  );
  assert.match(
    css,
    /\.global-search-search > input,[\s\S]*?\.quick-search-field > input[\s\S]*?transform:\s*scale\(0\.875\)/,
  );
});


test("Global Search search field keeps the accepted shared search component", async () => {
  const headerSource = await readFile(
    "web/src/pages/GlobalSearchPageHeader.tsx",
    "utf8",
  );

  assert.match(
    headerSource,
    /<div className="memory-page-search">/,
  );
  assert.doesNotMatch(
    headerSource,
    /className="memory-page-search global-search-search"/,
  );
});
