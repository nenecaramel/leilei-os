import { Temporal } from "@js-temporal/polyfill";
import {
  ActiveUserAuthorizationError,
  requireActiveUser,
} from "../require-active-user.js";
import { getProductDate } from "../time/current-time.js";
import type {
  HealthDailySummary,
  HealthRepository,
  HealthServiceErrorCode,
  HealthSyncPayload,
  HealthSyncResult,
  NormalizedHealthSync,
} from "./health-types.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_STEPS = 2_147_483_647;
const MAX_HISTORY_DAYS = 60;

export class HealthServiceError extends Error {
  constructor(public readonly code: HealthServiceErrorCode) {
    super("Health data is unavailable.");
    this.name = "HealthServiceError";
  }
}

export function normalizeHealthSyncPayload(
  payload: HealthSyncPayload,
  now: Date = new Date(),
): NormalizedHealthSync {
  if (!payload || typeof payload !== "object") invalidInput();

  const requestDate = parseDate(payload.date);
  if (Temporal.PlainDate.compare(requestDate, parseDate(getProductDate(now))) > 0) {
    invalidInput();
  }
  if (
    !Number.isInteger(payload.steps) ||
    payload.steps < 0 ||
    payload.steps > MAX_STEPS
  ) {
    invalidInput();
  }
  if (
    !Array.isArray(payload.menstruation_dates) ||
    payload.menstruation_dates.length > MAX_HISTORY_DAYS
  ) {
    invalidInput();
  }

  const earliestDate = requestDate.subtract({ days: MAX_HISTORY_DAYS });
  const normalizedDates = [...new Set(payload.menstruation_dates)]
    .map((value) => parseDate(value))
    .map((value) => {
      if (
        Temporal.PlainDate.compare(value, earliestDate) < 0 ||
        Temporal.PlainDate.compare(value, requestDate) > 0
      ) {
        invalidInput();
      }
      return value;
    })
    .sort(Temporal.PlainDate.compare);

  if (normalizedDates.length === 0) {
    return {
      date: requestDate.toString(),
      steps: payload.steps,
      menstruating: false,
      periodStartDate: null,
      cycleDay: null,
    };
  }

  let latestRunStart = normalizedDates[0]!;
  for (let index = 1; index < normalizedDates.length; index += 1) {
    const previous = normalizedDates[index - 1]!;
    const current = normalizedDates[index]!;
    if (!previous.add({ days: 1 }).equals(current)) {
      latestRunStart = current;
    }
  }

  const date = requestDate.toString();
  return {
    date,
    steps: payload.steps,
    menstruating: normalizedDates.some((value) => value.equals(requestDate)),
    periodStartDate: latestRunStart.toString(),
    cycleDay: requestDate.since(latestRunStart, { largestUnit: "day" }).days + 1,
  };
}

export class HealthService {
  constructor(
    private readonly repository: HealthRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async syncDaily(
    userId: string,
    payload: HealthSyncPayload,
  ): Promise<HealthSyncResult> {
    try {
      return await this.repository.upsertDaily(
        userId,
        normalizeHealthSyncPayload(payload, this.now()),
      );
    } catch (error) {
      if (error instanceof ActiveUserAuthorizationError) {
        throw new HealthServiceError(error.code);
      }
      throw error;
    }
  }

  async readDay(
    userId: string,
    date: string,
  ): Promise<HealthDailySummary | null> {
    await this.requireActiveUser(userId);
    return this.repository.readDay(userId, parseDate(date).toString());
  }

  async readRecent(userId: string, days: number): Promise<HealthDailySummary[]> {
    await this.requireActiveUser(userId);
    if (!Number.isInteger(days) || days < 1 || days > MAX_HISTORY_DAYS) {
      invalidInput();
    }
    const dateTo = parseDate(getProductDate(this.now()));
    const dateFrom = dateTo.subtract({ days: days - 1 });
    return this.repository.readRange(
      userId,
      dateFrom.toString(),
      dateTo.toString(),
    );
  }

  private async requireActiveUser(userId: string): Promise<void> {
    try {
      await requireActiveUser(this.repository, userId);
    } catch (error) {
      if (error instanceof ActiveUserAuthorizationError) {
        throw new HealthServiceError(error.code);
      }
      throw error;
    }
  }
}

function parseDate(value: unknown): Temporal.PlainDate {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) invalidInput();
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    invalidInput();
  }
}

function invalidInput(): never {
  throw new HealthServiceError("INVALID_HEALTH_INPUT");
}
