import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

const marker =
  "/* Shared inset card separators: approved System language */";
const block = css.split(marker)[1] ?? "";

test("Memory Diary Task and search rows share one positioning context", () => {
  assert.ok(block);

  assert.match(
    block,
    /\.memory-row,\s*\.global-search-result-button,\s*\.quick-search-result,\s*\.quick-search-view-all\s*\{\s*position:\s*relative;/,
  );
});

test("Memory Diary Task and Global Search retire full-width borders", () => {
  assert.match(
    block,
    /\.memory-row \+ \.memory-row,\s*\.global-search-result-button \+ \.global-search-result-button\s*\{\s*border-top:\s*0;/,
  );
});

test("all shared card rows use the same 13px inset pseudo separator", () => {
  assert.match(
    block,
    /\.memory-row \+ \.memory-row::before,\s*\.global-search-result-button \+ \.global-search-result-button::before,\s*\.quick-search-result::before,\s*\.quick-search-view-all::before\s*\{[\s\S]*?top:\s*0;[\s\S]*?right:\s*13px;[\s\S]*?left:\s*13px;[\s\S]*?height:\s*1px;[\s\S]*?background:\s*rgba\(0,\s*0,\s*0,\s*0\.08\);/,
  );
});

test("old edge-to-edge separator declarations are retired", () => {
  assert.doesNotMatch(
    css,
    /\.memory-row \+ \.memory-row\s*\{\s*border-top:\s*1px solid rgba\(0,\s*0,\s*0,\s*0\.08\);\s*\}/,
  );
  assert.doesNotMatch(
    css,
    /\.global-search-result-button \+ \.global-search-result-button\s*\{\s*border-top:\s*1px solid #eeeeee;\s*\}/,
  );

  const quickResult =
    css.match(/\.quick-search-result\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(
    quickResult,
    /border-top:\s*1px solid #eeeeee/,
  );

  const quickViewAll =
    css.match(/\.quick-search-view-all\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(
    quickViewAll,
    /border-top:\s*1px solid #eeeeee/,
  );
});
