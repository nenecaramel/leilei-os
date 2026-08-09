import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

test(
  "authentication loading orb uses a neutral gray accent",
  () => {
    const match = css.match(
      /\.loading-orb\s*\{([^}]*)\}/,
    );

    assert.ok(match);
    assert.match(
      match[1],
      /border-top-color:\s*#8a8a8a;/,
    );
    assert.doesNotMatch(
      match[1],
      /border-top-color:\s*var\(--green\);/,
    );
  },
);
