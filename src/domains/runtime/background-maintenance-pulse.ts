import { sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import type {
  BackgroundOpportunityPolicy,
} from "./background-opportunity-policy.js";
import type {
  SubjectStateBackgroundMaintenance,
  SubjectStateMaintenanceKind,
} from "./subject-state-background-maintenance.js";

type Database = ReturnType<typeof createDatabase>["db"];

export interface BackgroundMaintenanceUserSource {
  listUserIds(input: {
    subjectId: string;
    limit: number;
  }): Promise<string[]>;
}

export class DrizzleBackgroundMaintenanceUserSource
implements BackgroundMaintenanceUserSource {
  constructor(private readonly db: Database) {}

  async listUserIds(input: {
    subjectId: string;
    limit: number;
  }): Promise<string[]> {
    const subjectId = input.subjectId.trim();
    if (!subjectId) {
      throw new Error(
        "Background maintenance pulse subjectId must not be blank.",
      );
    }
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new Error(
        "Background maintenance pulse user limit must be positive.",
      );
    }

    const rows = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT user_id
      FROM runtime_subject_states
      WHERE subject_id = ${subjectId}
        AND validity_status = 'valid'
      ORDER BY user_id ASC
      LIMIT ${input.limit}
    `);
    return rows.map((row) => row.user_id);
  }
}

export type BackgroundMaintenancePulseConfig = {
  userLimit: number;
};

export interface BackgroundMaintenancePulse {
  start(): void;
  stopScheduling(): void;
  runNow(): Promise<number>;
  drain(): Promise<void>;
}

type TimerHandle = {
  unref?: () => void;
};

export function createBackgroundMaintenancePulse(options: {
  source: BackgroundMaintenanceUserSource;
  maintenance: Pick<SubjectStateBackgroundMaintenance, "schedule">;
  policy: Pick<BackgroundOpportunityPolicy, "decide" | "cadenceMs">;
  subjectId: string;
  config: BackgroundMaintenancePulseConfig;
  schedule?: (
    callback: () => void,
    milliseconds: number,
  ) => TimerHandle;
  clearSchedule?: (handle: TimerHandle) => void;
  afterCycle?: () => Promise<void> | void;
}): BackgroundMaintenancePulse {
  const subjectId = options.subjectId.trim();
  if (!subjectId) {
    throw new Error(
      "Background maintenance pulse subjectId must not be blank.",
    );
  }
  const intervalMs = options.policy.cadenceMs("maintenance_pulse");
  if (
    intervalMs === null
    || !Number.isFinite(intervalMs)
    || intervalMs <= 0
  ) {
    throw new Error(
      "Background maintenance pulse requires an explicit positive cadence.",
    );
  }
  if (
    !Number.isInteger(options.config.userLimit)
    || options.config.userLimit < 1
  ) {
    throw new Error(
      "Background maintenance pulse userLimit must be positive.",
    );
  }

  const schedule = options.schedule ?? ((callback, milliseconds) =>
    setInterval(callback, milliseconds));
  const clearSchedule = options.clearSchedule ?? ((handle) =>
    clearInterval(handle as NodeJS.Timeout));

  let timer: TimerHandle | null = null;
  let inFlight: Promise<number> | null = null;
  let stopping = false;

  const runNow = (): Promise<number> => {
    if (stopping) return Promise.resolve(0);
    if (inFlight) return inFlight;

    const run = (async () => {
      const decision = options.policy.decide({
        opportunity: "maintenance_pulse",
      });
      const kinds = decision.targets
        .map((target) => toMaintenanceKind(target.kind))
        .filter(
          (kind): kind is SubjectStateMaintenanceKind =>
            kind !== null,
        );

      let userIds: string[] = [];
      if (kinds.length > 0) {
        userIds = await options.source.listUserIds({
          subjectId,
          limit: options.config.userLimit,
        });
        for (const userId of userIds) {
          try {
            options.maintenance.schedule({
              userId,
              kinds,
            });
          } catch {
            // One user's maintenance opportunity cannot block later users.
          }
        }
      }

      try {
        await options.afterCycle?.();
      } catch {
        // Optional opportunity producers are fail-soft and share this pulse
        // only as cadence; they never turn Subject maintenance into failure.
      }
      return userIds.length;
    })();

    const tracked = run.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };

  return {
    start(): void {
      if (stopping || timer) return;
      timer = schedule(() => {
        void runNow().catch(() => undefined);
      }, intervalMs);
      timer.unref?.();
      void runNow().catch(() => undefined);
    },

    stopScheduling(): void {
      if (stopping) return;
      stopping = true;
      if (timer) {
        clearSchedule(timer);
        timer = null;
      }
    },

    runNow,

    async drain(): Promise<void> {
      if (inFlight) await inFlight.catch(() => undefined);
    },
  };
}

function toMaintenanceKind(
  kind: string,
): SubjectStateMaintenanceKind | null {
  switch (kind) {
    case "decay":
      return "decay";
    case "thought_evolution":
      return "thought_evolution";
    case "drive_evolution":
      return "drive_evolution";
    case "topic_lifecycle":
      return "topic_lifecycle";
    default:
      return null;
  }
}
