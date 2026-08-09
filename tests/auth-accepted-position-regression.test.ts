import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

test(
  "login composition has one authoritative 100px vertical transform",
  () => {
    const blocks = [
      ...css.matchAll(/\.auth-minimal\s*\{([^}]*)\}/g),
    ].map((match) => match[1]);

    const transforms = blocks.flatMap((block) => [
      ...block.matchAll(
        /transform:\s*translateY\((-?\d+)px\)/g,
      ),
    ]).map((match) => Number(match[1]));

    assert.deepEqual(transforms, [100]);
    assert.doesNotMatch(
      css,
      /\.auth-minimal\s*\{[^}]*translateY\(-26px\)/,
    );
  },
);

test("accepted title size remains unchanged", () => {
  assert.match(
    css,
    /\.auth-minimal h1\s*\{[^}]*font-size:\s*29px/,
  );
});
