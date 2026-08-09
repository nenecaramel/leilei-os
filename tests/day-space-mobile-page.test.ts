import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("web/src/pages/DaySpacePage.tsx", "utf8");
const picker = readFileSync("web/src/pages/DaySpaceDatePicker.tsx", "utf8");
const fixture = readFileSync("web/src/pages/day-space-prototype-data.ts", "utf8");
const styles = readFileSync("web/src/styles.css", "utf8");
const app = readFileSync("web/src/App.tsx", "utf8");
const nav = readFileSync("web/src/layout/NavigationGroups.tsx", "utf8");

test("Day Space is an active route and navigation destination", () => {
  assert.match(app, /DaySpacePage/);
  assert.match(app, /path=["']day-space["']/);
  assert.match(nav, /label:\s*["']Day Space["']/);
  assert.match(nav, /to:\s*["']\/day-space["']/);
});

test("Day Space keeps the approved mobile shell and no create CTA", () => {
  assert.match(page, /className="day-space-page"/);
  assert.match(page, />Day Space</);
  assert.match(page, /这一天还没有内容/);
  assert.match(page, /buildDaySpaceLocation/);
  assert.doesNotMatch(page, /新增|创建|create CTA/i);
  assert.match(styles, /\.day-space-page\s*\{/);
  assert.match(styles, /calc\(100% - 48px\)/);
});

test("Day Space mixes signed Todo and Diary papers in one scatter stage", () => {
  assert.match(page, /layoutDaySpacePapers/);
  assert.match(page, /day-space-paper-\$\{paper\.type\}/);
  assert.match(page, /type:\s*"todo"/);
  assert.match(page, /type:\s*"diary"/);
  assert.match(page, /day-space-paper-signature/);
  assert.match(fixture, /author:\s*"L"/);
  assert.match(fixture, /author:\s*"G"/);
  assert.doesNotMatch(fixture, /TaskPage|task-prototype|from ".+Task/);
});

test("date picker is compact and has no calendar content markers", () => {
  assert.match(picker, /day-space-date-picker/);
  assert.match(picker, /day-space-calendar-grid/);
  assert.match(picker, /data-selected/);
  assert.match(picker, /data-today/);
  assert.doesNotMatch(picker, /marker|dot|count/i);
});
