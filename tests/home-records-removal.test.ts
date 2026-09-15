import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../web/src/pages/DashboardPage.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

test("Home no longer renders the Records launcher section", () => {
  assert.doesNotMatch(source, />Records</);
  assert.doesNotMatch(source, /records-section|home-bottom-nav|openQuickCreate/);
  assert.doesNotMatch(source, /href="\/(memory|diary|task)"/);
  assert.doesNotMatch(source, /to="\/universe"/);
});

test("Home removes dead Records navigation styling", () => {
  assert.doesNotMatch(styles, /\.records-section/);
  assert.doesNotMatch(styles, /\.home-bottom-nav/);
});
