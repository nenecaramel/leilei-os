import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

test(
  "filtered module empty states get a 96px mobile safety gap",
  () => {
    assert.match(
      css,
      /@media\s*\(max-width:\s*760px\)[\s\S]*?\.memory-empty-state:has\(>\s*\.memory-empty-clear\)\s*\{[^}]*margin-top:\s*96px;/,
    );
  },
);

test(
  "ordinary module empty states do not inherit the 96px gap",
  () => {
    const baseBlocks = [
      ...css.matchAll(
        /\.memory-empty-state\s*\{([^}]*)\}/g,
      ),
    ].map((match) => match[1]);

    assert.ok(baseBlocks.length > 0);

    for (const block of baseBlocks) {
      assert.doesNotMatch(
        block,
        /margin-top:\s*96px;/,
      );
    }
  },
);
