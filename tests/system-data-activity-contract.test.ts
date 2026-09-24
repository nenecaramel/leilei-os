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
const activityWrapperSource = readFileSync(
  new URL("../web/src/pages/SystemActivityPage.tsx", import.meta.url),
  "utf8",
);
const activityContentSource = readFileSync(
  new URL("../web/src/pages/SystemActivityPageContent.tsx", import.meta.url),
  "utf8",
);

const dataSource = dataWrapperSource + dataContentSource;
const activitySource =
  activityWrapperSource + activityContentSource;

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

  for (const retired of ["Memory", "Task", "Shared Paper"]) {
    assert.doesNotMatch(dataContentSource, new RegExp(retired));
  }

  assert.match(dataContentSource, /\/system\/export\?scope=/i);
  assert.match(dataContentSource, />\s*Export\s*</);
  for (const [scope, label] of [
    ["all", "All"],
    ["diary", "Diary"],
    ["todo", "Todo"],
  ]) {
    assert.match(dataContentSource, new RegExp(`\\["${scope}", "${label}"\\]`));
  }

  assert.match(
    dataContentSource,
    /const IMPORT_MODULE_ORDER = \["diary", "todo"\] as const;/,
  );
});

test("Activity reads the approved endpoint and renders only safe public event fields", () => {
  assert.match(activityWrapperSource, /useWebApiClient/);
  assert.match(
    activityContentSource,
    /"\/system\/activity"/,
  );

  for (const field of [
    "occurred_at",
    "label",
    "source",
    "outcome",
  ]) {
    assert.match(
      activityContentSource,
      new RegExp(field),
    );
  }

  assert.match(activityContentSource, /No activity yet/);
  assert.match(activityContentSource, /Retry/);

  assert.doesNotMatch(
    activitySource,
    /payload|hash|token|secret|request_body|result_payload/i,
  );
});
