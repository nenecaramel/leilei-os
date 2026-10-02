import { createHash } from "node:crypto";
import {
  assertEffectDispatchAllowed,
  type DurableEffect,
  type EffectStatus,
} from "../effects/effect-protocol.js";

export type ProactivityWakeMode = "live" | "replay";

export type ProactivityWakeBlockReason =
  | "replay"
  | "disabled"
  | "foreground_active"
  | "activity_changed"
  | "effect_unresolved"
  | "quiet_window"
  | "cooldown";

export type ProactivityWakeGateInput = {
  wakeId: string;
  userId: string;
  subjectId: string;
  offeredAt: string;
  mode: ProactivityWakeMode;
  enabled: boolean;
  foregroundActive: boolean;
  outstandingEffectStatus: EffectStatus | null;
  quietUntil: string | null;
  nextEligibleAt: string | null;
};

export type ProactivityWakeGateResult =
  | {
      outcome: "eligible";
    }
  | {
      outcome: "blocked";
      reason: ProactivityWakeBlockReason;
      blockedUntil: string | null;
    };

export type ProactivityWakeOutcome =
  | "quiet"
  | "reflect"
  | "contact_candidate";

export type ProactivityMessageEffectIntent = {
  effectType: "message_send";
  target: string;
  payloadHash: string;
};

export type ProactivityWakeDecision = {
  decisionId: string;
  wakeId: string;
  userId: string;
  subjectId: string;
  offeredAt: string;
  decidedAt: string;
  outcome: ProactivityWakeOutcome;
  reasonCode:
    | "gate_replay"
    | "gate_disabled"
    | "gate_foreground_active"
    | "gate_activity_changed"
    | "gate_effect_unresolved"
    | "gate_quiet_window"
    | "gate_cooldown"
    | "deliberation_failed"
    | "invalid_deliberation_output"
    | "contact_target_unavailable"
    | "model_quiet"
    | "model_reflect"
    | "model_contact_candidate";
  contactText: string | null;
  effectIntent: ProactivityMessageEffectIntent | null;
};

export type ProactivityDeliberationDraft =
  | { outcome: "quiet" }
  | { outcome: "reflect" }
  | { outcome: "contact_candidate"; text: string };

export function evaluateProactivityWakeGate(
  input: ProactivityWakeGateInput,
): ProactivityWakeGateResult {
  return evaluateProactivityWakeGateAt(input, input.offeredAt);
}

export function evaluateProactivityWakeGateAt(
  input: ProactivityWakeGateInput,
  evaluatedAt: string,
): ProactivityWakeGateResult {
  normalizeIdentity(input);
  requireIso(input.offeredAt, "offeredAt");
  const evaluationTime = requireIso(evaluatedAt, "evaluatedAt");

  if (input.mode === "replay") {
    return {
      outcome: "blocked",
      reason: "replay",
      blockedUntil: null,
    };
  }
  if (!input.enabled) {
    return {
      outcome: "blocked",
      reason: "disabled",
      blockedUntil: null,
    };
  }
  if (input.foregroundActive) {
    return {
      outcome: "blocked",
      reason: "foreground_active",
      blockedUntil: null,
    };
  }
  if (
    input.outstandingEffectStatus !== null
    && input.outstandingEffectStatus !== "observed"
  ) {
    return {
      outcome: "blocked",
      reason: "effect_unresolved",
      blockedUntil: null,
    };
  }

  const quietUntil =
    input.quietUntil === null
      ? null
      : requireIso(input.quietUntil, "quietUntil");
  if (quietUntil !== null && quietUntil > evaluationTime) {
    return {
      outcome: "blocked",
      reason: "quiet_window",
      blockedUntil: new Date(quietUntil).toISOString(),
    };
  }

  const nextEligibleAt =
    input.nextEligibleAt === null
      ? null
      : requireIso(input.nextEligibleAt, "nextEligibleAt");
  if (nextEligibleAt !== null && nextEligibleAt > evaluationTime) {
    return {
      outcome: "blocked",
      reason: "cooldown",
      blockedUntil: new Date(nextEligibleAt).toISOString(),
    };
  }

  return { outcome: "eligible" };
}

export function normalizeProactivityDeliberationDraft(
  draft: ProactivityDeliberationDraft,
): ProactivityDeliberationDraft {
  if (draft.outcome === "quiet" || draft.outcome === "reflect") {
    return draft;
  }

  const text = draft.text.normalize("NFC").trim();
  if (!text) {
    throw new Error(
      "Proactivity contact candidate text must not be blank.",
    );
  }
  if ([...text].length > 8_000) {
    throw new Error(
      "Proactivity contact candidate text is too long.",
    );
  }
  return {
    outcome: "contact_candidate",
    text,
  };
}

export function assertProactivityEffectBinding(input: {
  decision: ProactivityWakeDecision;
  effect: DurableEffect;
}): void {
  if (
    input.decision.outcome !== "contact_candidate"
    || input.decision.effectIntent === null
  ) {
    throw new Error(
      "Only a contact_candidate decision may authorize an external effect.",
    );
  }

  const intent = input.decision.effectIntent;
  const contactText = input.decision.contactText;
  if (
    contactText === null
    || intent.payloadHash !== hashProactivityMessagePayload(contactText)
  ) {
    throw new Error(
      "Proactivity contact decision payload binding is invalid.",
    );
  }

  if (
    input.effect.decisionId !== input.decision.decisionId
    || input.effect.userId !== input.decision.userId
    || input.effect.subjectId !== input.decision.subjectId
    || input.effect.effectType !== intent.effectType
    || input.effect.target !== intent.target
    || input.effect.payloadHash !== intent.payloadHash
  ) {
    throw new Error(
      "External effect does not match its proactivity decision binding.",
    );
  }
}

export function assertProactivityEffectDispatchAllowed(input: {
  mode: ProactivityWakeMode;
  decision: ProactivityWakeDecision;
  effect: DurableEffect;
}): void {
  assertProactivityEffectBinding({
    decision: input.decision,
    effect: input.effect,
  });
  assertEffectDispatchAllowed({
    mode: input.mode,
    effect: input.effect,
  });
}

export function hashProactivityMessagePayload(
  text: string,
): string {
  const normalized = text.normalize("NFC").trim();
  return createHash("sha256")
    .update(JSON.stringify({ text: normalized }), "utf8")
    .digest("hex");
}

export function proactivityGateReasonCode(
  reason: ProactivityWakeBlockReason,
): ProactivityWakeDecision["reasonCode"] {
  switch (reason) {
    case "replay":
      return "gate_replay";
    case "disabled":
      return "gate_disabled";
    case "foreground_active":
      return "gate_foreground_active";
    case "activity_changed":
      return "gate_activity_changed";
    case "effect_unresolved":
      return "gate_effect_unresolved";
    case "quiet_window":
      return "gate_quiet_window";
    case "cooldown":
      return "gate_cooldown";
  }
}

export function requireProactivityIso(
  value: string,
  field: string,
): string {
  return new Date(requireIso(value, field)).toISOString();
}

function normalizeIdentity(input: {
  wakeId: string;
  userId: string;
  subjectId: string;
}): void {
  if (
    !input.wakeId.trim()
    || !input.userId.trim()
    || !input.subjectId.trim()
  ) {
    throw new Error(
      "Proactivity wake identity fields must not be blank.",
    );
  }
}

function requireIso(
  value: string,
  field: string,
): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Proactivity wake " + field + " must be an ISO timestamp.",
    );
  }
  return parsed;
}
