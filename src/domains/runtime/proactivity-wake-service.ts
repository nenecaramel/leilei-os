import { randomUUID } from "node:crypto";
import {
  evaluateProactivityWakeGate,
  hashProactivityMessagePayload,
  normalizeProactivityDeliberationDraft,
  proactivityGateReasonCode,
  requireProactivityIso,
  type ProactivityDeliberationDraft,
  type ProactivityWakeDecision,
  type ProactivityWakeGateInput,
} from "./proactivity-wake-contract.js";

export interface ProactivityWakeDeliberator {
  decide(input: {
    wakeId: string;
    userId: string;
    subjectId: string;
    offeredAt: string;
  }): Promise<ProactivityDeliberationDraft>;
}

/**
 * First Proactivity / wake execution boundary.
 *
 * This service is intentionally effect-silent. It can produce a bound
 * contact_candidate, but it never creates, persists, dispatches, retries, or
 * observes an external effect. A later effect layer must materialize a
 * DurableEffect and pass assertProactivityEffectDispatchAllowed().
 *
 * Model-backed deliberation is also abstract here so production can route it
 * through the existing durable backend -> Mac model queue rather than running
 * Claude locally on Railway.
 */
export class ProactivityWakeService {
  constructor(
    private readonly deliberator: ProactivityWakeDeliberator,
    private readonly now: () => string = () =>
      new Date().toISOString(),
    private readonly createDecisionId: () => string = randomUUID,
  ) {}

  async run(input: {
    gate: ProactivityWakeGateInput;
    contactTarget: string | null;
  }): Promise<ProactivityWakeDecision> {
    const gate = evaluateProactivityWakeGate(input.gate);
    if (gate.outcome === "blocked") {
      return this.quietDecision(
        input.gate,
        proactivityGateReasonCode(gate.reason),
      );
    }

    let rawDraft: ProactivityDeliberationDraft;
    try {
      rawDraft = await this.deliberator.decide({
        wakeId: input.gate.wakeId,
        userId: input.gate.userId,
        subjectId: input.gate.subjectId,
        offeredAt: requireProactivityIso(
          input.gate.offeredAt,
          "offeredAt",
        ),
      });
    } catch {
      return this.quietDecision(
        input.gate,
        "deliberation_failed",
      );
    }

    let draft: ProactivityDeliberationDraft;
    try {
      draft = normalizeProactivityDeliberationDraft(rawDraft);
    } catch {
      return this.quietDecision(
        input.gate,
        "invalid_deliberation_output",
      );
    }

    if (draft.outcome === "quiet") {
      return this.quietDecision(input.gate, "model_quiet");
    }
    if (draft.outcome === "reflect") {
      return this.baseDecision(input.gate, {
        outcome: "reflect",
        reasonCode: "model_reflect",
        contactText: null,
        effectIntent: null,
      });
    }

    const target = input.contactTarget?.trim() ?? "";
    if (!target) {
      return this.quietDecision(
        input.gate,
        "contact_target_unavailable",
      );
    }

    return this.baseDecision(input.gate, {
      outcome: "contact_candidate",
      reasonCode: "model_contact_candidate",
      contactText: draft.text,
      effectIntent: {
        effectType: "message_send",
        target,
        payloadHash: hashProactivityMessagePayload(draft.text),
      },
    });
  }

  private quietDecision(
    input: ProactivityWakeGateInput,
    reasonCode: ProactivityWakeDecision["reasonCode"],
  ): ProactivityWakeDecision {
    return this.baseDecision(input, {
      outcome: "quiet",
      reasonCode,
      contactText: null,
      effectIntent: null,
    });
  }

  private baseDecision(
    input: ProactivityWakeGateInput,
    body: Pick<
      ProactivityWakeDecision,
      "outcome" | "reasonCode" | "contactText" | "effectIntent"
    >,
  ): ProactivityWakeDecision {
    const decisionId = this.createDecisionId().trim();
    if (!decisionId) {
      throw new Error(
        "Proactivity decision id must not be blank.",
      );
    }

    return {
      decisionId,
      wakeId: input.wakeId.trim(),
      userId: input.userId.trim(),
      subjectId: input.subjectId.trim(),
      offeredAt: requireProactivityIso(
        input.offeredAt,
        "offeredAt",
      ),
      decidedAt: requireProactivityIso(
        this.now(),
        "decidedAt",
      ),
      ...body,
    };
  }
}
