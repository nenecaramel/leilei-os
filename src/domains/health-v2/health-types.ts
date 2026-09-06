export type HealthDailySummary = {
  date: string;
  steps: number;
  menstruating: boolean;
  periodStartDate: string | null;
  cycleDay: number | null;
  updatedAt: Date;
};

export type NormalizedHealthSync = Omit<HealthDailySummary, "updatedAt">;

export type HealthSyncResult = {
  created: boolean;
  summary: HealthDailySummary;
};

export type HealthSyncPayload = {
  date: string;
  steps: number;
  menstruation_dates: string[];
};

export type HealthServiceErrorCode =
  | "INVALID_HEALTH_INPUT"
  | "USER_NOT_FOUND"
  | "USER_DISABLED";

export interface HealthRepository {
  findUserById(
    userId: string,
  ): Promise<{ status: "active" | "disabled" } | null>;
  upsertDaily(
    userId: string,
    summary: NormalizedHealthSync,
  ): Promise<HealthSyncResult>;
  readDay(userId: string, date: string): Promise<HealthDailySummary | null>;
  readRange(
    userId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<HealthDailySummary[]>;
}
