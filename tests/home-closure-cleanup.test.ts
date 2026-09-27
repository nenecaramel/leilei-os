import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
  new URL("../web/src/pages/DashboardPage.tsx", import.meta.url),
  "utf8",
);
const todayPanelSource = readFileSync(
  new URL("../web/src/pages/TodayPanel.tsx", import.meta.url),
  "utf8",
);
const todoDialogSource = readFileSync(
  new URL("../web/src/pages/TodoPaperDialog.tsx", import.meta.url),
  "utf8",
);
const prototypeDataPath = new URL(
  "../web/src/pages/home-prototype-data.ts",
  import.meta.url,
);

test("Home runtime uses canonical Todo types and has no prototype data module", () => {
  assert.equal(existsSync(prototypeDataPath), false);
  assert.doesNotMatch(dashboardSource, /home-prototype-data|HomeNote|HomeAuthor|previewNotes/);
  assert.doesNotMatch(todayPanelSource, /home-prototype-data|HomeNote|HomeAuthor/);
  assert.match(todayPanelSource, /TodoAuthor/);
  assert.match(todayPanelSource, /TodoEntry/);
});

test("TodoPaperDialog has no entries or storage compatibility props", () => {
  assert.doesNotMatch(todoDialogSource, /@deprecated/);
  assert.doesNotMatch(todoDialogSource, /entries\?:\s*readonly TodoEntry\[\]/);
  assert.doesNotMatch(todoDialogSource, /storage\?:\s*Storage/);
  assert.doesNotMatch(todoDialogSource, /paper\?\.entries\s*\?\?\s*entries/);
  assert.match(todoDialogSource, /paper\?\.entries\s*\?\?\s*\[\]/);
});


test("Home no longer references the retired Todo localStorage migration", () => {
  assert.doesNotMatch(
    dashboardSource,
    /todo-legacy-migration|migrateLegacyTodoPapers|migrationNotice|localStorage/,
  );
});
