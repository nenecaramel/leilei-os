import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile("web/src/styles.css", "utf8");

const startMarker =
  "/* leilei-diary-date-vertical-center-2026-08-08:start */";
const endMarker =
  "/* leilei-diary-date-vertical-center-2026-08-08:end */";

function block(): string {
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker);
  assert.notEqual(start, -1, "date vertical-center marker must exist");
  assert.notEqual(end, -1, "date vertical-center end marker must exist");
  return css.slice(start, end + endMarker.length);
}

test("Diary date input and Safari date edit are vertically centered in the 34px field", () => {
  const value = block();

  assert.match(
    value,
    /\.diary-date-popover \.native-date-input\s*\{[\s\S]*?height:\s*34px\s*!important;[\s\S]*?padding-top:\s*0\s*!important;[\s\S]*?padding-bottom:\s*0\s*!important;[\s\S]*?line-height:\s*34px\s*!important;/,
  );

  assert.match(
    value,
    /::-webkit-date-and-time-value\s*\{[\s\S]*?height:\s*34px\s*!important;[\s\S]*?line-height:\s*34px\s*!important;/,
  );

  const datetimeEdit = value.match(
    /::-webkit-datetime-edit\s*\{([\s\S]*?)\}/,
  )?.[1] ?? "";

  assert.match(datetimeEdit, /height:\s*34px\s*!important;/);
  assert.match(datetimeEdit, /line-height:\s*34px\s*!important;/);
  assert.match(datetimeEdit, /padding-top:\s*0\s*!important;/);
  assert.match(datetimeEdit, /padding-bottom:\s*0\s*!important;/);
});
