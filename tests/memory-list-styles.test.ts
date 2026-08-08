import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

function block(selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing ${selector}`);
  const end = styles.indexOf("}", start);
  assert.notEqual(end, -1);
  return styles.slice(start, end);
}

test("Memory month list keeps the mobile Home-style card contract", () => {
  const card = block(".memory-month-card");
  assert.ok(card.includes("background: #ffffff;"));
  assert.ok(card.includes("border-radius: 14px;"));
  assert.ok(card.includes("box-shadow:"));

  const row = block(".memory-row");
  assert.ok(row.includes("min-height: 60px;"));

  const title = block(".memory-row-title");
  assert.ok(title.includes("overflow: hidden;"));
  assert.ok(title.includes("text-overflow: ellipsis;"));
  assert.ok(title.includes("white-space: nowrap;"));

  const meta = block(".memory-row-meta");
  assert.ok(meta.includes("justify-content: space-between;"));

  block(".memory-row + .memory-row");
  block(".memory-month-skeleton");
});


test("Memory archive header stays compact on mobile", () => {
  const header = block(".memory-archive-header");
  assert.ok(header.includes("display: flex;"));
  assert.ok(header.includes("justify-content: space-between;"));
  assert.ok(header.includes("align-items: center;"));
  assert.ok(header.includes("padding: 0 20px;"));

  const title = block(".memory-archive-header h1");
  assert.ok(title.includes("font-size:"));
  assert.ok(title.includes("font-weight:"));

  const count = block(".memory-archive-header p");
  assert.ok(count.includes("font-size:"));
  assert.ok(count.includes("color:"));
});


test("Memory mobile shell matches Home page geometry", () => {
  assert.ok(styles.includes("body:has(.memory-page)"));
  assert.ok(styles.includes(".main-content:has(.memory-page)"));

  const page = block(".memory-page");
  assert.ok(page.includes("width: min(860px, calc(100% - 48px));"));
  assert.ok(page.includes("margin: 0 auto;"));
  assert.ok(page.includes("padding: 18px 0"));
  assert.ok(page.includes("background: #ffffff;"));

  const header = block(".memory-page-header");
  assert.ok(header.includes("padding: 0 0 10px;"));

  const months = block(".memory-months");
  assert.ok(months.includes("padding: 4px 0 24px;"));
});


test("Memory expanded search keeps one visible surface", () => {
  const search = block(".memory-page-search");
  assert.ok(search.includes("background: #f3f3f3;"));

  const input = block(".memory-page-search input");
  assert.ok(input.includes("border: 0;"));
  assert.ok(input.includes("background: transparent;"));
  assert.ok(input.includes("box-shadow: none;"));
});


test("Memory header glyphs balance visual size without shrinking tap targets", () => {
  const buttons = block(".memory-page-tools > button,\n  .memory-page-tool-wrap > button");
  assert.ok(buttons.includes("width: 44px;"));
  assert.ok(buttons.includes("height: 44px;"));

  const icons = block(".memory-page-tools svg");
  assert.ok(icons.includes("width: 20px;"));
  assert.ok(icons.includes("height: 20px;"));

  const search = block(".memory-page-search-icon");
  assert.ok(search.includes("width: 21px;"));
  assert.ok(search.includes("height: 21px;"));

  const pen = block(".memory-page-create-icon");
  assert.ok(pen.includes("transform: scaleX(-1);"));
});


test("Memory expanded search glyph stays field-sized", () => {
  const icon = block(".memory-page-search > svg");
  assert.ok(icon.includes("width: 18px;"));
  assert.ok(icon.includes("height: 18px;"));
});


test("Memory expanded search keeps focus on the outer surface", () => {
  const focus = block(".memory-page-search:focus-within");
  assert.ok(focus.includes("box-shadow:"));
});
