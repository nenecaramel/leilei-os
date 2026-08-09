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
  "Global Search offsets only empty and error result states",
  () => {
    assert.match(
      source,
      /\{state === "empty" \? \(\s*<p className="global-search-state-line global-search-state-line-offset">/,
    );

    assert.match(
      source,
      /\{state === "error" \? \(\s*<div className="global-search-state-line global-search-error-line global-search-state-line-offset">/,
    );

    const loading = source.match(
      /\{state === "loading" \? \(\s*<p className="([^"]+)">/,
    );

    assert.ok(loading);
    assert.equal(
      loading[1],
      "global-search-state-line",
    );
  },
);

test(
  "Global Search empty/error offset is 96px on mobile",
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
