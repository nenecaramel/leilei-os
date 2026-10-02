import { randomUUID } from "node:crypto";
import {
  hashProactivityMessagePayload,
  normalizeProactivityDeliberationDraft,
  proactivityGateReasonCode,
  requireProactivityIso,
  type ProactivityDeliberationDraft,
  type ProactivityWakeBlockReason,
  type ProactivityWakeDecision,
  type ProactivityWakeGateInput,
} from "./proactivity-wake-contract.js";

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
