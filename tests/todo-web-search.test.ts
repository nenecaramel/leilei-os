import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createGlobalSearchResultDetailLocation } from "../web/src/pages/global-search-result.js";

const read = (path: string) => readFileSync(new URL(`../web/src/${path}`, import.meta.url), "utf8");

test("Todo Day Space exposes the shared module search UI and authoritative navigation", () => {
  const page = read("pages/DaySpacePage.tsx");
  const api = read("pages/day-space-api.ts");
  const todoApi = read("pages/todo-api.ts");
  assert.match(page, /ModuleSearchButton/);
  assert.match(page, /ModuleSearchField/);
  assert.match(page, /ModuleStateMessage/);
  assert.match(page, /searchTodo/);
  assert.match(page, /day-space\?date=/);
  assert.match(todoApi, /\/todo\/search/);
});

test("Diary and Day Space use one module search primitive", () => {
  // f1fa4659 delegates Diary search tools to ModulePageHeader.
  assert.match(read("pages/DiaryPageHeader.tsx"), /<ModulePageHeader[\s\S]*searchLabel="搜索日记"/);
  for (const path of ["pages/ModulePageHeader.tsx", "pages/DaySpacePage.tsx"]) {
    const source = read(path);
    assert.match(source, /ModuleSearchButton/);
    assert.match(source, /ModuleSearchField/);
  }
  for (const path of ["pages/DiaryPage.tsx", "pages/DaySpacePage.tsx"]) {
    assert.match(read(path), /ModuleStateMessage/);
  }
  const primitive = read("components/ModuleSearch.tsx");
  assert.match(primitive, /memory-page-search/);
  assert.match(primitive, /SearchIcon/);
  assert.match(primitive, /maxLength=\{200\}/);
  const styles = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.module-search-state\s*\{[\s\S]*font-size:\s*13px[\s\S]*line-height:\s*1\.4/);
  assert.doesNotMatch(styles, /\.day-space-header-tools\s*\{/);
  assert.doesNotMatch(styles, /\.day-space-header\s*>\s*\.memory-page-search/);
});

test("Todo search results open the matching Day Space date and author paper", () => {
  assert.equal(createGlobalSearchResultDetailLocation({
    entity_type: "todo",
    entity_id: "entry-1",
    stable_name: "2026-08-13 C pending",
    snippet: "Plan the next release",
    matched_field: "text",
    match_reason: "field_match",
    lifecycle_status: "active",
    business_time: "2026-08-13T00:00:00.000Z",
    time_basis: "todo_date",
    updated_at: "2026-08-13T00:00:00.000Z",
    author: "C",
    detail_tool: "read_todo_day",
    detail_arguments: { date: "2026-08-13" },
  }, "/search?q=release"), "/day-space?date=2026-08-13&author=C");
});
