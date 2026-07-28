import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTaskDueTime,
  getTaskTimeBoundaries,
  parseTaskDueTime,
} from "../src/domains/task/task-time.js";

test("Asia/Shanghai local task time is stored as the matching UTC instant", () => {
  assert.equal(
    parseTaskDueTime("2026-07-23T16:30", "Asia/Shanghai")?.toISOString(),
    "2026-07-23T08:30:00.000Z",
  );
});

test("an existing ISO instant is preserved when the display timezone changes", () => {
  const instant = parseTaskDueTime(
    "2026-07-23T08:30:00.000Z",
    "Asia/Shanghai",
  );
  assert.equal(instant?.toISOString(), "2026-07-23T08:30:00.000Z");
  assert.equal(
    parseTaskDueTime(instant?.toISOString(), "America/New_York")?.toISOString(),
    "2026-07-23T08:30:00.000Z",
  );
});

test("null and omitted due times remain without a due date", () => {
  assert.equal(parseTaskDueTime(null, "Asia/Shanghai"), null);
  assert.equal(parseTaskDueTime(undefined, "Asia/Shanghai"), null);
});

test("task time buckets are mutually exclusive at local midnight boundaries", () => {
  const timezone = "Asia/Shanghai";
  const now = new Date("2026-07-22T12:00:00.000Z");
  const boundaries = getTaskTimeBoundaries(timezone, now);

  assert.equal(classifyTaskDueTime(null, timezone, now), "no_due_date");
  assert.equal(
    classifyTaskDueTime(
      new Date(boundaries.todayStart.getTime() - 1),
      timezone,
      now,
    ),
    "overdue",
  );
  assert.equal(
    classifyTaskDueTime(boundaries.todayStart, timezone, now),
    "today",
  );
  assert.equal(
    classifyTaskDueTime(boundaries.tomorrowStart, timezone, now),
    "next_7_days",
  );
  assert.equal(
    classifyTaskDueTime(boundaries.eighthDayStart, timezone, now),
    "later",
  );
});

test("time boundaries cross month and year without fixed-offset arithmetic", () => {
  const boundaries = getTaskTimeBoundaries(
    "Asia/Shanghai",
    new Date("2026-12-31T15:30:00.000Z"),
  );
  assert.equal(boundaries.todayStart.toISOString(), "2026-12-30T16:00:00.000Z");
  assert.equal(
    boundaries.tomorrowStart.toISOString(),
    "2026-12-31T16:00:00.000Z",
  );
  assert.equal(
    boundaries.eighthDayStart.toISOString(),
    "2027-01-07T16:00:00.000Z",
  );
});

test("DST boundaries use the IANA timezone model", () => {
  const boundaries = getTaskTimeBoundaries(
    "America/New_York",
    new Date("2026-03-08T12:00:00.000Z"),
  );
  assert.equal(boundaries.todayStart.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(
    boundaries.tomorrowStart.toISOString(),
    "2026-03-09T04:00:00.000Z",
  );
  assert.equal(
    boundaries.tomorrowStart.getTime() - boundaries.todayStart.getTime(),
    23 * 60 * 60 * 1000,
  );
});

test("nonexistent DST local times are rejected instead of shifted", () => {
  assert.throws(() =>
    parseTaskDueTime("2026-03-08T02:30", "America/New_York"),
  );
});

test("invalid IANA timezones are rejected", () => {
  assert.throws(() => parseTaskDueTime("2026-07-23T16:30", "Tomorrow/Noon"));
});
