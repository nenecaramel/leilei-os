import type {
  BackgroundOpportunityPolicy,
} from "./background-opportunity-policy.js";
import type {
  SubjectStateBackgroundMaintenance,
  SubjectStateMaintenanceKind,
} from "./subject-state-background-maintenance.js";
import type {
  ProactivityWakeOpportunityProducer,
} from "./proactivity-wake-opportunity.js";
import type {
  RuntimeEffectDeliveryWorker,
} from "./runtime-effect-delivery-worker.js";

export type CompanionBackgroundOpportunityReason =
  | "startup"
  | "dirty"
  | "due";

export type CompanionBackgroundOpportunityResult = {
  reason: CompanionBackgroundOpportunityReason;
  maintenanceKinds: SubjectStateMaintenanceKind[];
  effectDeliveryScheduled: boolean;
  proactivityScheduled: boolean;
  failures: Array<
    "subject_state"
    | "effect_delivery"
    | "proactivity"
  >;
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
    private readonly effectDelivery: Pick<
      RuntimeEffectDeliveryWorker,
      "scheduleUser"
    > | null,
    private readonly proactivity: Pick<
      ProactivityWakeOpportunityProducer,
      "scheduleUser"
    > | null,
    private readonly effectDeliveryOnDirty: boolean = true,
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

    // Timed opportunities always get a chance to drain durable historical
    // effects. Dirty opportunities only do that when an active producer
    // (currently Proactivity) can create new effects between timed cadences.
    let effectDeliveryScheduled = false;
    if (
      this.effectDelivery
      && (
        input.reason !== "dirty"
        || this.effectDeliveryOnDirty
      )
    ) {
      try {
        this.effectDelivery.scheduleUser(userId);
        effectDeliveryScheduled = true;
      } catch {
        failures.push("effect_delivery");
      }
    }

    let proactivityScheduled = false;
    if (runsTimedMaintenance && this.proactivity) {
      try {
        proactivityScheduled =
          (await this.proactivity.scheduleUser(userId)) > 0;
      } catch {
        failures.push("proactivity");
      }
    }

    return {
      reason: input.reason,
      maintenanceKinds,
      effectDeliveryScheduled,
      proactivityScheduled,
      failures,
    };
  }
}

function toMaintenanceKind(
  kind: string,
): SubjectStateMaintenanceKind | null {
  return kind === "decay" ? "decay" : null;
}
