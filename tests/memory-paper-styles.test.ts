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

test("Memory paper body and controls use the shared lined-paper treatment", () => {
  const title = block(".memory-paper-title");
  assert.ok(title.includes("font-size:"));
  assert.ok(title.includes("font-weight:"));

  const content = block(".memory-paper-content");
  assert.ok(content.includes("white-space: pre-wrap;"));
  assert.ok(content.includes("line-height:"));

  const form = block(".memory-paper-form");
  assert.ok(form.includes("display: grid;"));

  const control = block(".memory-paper-control");
  assert.ok(control.includes("border: 0;"));
  assert.ok(control.includes("background: transparent;"));
  assert.ok(control.includes("font-size: 13px;"));
});
