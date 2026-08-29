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
