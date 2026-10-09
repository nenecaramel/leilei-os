import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

test(
  "mobile hamburger uses integer-pixel geometry so all three lines rasterize equally",
  () => {
    const iconBlocks = [
      ...styles.matchAll(
        /\.mobile-menu-icon\s*\{([^}]*)\}/g,
      ),
    ].map((match) => match[1]);

    const lineBlocks = [
      ...styles.matchAll(
        /\.mobile-menu-line\s*\{([^}]*)\}/g,
      ),
    ].map((match) => match[1]);

    assert.ok(iconBlocks.length >= 1);
    assert.ok(lineBlocks.length >= 1);

    for (const block of iconBlocks) {
      assert.doesNotMatch(block, /height:\s*12\.5px/);
    }

    for (const block of lineBlocks) {
      assert.doesNotMatch(block, /height:\s*1\.5px/);
      assert.doesNotMatch(block, /flex:\s*0 0 1\.5px/);
    }

    assert.match(
      styles,
      /\.mobile-menu-icon\s*\{[^}]*height:\s*14px/,
    );

    assert.match(
      styles,
      /\.mobile-menu-line\s*\{[^}]*height:\s*2px/,
    );

    assert.match(
      styles,
      /\.mobile-menu-line\s*\{[^}]*flex:\s*0 0 2px/,
    );
  },
);
