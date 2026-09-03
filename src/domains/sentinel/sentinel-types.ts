export type SentinelWakeCause = "scheduled" | "wake_now" | "recovery";

export type SentinelWakeRunState =
  | "bridge_enqueued"
  | "claimed"
  | "finalized"
  | "superseded"
  | "recovery_required";

export type SentinelWakeDecision = "contact" | "quiet";

export type SentinelRecord = {
  id: string;
  userId: string;
  enabled: boolean;
  timezone: string;
  policyPrompt: string;
  nextWakeAt: Date | null;
  lastValidWakeAt: Date | null;
  wakeContextCapsule: string | null;
  wakeContextUpdatedAt: Date | null;
  controlRevision: number;
  activeWakeRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SentinelWakeRunRecord = {
  id: string;
  sentinelId: string;
  userId: string;
  controlRevision: number;
  cause: SentinelWakeCause;
  scheduledFor: Date;
  triggeredAt: Date;
  bridgeEventId: string;
  state: SentinelWakeRunState;
  decision: SentinelWakeDecision | null;
  nextWakeAt: Date | null;
  completionPayloadHash: string | null;
  claimedAt: Date | null;
  finalizedAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SentinelMutationResult =
  | { outcome: "applied"; sentinel: SentinelRecord }
  | { outcome: "idempotent"; sentinel: SentinelRecord }
  | { outcome: "conflict" | "not_found" };

export type SentinelControlResult =
  | {
      outcome: "applied" | "idempotent";
      sentinel: SentinelRecord;
      wake?: SentinelWakeRunRecord;
      previousWake?: SentinelWakeRunRecord;
    }
  | { outcome: "conflict" | "not_found" };

export type SentinelWakeActivity = Pick<
  SentinelWakeRunRecord,
  "id" | "cause" | "state" | "decision" | "scheduledFor" | "nextWakeAt" | "finalizedAt" | "createdAt"
> & {
  /** Product-level projection of a wake that needs explicit owner recovery. */
  recoveryRequired: boolean;
};

export type SentinelWakeEnqueueInput = {
  userId: string;
  sentinelId: string;
  controlRevision: number;
  cause: SentinelWakeCause;
  scheduledFor: Date;
  wakeId: string;
  bridgeIdempotencyKey?: string;
  clearNextWakeAt?: boolean;
};

export type SentinelWakeEnqueueResult =
  | {
      outcome: "created" | "idempotent";
      wake: SentinelWakeRunRecord;
      bridge: import("../bridge/bridge-event-types.js").BridgeEventRecord;
    }
  | { outcome: "conflict" | "not_found" };

export type SentinelWakeCancellationResult =
  | {
      outcome: "cancelled";
      wake: SentinelWakeRunRecord;
      bridge: import("../bridge/bridge-event-types.js").BridgeEventRecord;
    }
  | { outcome: "conflict" | "not_found" };

export type SentinelWakeState = {
  wakeId: string;
  sentinelId: string;
  controlRevision: number;
  scheduledFor: Date;
  policyPrompt: string;
  contextCapsule: string | null;
  nextWakeAt: Date | null;
  lastValidWakeAt: Date | null;
  currentTime: Date;
  timezone: string;
  limits: { minNextWakeSeconds: number; maxNextWakeSeconds: number };
};

export type SentinelWakeCompletionInput = {
  userId: string;
  wakeId: string;
  decision: SentinelWakeDecision;
  nextWakeAt: Date;
  contextCapsule: string | null;
  completionPayloadHash: string;
};

export type SentinelWakeCompletionResult =
  | {
      outcome: "applied" | "idempotent";
      wake: SentinelWakeRunRecord;
      sentinel: SentinelRecord;
      bridge: import("../bridge/bridge-event-types.js").BridgeEventRecord;
  }
  | { outcome: "conflict" | "not_found" };

export type SentinelCurrentWakeClaimResult =
  | {
      outcome: "applied" | "idempotent";
      wake: SentinelWakeRunRecord;
      sentinel: SentinelRecord;
      bridge: import("../bridge/bridge-event-types.js").BridgeEventRecord;
    }
  | { outcome: "conflict" | "no_active_wake" };
