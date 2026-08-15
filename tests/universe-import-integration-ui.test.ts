import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");
const readyStateStart = pageSource.indexOf("const { snapshot } = state;");
const notInitializedStart = pageSource.indexOf('if (state.status === "not-initialized")');
const readyStateSource = pageSource.slice(readyStateStart);

test("Universe importer is wired only into the uninitialized state", () => {
  assert.match(pageSource, /status === "not-initialized"[\s\S]*UniverseImportFlow/);
  assert.ok(notInitializedStart >= 0);
  assert.doesNotMatch(readyStateSource, /UniverseImportFlow/);
});

test("ready state retains only the existing export and create actions", () => {
  assert.match(readyStateSource, />导出<\/button>/);
  assert.match(readyStateSource, />新增<\/button>/);
  assert.doesNotMatch(readyStateSource, /选择旧 Universe JSON|确认迁移|UniverseImportFlow/);
});
