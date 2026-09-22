export const EFFECT_STATUSES = [
  "pending",
  "dispatched",
  "observed",
  "failed",
  "unknown",
] as const;

export type EffectStatus = (typeof EFFECT_STATUSES)[number];

export type DurableEffect = {
  effectId: string;
  userId: string;
  subjectId: string;
  decisionId: string;
  idempotencyKey: string;
  effectType: string;
  target: string;
  payloadHash: string;
  status: EffectStatus;
  attempt: number;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
  observedAt?: string | null;
  failureCode?: string | null;
};

const ALLOWED: Readonly<Record<EffectStatus, readonly EffectStatus[]>> = {
  pending: ["dispatched", "failed", "unknown"],
  dispatched: ["observed", "failed", "unknown"],
  observed: [],
  failed: ["pending"],
  unknown: ["observed", "failed"],
};

export function assertEffectTransition(
  from: EffectStatus,
  to: EffectStatus,
): void {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Invalid effect transition: ${from} -> ${to}.`);
  }
}

export function assertEffectDispatchAllowed(input: {
  mode: "live" | "replay";
  effect: DurableEffect;
}): void {
  if (input.mode === "replay") {
    throw new Error("Replay is effect-silent and cannot dispatch external effects.");
  }
  if (input.effect.status === "unknown") {
    throw new Error("Unknown delivery requires reconciliation, not blind retry.");
  }
  if (input.effect.status !== "pending") {
    throw new Error("Only pending effects may be dispatched.");
  }
}
