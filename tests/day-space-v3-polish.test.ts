import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("web/src/pages/DaySpacePage.tsx", "utf8");
const styles = readFileSync("web/src/styles.css", "utf8");

const start = styles.indexOf("/* leilei-day-space-mobile-2026-08-09:start */");
const end = styles.indexOf("/* leilei-day-space-mobile-2026-08-09:end */");
const daySpaceCss = styles.slice(start, end);

test("Day Space title reuses the accepted mobile page title primitives", () => {
  assert.match(page, /className="memory-page-heading"/);
  assert.match(page, /className="memory-page-title">Day Space/);
  assert.doesNotMatch(page, /<h1>Day Space<\/h1>/);
});

test("Day Space preview papers do not print redundant Todo or Diary type labels", () => {
  assert.doesNotMatch(page, /day-space-paper-kind/);
  assert.doesNotMatch(daySpaceCss, /\.day-space-paper-kind/);
});

test("Day Space overflow uses ellipsis and never a fade overlay", () => {
  assert.match(page, /day-space-preview-ellipsis/);
  assert.match(page, />\s*\.\.\.\s*<\/div>/);
  assert.doesNotMatch(daySpaceCss, /\.day-space-paper::after/);
  assert.doesNotMatch(daySpaceCss, /linear-gradient\s*\(/);
  assert.match(daySpaceCss, /-webkit-line-clamp/);
});
