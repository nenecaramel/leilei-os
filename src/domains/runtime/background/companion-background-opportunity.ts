import type {
  BackgroundOpportunityPolicy,
} from "./background-opportunity-policy.js";
import type {
  SubjectStateBackgroundMaintenance,
  SubjectStateMaintenanceKind,
} from "./subject-state-background-maintenance.js";

export type CompanionBackgroundOpportunityReason =
  | "startup"
  | "dirty"
  | "due";

export type CompanionBackgroundOpportunityResult = {
  reason: CompanionBackgroundOpportunityReason;
  maintenanceKinds: SubjectStateMaintenanceKind[];
  failures: Array<"subject_state">;
};

/**
 * Backend authority adapter for one Mac Companion background opportunity.
 *
 * The Mac owns *when* an opportunity is offered. Railway still owns durable
 * state, source revalidation and final commits. This service never polls and
 * owns no timer; each call is user-scoped, bounded and fail-soft.
 */
export class CompanionBackgroundOpportunityService {
  constructor(
    private readonly maintenance: Pick<
      SubjectStateBackgroundMaintenance,
      "schedule"
    >,
    private readonly policy: Pick<
      BackgroundOpportunityPolicy,
      "decide"
    >,
  ) {}

  async offer(input: {
    userId: string;
    reason: CompanionBackgroundOpportunityReason;
  }): Promise<CompanionBackgroundOpportunityResult> {
    const userId = input.userId.trim();
    if (!userId) {
      throw new Error(
        "Companion background opportunity user id must not be blank.",
      );
    }

    const failures: CompanionBackgroundOpportunityResult["failures"] = [];
    const runsTimedMaintenance =
      input.reason === "startup" || input.reason === "due";
    const maintenanceKinds = runsTimedMaintenance
      ? this.policy
          .decide()
          .targets
          .map((target) => toMaintenanceKind(target.kind))
          .filter(
            (kind): kind is SubjectStateMaintenanceKind =>
              kind !== null,
          )
      : [];

    if (runsTimedMaintenance) {
      try {
        if (maintenanceKinds.length > 0) {
          this.maintenance.schedule({
            userId,
            kinds: maintenanceKinds,
          });
        }
      } catch {
        failures.push("subject_state");
      }
    }

    return {
      reason: input.reason,
      maintenanceKinds,
      failures,
    };
  }
}

function toMaintenanceKind(
  kind: string,
): SubjectStateMaintenanceKind | null {
  return kind === "decay" ? "decay" : null;
}
