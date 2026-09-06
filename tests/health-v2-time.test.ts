import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCurrentTime,
  getProductDate,
  PRODUCT_TIMEZONE,
} from "../src/domains/time/current-time.js";

test("current time uses the fixed product timezone", () => {
  assert.equal(PRODUCT_TIMEZONE, "Asia/Shanghai");
  assert.equal(
    getProductDate(new Date("2026-09-05T16:00:00.000Z")),
    "2026-09-06",
  );
  assert.deepEqual(formatCurrentTime(new Date("2026-09-06T04:33:10.000Z")), {
    date: "2026-09-06",
    time: "12:33:10",
    datetime: "2026-09-06T12:33:10+08:00",
    timezone: "Asia/Shanghai",
    weekday: "Sunday",
  });
});
