import { Temporal } from "@js-temporal/polyfill";

export const PRODUCT_TIMEZONE = "Asia/Shanghai";

export type CurrentTimeSnapshot = {
  date: string;
  time: string;
  datetime: string;
  timezone: typeof PRODUCT_TIMEZONE;
  weekday: string;
};

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function toProductZonedDateTime(now: Date) {
  return Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(
    PRODUCT_TIMEZONE,
  );
}

export function getProductDate(now: Date = new Date()): string {
  return toProductZonedDateTime(now).toPlainDate().toString();
}

export function formatCurrentTime(now: Date = new Date()): CurrentTimeSnapshot {
  const zoned = toProductZonedDateTime(now);
  const date = zoned.toPlainDate().toString();
  const time = zoned.toPlainTime().toString({ smallestUnit: "second" });

  return {
    date,
    time,
    datetime: `${date}T${time}${zoned.offset}`,
    timezone: PRODUCT_TIMEZONE,
    weekday: WEEKDAYS[zoned.dayOfWeek - 1]!,
  };
}
