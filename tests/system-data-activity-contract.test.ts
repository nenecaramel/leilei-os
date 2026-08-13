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

test("Data reads the approved counts endpoint and exposes the approved export actions", () => {
  assert.match(dataWrapperSource, /useWebApiClient/);
  assert.match(dataContentSource, /"\/system\/data"/);

  for (const label of [
    "Memory",
    "Diary",
    "Task",
    "Health",
    "Active",
    "Archived",
    "Total",
  ]) {
    assert.match(dataContentSource, new RegExp(label));
  }

  assert.match(dataContentSource, /\/system\/export\?scope=/i);
  for (const label of ["Export all", "Export Memory", "Export Diary", "Export Task", "Export Todo"]) {
    assert.match(dataContentSource, new RegExp(label));
  }
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
