import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

const source = readFileSync(
  new URL(
    "../web/src/pages/GlobalSearchPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test(
  "Global Search offsets empty group and error, but not loading",
  () => {
    assert.match(
      source,
      /\{state === "empty" \? \(\s*<section className="memory-empty-state global-search-empty-state"[^>]*>/,
    );

    assert.match(
      source,
      /\{state === "error" \? \(\s*<div className="global-search-state-line global-search-error-line global-search-state-line-offset"[^>]*>/,
    );

    const loading = source.match(
      /\{state === "loading" \? \(\s*<p className="([^"]+)"[^>]*>/,
    );

    assert.ok(loading);
    assert.equal(
      loading[1],
      "global-search-state-line",
    );
  },
);

test(
  "Global Search empty state offers one clear-all conditions action",
  () => {
    assert.match(
      source,
      />\s*没有找到匹配内容\s*</,
    );

    assert.match(
      source,
      /className="secondary-button memory-empty-clear"[\s\S]*?>\s*清除条件\s*</,
    );

    assert.match(
      source,
      /onClick=\{\(\) =>[\s\S]*?updateFilter\(\{\s*\.\.\.DEFAULT_GLOBAL_SEARCH_FILTERS,?\s*\}\)[\s\S]*?\}/,
    );
  },
);

test(
  "Global Search empty group gets the shared 96px mobile safety gap",
  () => {
    assert.match(
      css,
      /@media\s*\(max-width:\s*760px\)[\s\S]*?\.memory-empty-state:has\(>\s*\.memory-empty-clear\)\s*\{[^}]*margin-top:\s*96px;/,
    );
  },
);

test(
  "Global Search error keeps its dedicated 96px mobile offset",
  () => {
    assert.match(
      css,
      /@media\s*\(max-width:\s*760px\)[\s\S]*?\.global-search-state-line-offset\s*\{[^}]*margin-top:\s*96px;/,
    );
  },
);

test(
  "Quick Search state spacing is not changed to 96px",
  () => {
    const blocks = [
      ...css.matchAll(
        /\.quick-search-state\s*\{([^}]*)\}/g,
      ),
    ].map((match) => match[1]);

    assert.ok(blocks.length > 0);

    for (const block of blocks) {
      assert.doesNotMatch(
        block,
        /(?:margin-top|padding-top):\s*96px;/,
      );
    }
  },
);
