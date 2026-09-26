import { randomUUID } from "node:crypto";
import {
  evaluateProactivityWakeGate,
  hashProactivityMessagePayload,
  normalizeProactivityDeliberationDraft,
  proactivityGateReasonCode,
  requireProactivityIso,
  type ProactivityDeliberationDraft,
  type ProactivityWakeBlockReason,
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

export class ProactivityWakeDecisionBuilder {
  constructor(
    private readonly now: () => string = () =>
      new Date().toISOString(),
    private readonly createDecisionId: () => string = randomUUID,
  ) {}

  blocked(
    gate: ProactivityWakeGateInput,
    reason: ProactivityWakeBlockReason,
  ): ProactivityWakeDecision {
    return this.quiet(
      gate,
      proactivityGateReasonCode(reason),
    );
  }

  failure(
    gate: ProactivityWakeGateInput,
    reason:
      | "deliberation_failed"
      | "invalid_deliberation_output",
  ): ProactivityWakeDecision {
    return this.quiet(gate, reason);
  }

  fromDraft(input: {
    gate: ProactivityWakeGateInput;
    contactTarget: string | null;
    draft: ProactivityDeliberationDraft;
  }): ProactivityWakeDecision {
    const draft = normalizeProactivityDeliberationDraft(input.draft);

    if (draft.outcome === "quiet") {
      return this.quiet(input.gate, "model_quiet");
    }
    if (draft.outcome === "reflect") {
      return this.base(input.gate, {
        outcome: "reflect",
        reasonCode: "model_reflect",
        contactText: null,
        effectIntent: null,
      });
    }

    const target = input.contactTarget?.trim() ?? "";
    if (!target) {
      return this.quiet(
        input.gate,
        "contact_target_unavailable",
      );
    }

    return this.base(input.gate, {
      outcome: "contact_candidate",
      reasonCode: "model_contact_candidate",
      contactText: draft.text,
      effectIntent: {
        effectType: "message_send",
        target,
        payloadHash:
          hashProactivityMessagePayload(draft.text),
      },
    });
  }

  private quiet(
    gate: ProactivityWakeGateInput,
    reasonCode: ProactivityWakeDecision["reasonCode"],
  ): ProactivityWakeDecision {
    return this.base(gate, {
      outcome: "quiet",
      reasonCode,
      contactText: null,
      effectIntent: null,
    });
  }

  private base(
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

/**
 * Synchronous-model adapter kept for local/unit use.
 *
 * Production Proactivity deliberation must use the durable cross-device
 * coordinator instead, so Railway owns wake/decision state while Mac only
 * performs the pure model transform.
 */
export class ProactivityWakeService {
  private readonly decisions: ProactivityWakeDecisionBuilder;

  constructor(
    private readonly deliberator: ProactivityWakeDeliberator,
    now: () => string = () => new Date().toISOString(),
    createDecisionId: () => string = randomUUID,
  ) {
    this.decisions =
      new ProactivityWakeDecisionBuilder(now, createDecisionId);
  }

  async run(input: {
    gate: ProactivityWakeGateInput;
    contactTarget: string | null;
  }): Promise<ProactivityWakeDecision> {
    const gate = evaluateProactivityWakeGate(input.gate);
    if (gate.outcome === "blocked") {
      return this.decisions.blocked(
        input.gate,
        gate.reason,
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
      return this.decisions.failure(
        input.gate,
        "deliberation_failed",
      );
    }

    try {
      return this.decisions.fromDraft({
        gate: input.gate,
        contactTarget: input.contactTarget,
        draft: rawDraft,
      });
    } catch {
      return this.decisions.failure(
        input.gate,
        "invalid_deliberation_output",
      );
    }
  }
}
