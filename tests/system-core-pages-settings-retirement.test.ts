import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const files = {
  memoryPage: readFileSync(
    new URL("../web/src/pages/MemoryPage.tsx", import.meta.url),
    "utf8",
  ),
  memoryContainer: readFileSync(
    new URL("../web/src/pages/MemoryPageContainer.tsx", import.meta.url),
    "utf8",
  ),
  diaryPage: readFileSync(
    new URL("../web/src/pages/DiaryPage.tsx", import.meta.url),
    "utf8",
  ),
  diaryContainer: readFileSync(
    new URL("../web/src/pages/DiaryPageContainer.tsx", import.meta.url),
    "utf8",
  ),
  taskPage: readFileSync(
    new URL("../web/src/pages/TaskPage.tsx", import.meta.url),
    "utf8",
  ),
  taskContainer: readFileSync(
    new URL("../web/src/pages/TaskPageContainer.tsx", import.meta.url),
    "utf8",
  ),
};

test("Memory, Diary, and Task no longer consume Settings runtime", () => {
  for (const [name, source] of Object.entries(files)) {
    assert.doesNotMatch(
      source,
      /SettingsData|SettingsProvider|useSettings|from "\.\.\/settings\//,
      `${name} still imports Settings`,
    );
  }

  assert.doesNotMatch(files.memoryPage, /settings\s*:/);
  assert.doesNotMatch(files.diaryPage, /settings\s*:/);
  assert.doesNotMatch(files.taskPage, /settings\s*:/);
  assert.doesNotMatch(files.diaryPage, /settings\.page_copy/);
  assert.doesNotMatch(files.taskPage, /settings\.page_copy/);
  assert.doesNotMatch(
    files.taskPage,
    /\bsettings\./,
    "Task still reads retired Settings at runtime",
  );
});

test("Diary and Task keep their accepted static descriptions", () => {
  assert.match(
    files.diaryPage,
    /description="按时间记录、查看和整理属于蕾蕾的日常。"/,
  );
  assert.match(
    files.taskPage,
    /description="管理待办事项、截止时间与完成状态。"/,
  );
});
