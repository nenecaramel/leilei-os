import type {
    HealthRepository,
    UpsertHealthInput,
  } from "./health-repository.js";
  import {
    ActiveUserAuthorizationError,
    requireActiveUser,
  } from "../require-active-user.js";

  export type HealthContext = {
    date: string;
    steps: number | null;
    periodStartDate: string | null;
    cycleDay: number | null;
  };

  export type SyncHealthInput = {
    date: string;
    steps?: number;
    periodStartDate?: string;
  };

  export type HealthServiceErrorCode = "USER_NOT_FOUND" | "USER_DISABLED";

  export class HealthServiceError extends Error {
    constructor(public readonly code: HealthServiceErrorCode) {
      super("Health is unavailable for the authenticated user.");
      this.name = "HealthServiceError";
    }
  }

  export class HealthService {
    constructor(private readonly repository: HealthRepository) {}

    async syncHealth(
      userId: string,
      input: SyncHealthInput,
    ): Promise<HealthContext> {
      try {
        await requireActiveUser(this.repository, userId);
      } catch (error) {
        if (error instanceof ActiveUserAuthorizationError) {
          throw new HealthServiceError(error.code);
        }
        throw error;
      }
      const record = await this.repository.upsertHealth({
        userId,
        date: input.date,
        steps: input.steps ?? null,
        periodStartDate: input.periodStartDate ?? null,
        cycleDay: null,
      });

      return {
        date: record.date,
        steps: record.steps,
        periodStartDate: record.periodStartDate,
        cycleDay: record.cycleDay,
      };
    }
  }
