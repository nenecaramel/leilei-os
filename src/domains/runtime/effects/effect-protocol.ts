export const EFFECT_STATUSES = [
  "pending",
  "reserved",
  "dispatching",
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
  reservedBy?: string | null;
  reservedAt?: string | null;
  reservationExpiresAt?: string | null;
  dispatchStartedAt?: string | null;
  observedAt?: string | null;
  failureCode?: string | null;
};

const ALLOWED: Readonly<Record<EffectStatus, readonly EffectStatus[]>> = {
  pending: ["reserved"],
  reserved: ["pending", "dispatching"],
  dispatching: ["observed", "failed", "unknown"],
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
    throw new Error(
      "Replay is effect-silent and cannot dispatch external effects.",
    );
  }
  if (input.effect.status === "unknown") {
    throw new Error(
      "Unknown delivery requires reconciliation, not blind retry.",
    );
  }
  if (input.effect.status !== "reserved") {
    throw new Error(
      "Only a reserved effect may begin external dispatch.",
    );
  }
  if (
    !input.effect.reservedBy
    || !input.effect.reservedAt
    || !input.effect.reservationExpiresAt
  ) {
    throw new Error(
      "Reserved effect is missing durable reservation metadata.",
    );
  }
}

export function assertEffectRequeueAllowed(
  effect: DurableEffect,
): void {
  if (effect.status !== "failed" || !effect.retryable) {
    throw new Error(
      "Only retryable failed effects may be requeued.",
    );
  }
}

export function assertEffectUnknownReconciliationAllowed(
  effect: DurableEffect,
): void {
  if (effect.status !== "unknown") {
    throw new Error(
      "Only unknown effects may be reconciled.",
    );
  }
}
