import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

test("login composition matches the screenshot-approved vertical position", () => {
  assert.match(
    css,
    /\.auth-minimal\s*\{[^}]*transform:\s*translateY\(68px\)/,
  );
});

test("accepted title size remains unchanged", () => {
  assert.match(
    css,
    /\.auth-minimal h1\s*\{[^}]*font-size:\s*29px/,
  );
});
