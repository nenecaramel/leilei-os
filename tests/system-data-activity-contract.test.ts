import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dataWrapperSource = readFileSync(
  new URL("../web/src/pages/SystemDataPage.tsx", import.meta.url),
  "utf8",
);
const dataContentSource = readFileSync(
  new URL("../web/src/pages/SystemDataPageContent.tsx", import.meta.url),
  "utf8",
);
const dataSource = dataWrapperSource + dataContentSource;
test("Data reads active-module counts and exposes active export actions", () => {
  assert.match(dataWrapperSource, /useWebApiClient/);
  assert.match(dataContentSource, /"\/system\/data"/);

  for (const label of [
    "Diary",
    "Todo",
    "Active",
    "Archived",
  ]) {
    assert.match(dataContentSource, new RegExp(label));
  }

  // Rendered module rows are verified by system-data-activity-ui.test.ts.
  // Backup explanations may name Memory without introducing a separate module.

  assert.match(dataContentSource, /"\/system\/export"/);
  assert.match(dataContentSource, /Full Backup/);
  assert.doesNotMatch(dataContentSource, /export\?scope=/);
  const order = dataContentSource.match(/const IMPORT_MODULE_ORDER: WebImportModule\[\] = \[([\s\S]*?)\];/)?.[1];
  assert.ok(order);
  assert.deepEqual([...order.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]),
    ["diary", "diary_comments", "todo", "workspaces", "conversations", "mind", "universe"]);

});
