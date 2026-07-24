import type {
    HealthRepository,
    UpsertHealthInput,
  } from "./health-repository.js";
  
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
  
  export class HealthService {
    constructor(private readonly repository: HealthRepository) {}
  
    async syncHealth(
      userId: string,
      input: SyncHealthInput,
    ): Promise<HealthContext> {
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