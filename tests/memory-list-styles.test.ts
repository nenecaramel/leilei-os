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
