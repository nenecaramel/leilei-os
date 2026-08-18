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

test("Memory paper view and editor stay borderless and single-line at the title", () => {
  const title = block(".memory-paper-title");
  assert.ok(title.includes("white-space: nowrap;"));
  assert.ok(title.includes("overflow: hidden;"));
  assert.ok(title.includes("text-overflow: ellipsis;"));

  const key = block(".memory-paper-key");
  assert.ok(key.includes("border: 0;"));
  assert.ok(key.includes("background: transparent;"));
  assert.ok(key.includes("box-shadow: none;"));
  assert.ok(key.includes("white-space: nowrap;"));
  assert.ok(key.includes("text-overflow: ellipsis;"));

  const body = block(".memory-paper-content-editor");
  assert.ok(body.includes("resize: none;"));
  assert.ok(body.includes("border: 0;"));
  assert.ok(body.includes("background: transparent;"));
  assert.ok(body.includes("box-shadow: none;"));

  const metadata = block(".memory-paper-metadata");
  assert.ok(metadata.includes("display: flex;"));
  block(".memory-paper-category-menu");
  assert.equal(styles.includes(".memory-paper-form {"), false);

  const control = block(".memory-paper-control");
  assert.ok(control.includes("border: 0;"));
  assert.ok(control.includes("background: transparent;"));
});
