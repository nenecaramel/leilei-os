import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("web/src/pages/DaySpacePage.tsx", "utf8");
const picker = readFileSync("web/src/pages/DaySpaceDatePicker.tsx", "utf8");
const styles = readFileSync("web/src/styles.css", "utf8");
const app = readFileSync("web/src/App.tsx", "utf8");
const nav = readFileSync("web/src/layout/NavigationGroups.tsx", "utf8");

test("Day Space is an active route and navigation destination", () => {
  assert.match(app, /DaySpacePage/);
  assert.match(app, /path=["']day-space["']/);
  assert.match(nav, /label:\s*["']Day Space["']/);
  assert.match(nav, /to:\s*["']\/day-space["']/);
});

test("Day Space keeps the approved mobile shell and reuses its native paper controls for Todo creation", () => {
  assert.match(page, /className="day-space-page"/);
  assert.match(page, />Day Space</);
  assert.match(page, /这一天还没有内容/);
  assert.match(page, /buildDaySpaceLocation/);
  assert.match(page, /aria-label="新增 Todo"/);
  assert.match(page, /<PlusIcon\s*\/>/);
  assert.match(page, /memory-page-tool-wrap day-space-create-wrap/);
  assert.match(page, /memory-page-popover day-space-create-popover/);
  assert.match(page, /<TodoPaperDialog/);
  assert.doesNotMatch(page, /createTodoPaper|create-todo-overlay/);
  assert.match(styles, /\.day-space-page\s*\{/);
  assert.match(styles, /calc\(100% - 48px\)/);
});

test("Day Space create icon keeps its normal color while loading, and author choices sit above date navigation", () => {
  assert.match(page, /day-space-header--create-open/);
  const navigation = styles.match(/\.day-space-date-area\s*\{[^}]*z-index:\s*(\d+)/);
  const popover = styles.match(/\.day-space-header--create-open\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(navigation, "Day Space date navigation layer exists");
  assert.ok(popover, "Day Space create menu layer exists");
  assert.ok(Number(popover[1]) > Number(navigation[1]), "create menu sits above the date navigator");
  assert.match(styles, /\.day-space-header \.day-space-create-wrap > button:disabled\s*\{[^}]*opacity:\s*1\s*;/);
  assert.match(styles, /\.day-space-header \.day-space-create-popover > button\s*\{[^}]*min-height:\s*44px/);
});

test("Day Space mixes signed Todo and Diary papers in one scatter stage", () => {
  assert.match(page, /layoutDaySpacePapers/);
  assert.match(page, /day-space-paper-\$\{paper\.type\}/);
  assert.match(page, /type:\s*"todo"/);
  assert.match(page, /type:\s*"diary"/);
  assert.match(page, /day-space-paper-signature/);
  assert.match(page, /composeDaySpacePapers/);
  assert.match(readFileSync("web/src/pages/day-space-data.ts", "utf8"), /todo:\$\{date\}:\$\{paper\.author\}/);
  assert.match(readFileSync("web/src/pages/day-space-data.ts", "utf8"), /diary:\$\{diary\.id\}/);
  assert.doesNotMatch(page, /DAY_SPACE_(?:DIARY_PROTOTYPES|TODO_SEEDS)/);
  assert.doesNotMatch(page, /localStorage/);
});

test("date picker is compact and has no calendar content markers", () => {
  assert.match(picker, /day-space-date-picker/);
  assert.match(picker, /day-space-calendar-grid/);
  assert.match(picker, /data-selected/);
  assert.match(picker, /data-today/);
  assert.doesNotMatch(picker, /marker|dot|count/i);
});
