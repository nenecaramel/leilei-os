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
import type {
  TopicResurfaceCrossDeviceOpportunity,
} from "./topic-resurface-cross-device-opportunity.js";

export type CompanionBackgroundOpportunityReason =
  | "startup"
  | "dirty"
  | "due";

export type CompanionBackgroundOpportunityResult = {
  reason: CompanionBackgroundOpportunityReason;
  maintenanceKinds: SubjectStateMaintenanceKind[];
  effectDeliveryScheduled: boolean;
  proactivityScheduled: boolean;
  topicResurfaceOffered: boolean;
  failures: Array<
    "subject_state"
    | "effect_delivery"
    | "proactivity"
    | "topic_resurface"
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
    private readonly topicResurface: Pick<
      TopicResurfaceCrossDeviceOpportunity,
      "offer"
    > | null,
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
          .decide({ opportunity: "maintenance_pulse" })
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

    // Effect recovery is cheap and may become deliverable immediately after
    // foreground completion, so it is the only subsystem intentionally
    // offered on a dirty opportunity.
    let effectDeliveryScheduled = false;
    if (this.effectDelivery) {
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

    // Topic resurfacing is reflective cadence work, not a post-turn task.
    // Companion's durable due cadence already decides when to offer it.
    let topicResurfaceOffered = false;
    if (input.reason === "due" && this.topicResurface) {
      try {
        await this.topicResurface.offer({ userId });
        topicResurfaceOffered = true;
      } catch {
        failures.push("topic_resurface");
      }
    }

    return {
      reason: input.reason,
      maintenanceKinds,
      effectDeliveryScheduled,
      proactivityScheduled,
      topicResurfaceOffered,
      failures,
    };
  }
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
