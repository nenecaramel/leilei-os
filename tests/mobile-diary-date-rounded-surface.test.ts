import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile("web/src/styles.css", "utf8");

const startMarker =
  "/* leilei-diary-date-rounded-surface-2026-08-08:start */";
const endMarker =
  "/* leilei-diary-date-rounded-surface-2026-08-08:end */";

function block(): string {
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker);

  assert.notEqual(start, -1, "rounded-surface marker must exist");
  assert.notEqual(end, -1, "rounded-surface end marker must exist");

  return css.slice(start, end + endMarker.length);
}

test("Diary date gray surface is owned by one rounded clipping wrapper", () => {
  const value = block();

  const wrapper = value.match(
    /\.diary-date-popover \.native-date-field\s*\{([\s\S]*?)\}/,
  )?.[1] ?? "";

  assert.match(wrapper, /border-radius:\s*7px\s*!important;/);
  assert.match(wrapper, /overflow:\s*hidden\s*!important;/);
  assert.match(wrapper, /background:\s*#f4f4f4\s*!important;/);

  const input = value.match(
    /\.diary-date-popover \.native-date-input\s*\{([\s\S]*?)\}/,
  )?.[1] ?? "";

  assert.match(input, /border-radius:\s*7px\s*!important;/);
  assert.match(input, /background:\s*transparent\s*!important;/);
  assert.match(input, /padding-left:\s*0\s*!important;/);
  assert.match(input, /padding-right:\s*14px\s*!important;/);
});
