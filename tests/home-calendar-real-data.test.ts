import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(new URL("../web/src/pages/DashboardPage.tsx", import.meta.url), "utf8");
const calendarSource = readFileSync(new URL("../web/src/pages/CalendarPreview.tsx", import.meta.url), "utf8");
const daySpaceApiSource = readFileSync(new URL("../web/src/pages/day-space-api.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../web/src/main.tsx", import.meta.url), "utf8");

test("Home Calendar discovers real Todo and Diary dates instead of fixture markers", () => {
  assert.doesNotMatch(dashboardSource, /HOME_CALENDAR_DAYS|home-prototype-data/);
  assert.match(dashboardSource, /listTodoDates/);
  assert.match(dashboardSource, /listDiaryDates/);
  assert.match(dashboardSource, /mergeCalendarContentDates/);
  assert.match(dashboardSource, /contentDates=\{calendarContentDates\}/);
  assert.match(dashboardSource, /status=\{calendarLoadState\}/);
  assert.match(daySpaceApiSource, /export async function listDiaryDates/);
});

test("Calendar keeps its geometry while adding month controls, markers, retry and Day Space links", () => {
  assert.match(calendarSource, /contentDates/);
  assert.match(calendarSource, /status/);
  assert.match(calendarSource, /onRetry/);
  assert.match(calendarSource, /aria-label="上一个月"/);
  assert.match(calendarSource, /aria-label="下一个月"/);
  assert.match(calendarSource, /calendar-day-marker/);
  assert.match(calendarSource, /status === "ready"/);
  assert.match(calendarSource, /\/day-space\?date=/);
  assert.match(calendarSource, /Unable to read Calendar\./);
  assert.match(mainSource, /home-calendar-real-data\.css/);
});

test("saving a Home Todo paper refreshes Calendar date discovery", () => {
  const onSavedIndex = dashboardSource.indexOf("onSaved={(paper)");
  assert.ok(onSavedIndex >= 0);
  assert.match(dashboardSource.slice(onSavedIndex, onSavedIndex + 320), /void loadCalendar\(\)/);
});
