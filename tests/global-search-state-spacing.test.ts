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
  "Global Search loading, empty, and error share the module content anchor",
  () => {
    for (const state of ["loading", "empty", "error"]) {
      assert.match(
        source,
        new RegExp(
          `\\{state === "${state}" \\? \\(\\s*<ModuleStateMessage[\\s\\S]*?state="${state}"[\\s\\S]*?placement="module"`,
        ),
      );
    }

    assert.match(
      css,
      /\.module-state-slot\s*\{[^}]*margin:\s*64px auto 0;/,
    );
    assert.match(
      css,
      /@media\s*\(max-width:\s*760px\)[\s\S]*?\.module-state-slot\s*\{[^}]*margin-top:\s*96px;/,
    );
  },
);

test(
  "Global Search empty state offers one clear-all conditions action",
  () => {
    assert.match(
      source,
      /emptyText="没有找到匹配内容"/,
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
  "Global Search no longer owns one-off empty or error offset classes",
  () => {
    assert.doesNotMatch(
      source,
      /global-search-state-line-offset|global-search-empty-state/,
    );
  },
);

test(
  "Quick Search state spacing stays local to the search panel",
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
        /(?:margin-top|padding-top):\s*64px;/,
      );
    }
  },
);
