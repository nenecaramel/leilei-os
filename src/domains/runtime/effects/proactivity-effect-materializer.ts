import { createHash } from "node:crypto";
import {
  assertProactivityEffectBinding,
  hashProactivityMessagePayload,
} from "../proactivity/proactivity-wake-contract.js";
import type {
  ProactivityWakeRecord,
} from "../proactivity/proactivity-wake-state.js";
import type {
  RuntimeEffectPort,
  RuntimeEffectRecord,
} from "./runtime-effect-repository.js";

export class ProactivityEffectMaterializer {
  constructor(
    private readonly effects: Pick<
      RuntimeEffectPort,
      "createOrGet"
    >,
    private readonly now: () => string = () =>
      new Date().toISOString(),
  ) {}

  async materialize(
    wake: ProactivityWakeRecord,
  ): Promise<RuntimeEffectRecord | null> {
    if (
      wake.status !== "decided"
      || wake.decision === null
    ) {
      throw new Error(
        "Only a decided proactivity wake may materialize an effect.",
      );
    }
    if (
      wake.decision.outcome !== "contact_candidate"
      || wake.decision.effectIntent === null
    ) {
      return null;
    }
    if (wake.gate.mode !== "live") {
      throw new Error(
        "Replay proactivity wake is effect-silent.",
      );
    }
    if (
      wake.decision.wakeId !== wake.id
      || wake.decision.userId !== wake.userId
      || wake.decision.subjectId !== wake.subjectId
      || wake.decision.offeredAt !== wake.gate.offeredAt
    ) {
      throw new Error(
        "Proactivity decision identity does not match durable wake.",
      );
    }
    const intent = wake.decision.effectIntent;
    if (
      intent.effectType !== "message_send"
      || typeof intent.target !== "string"
      || !intent.target.trim()
      || typeof intent.payloadHash !== "string"
      || !/^[0-9a-f]{64}$/u.test(intent.payloadHash)
    ) {
      throw new Error(
        "Proactivity effect intent is invalid.",
      );
    }
    if (
      wake.contactTarget === null
      || wake.contactTarget !== intent.target
    ) {
      throw new Error(
        "Proactivity effect target does not match backend-owned wake target.",
      );
    }

    const text = wake.decision.contactText;
    const normalizedText =
      typeof text === "string"
        ? text.normalize("NFC").trim()
        : "";
    if (
      !normalizedText
      || [...normalizedText].length > 8_000
    ) {
      throw new Error(
        "Proactivity contact candidate message text is invalid.",
      );
    }
    const payload = {
      text: normalizedText,
    };
    const payloadHash =
      hashProactivityMessagePayload(payload.text);
    if (
      payloadHash !==
      intent.payloadHash
    ) {
      throw new Error(
        "Proactivity effect payload hash does not match decision intent.",
      );
    }

    const idempotencyKey = createHash("sha256")
      .update(
        JSON.stringify({
          namespace: "leileios:proactivity-effect:v1",
          wake_id: wake.id,
          decision_id: wake.decision.decisionId,
          effect_type: intent.effectType,
          target: intent.target,
          payload_hash: payloadHash,
        }),
        "utf8",
      )
      .digest("hex");
    const effectId = uuidFromHash(idempotencyKey);
    const timestamp = normalizeIso(this.now());
    const effect = {
      effectId,
      userId: wake.userId,
      subjectId: wake.subjectId,
      decisionId: wake.decision.decisionId,
      idempotencyKey,
      effectType: intent.effectType,
      target: intent.target,
      payloadHash,
      status: "pending" as const,
      attempt: 0,
      retryable: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      observedAt: null,
      failureCode: null,
    };

    assertProactivityEffectBinding({
      decision: wake.decision,
      effect,
    });

    return this.effects.createOrGet({
      effect,
      sourceWakeId: wake.id,
      payload,
    });
  }
}

function uuidFromHash(hash: string): string {
  const bytes = Buffer.from(hash.slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Runtime effect timestamp must be an ISO timestamp.",
    );
  }
  return new Date(parsed).toISOString();
}
