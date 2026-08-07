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
