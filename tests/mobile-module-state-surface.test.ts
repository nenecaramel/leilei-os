import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const memory = readFileSync("web/src/pages/MemoryPage.tsx", "utf8");
const diary = readFileSync("web/src/pages/DiaryPage.tsx", "utf8");
const task = readFileSync("web/src/pages/TaskPage.tsx", "utf8");
const styles = readFileSync("web/src/styles.css", "utf8");

function messageFunction(source: string, name: string) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  return source.slice(start, start + 1600);
}

test("Memory, Diary and Task reusable message states opt into the lightweight mobile surface", () => {
  for (const [source, name] of [
    [memory, "MemoryMessage"],
    [diary, "DiaryMessage"],
    [task, "TaskMessage"],
  ] as const) {
    const block = messageFunction(source, name);
    assert.match(block, /className="memory-message memory-module-state(?: records-state)?"/);
  }
});

test("mobile module states remove the legacy card shell and placeholder icon", () => {
  const start = styles.indexOf(
    "/* leilei-mobile-module-state-polish-2026-08-09:start */",
  );
  const end = styles.indexOf(
    "/* leilei-mobile-module-state-polish-2026-08-09:end */",
  );

  assert.ok(start >= 0 && end > start);
  const block = styles.slice(start, end);

  assert.match(block, /\.memory-module-state/);
  assert.match(block, /border:\s*0/);
  assert.match(block, /background:\s*transparent/);
  assert.match(block, /box-shadow:\s*none/);
  assert.match(block, /\.placeholder-icon[\s\S]*display:\s*none/);
  assert.doesNotMatch(block, /min-height:\s*(220|300)px/);
});
