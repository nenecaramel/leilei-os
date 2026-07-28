import { Temporal } from "@js-temporal/polyfill";

export const DEFAULT_ACCOUNT_TIMEZONE = "Asia/Shanghai";

export type TaskTimeBucket =
  | "no_due_date"
  | "overdue"
  | "today"
  | "next_7_days"
  | "later";

export type TaskTimeBoundaries = {
  todayStart: Date;
  tomorrowStart: Date;
  eighthDayStart: Date;
};

const LOCAL_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

export function normalizeIanaTimezone(value: string): string {
  const timezone = value.normalize("NFC").trim();
  if (!timezone || timezone.length > 64) {
    throw new RangeError("Timezone must contain between 1 and 64 characters.");
  }

  try {
    Temporal.Now.zonedDateTimeISO(timezone);
  } catch {
    throw new RangeError("Timezone must be a valid IANA timezone.");
  }

  return timezone;
}

export function parseTaskDueTime(
  value: string | null | undefined,
  timezone: string,
): Date | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }

  const normalized = value.trim();

  try {
    if (LOCAL_DATE_TIME_PATTERN.test(normalized)) {
      const plain = Temporal.PlainDateTime.from(normalized);
      const zoned = plain.toZonedDateTime(normalizeIanaTimezone(timezone), {
        disambiguation: "reject",
      });
      return new Date(zoned.epochMilliseconds);
    }

    const offset = /([+-])(\d{2}):(\d{2})$/.exec(normalized);
    if (
      offset &&
      (Number(offset[2]) > 14 ||
        Number(offset[3]) > 59 ||
        (Number(offset[2]) === 14 && Number(offset[3]) !== 0))
    ) {
      throw new RangeError("UTC offset is outside the supported range.");
    }

    const instant = Temporal.Instant.from(normalized);
    return new Date(instant.epochMilliseconds);
  } catch {
    throw new RangeError(
      "Due time must be null, an ISO instant, or a valid local date-time interpreted in the account timezone.",
    );
  }
}

export function formatTaskLocalInput(
  dueTime: string | Date | null,
  timezone: string,
): string {
  if (dueTime === null) return "";
  const instant = Temporal.Instant.from(
    dueTime instanceof Date ? dueTime.toISOString() : dueTime,
  );
  return instant
    .toZonedDateTimeISO(normalizeIanaTimezone(timezone))
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}

export function getTaskTimeBoundaries(
  timezone: string,
  now: Date = new Date(),
): TaskTimeBoundaries {
  const zone = normalizeIanaTimezone(timezone);
  const current = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(zone);
  const today = current.toPlainDate();

  return {
    todayStart: toDate(today.toZonedDateTime({ timeZone: zone })),
    tomorrowStart: toDate(
      today.add({ days: 1 }).toZonedDateTime({ timeZone: zone }),
    ),
    eighthDayStart: toDate(
      today.add({ days: 8 }).toZonedDateTime({ timeZone: zone }),
    ),
  };
}

export function classifyTaskDueTime(
  dueTime: Date | null,
  timezone: string,
  now: Date = new Date(),
): TaskTimeBucket {
  if (dueTime === null) return "no_due_date";

  const boundaries = getTaskTimeBoundaries(timezone, now);
  if (dueTime < boundaries.todayStart) return "overdue";
  if (dueTime < boundaries.tomorrowStart) return "today";
  if (dueTime < boundaries.eighthDayStart) return "next_7_days";
  return "later";
}

function toDate(value: Temporal.ZonedDateTime): Date {
  return new Date(value.epochMilliseconds);
}
