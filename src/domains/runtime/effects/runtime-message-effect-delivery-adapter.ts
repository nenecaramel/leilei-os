import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { createDatabase } from "../../../database/client.js";
import {
  conversationContentBlocks,
  conversationMessages,
  conversationProviderSessionCheckpoints,
  conversations,
  nativeLiveTurnPreparations,
  runtimeEffectMessageDeliveries,
  runtimeProactivityWakes,
} from "../../../database/schema.js";
import {
  hashProactivityMessagePayload,
} from "../proactivity/proactivity-wake-contract.js";
import type {
  RuntimeEffectRecord,
} from "./runtime-effect-repository.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type RuntimeMessageEffectDeliveryResult =
  | {
      outcome: "observed";
      messageId: string;
    }
  | {
      outcome: "failed";
      failureCode:
        | "TARGET_INVALID"
        | "TARGET_UNAVAILABLE"
        | "TARGET_HEAD_CHANGED"
        | "TARGET_CHECKPOINT_MISSING"
        | "PAYLOAD_INVALID";
      retryable: false;
    }
  | {
      outcome: "failed";
      failureCode: "TARGET_BUSY";
      retryable: true;
    };

export type RuntimeMessageEffectReconciliationResult =
  | {
      outcome: "observed";
      messageId: string;
    }
  | {
      outcome: "failed";
      failureCode: "CANONICAL_DELIVERY_NOT_COMMITTED";
      retryable: true;
    };

export class RuntimeMessageEffectDeliveryAdapter {
  constructor(private readonly db: Database) {}

  async deliver(input: {
    effect: RuntimeEffectRecord;
    workerInstanceId: string;
  }): Promise<RuntimeMessageEffectDeliveryResult> {
    const conversationId = parseConversationTarget(
      input.effect.target,
    );
    if (!conversationId) {
      return {
        outcome: "failed",
        failureCode: "TARGET_INVALID",
        retryable: false,
      };
    }
    const text = parseMessageText(input.effect.payload);
    if (!text) {
      return {
        outcome: "failed",
        failureCode: "PAYLOAD_INVALID",
        retryable: false,
      };
    }

    return this.db.transaction(async (transaction) => {
      const lockedEffects = await transaction.execute<{
        id: string;
        status: string;
        reserved_by: string | null;
        effect_type: string;
        target: string;
        payload: Record<string, unknown>;
        payload_hash: string;
        source_wake_id: string;
      }>(sql`
        SELECT
          id,
          status,
          reserved_by,
          effect_type,
          target,
          payload,
          payload_hash,
          source_wake_id
        FROM runtime_effects
        WHERE id = ${input.effect.effectId}::uuid
          AND user_id = ${input.effect.userId}::uuid
        FOR UPDATE
      `);
      const lockedEffect = lockedEffects[0];
      if (
        !lockedEffect
        || lockedEffect.status !== "dispatching"
        || lockedEffect.reserved_by !== input.workerInstanceId
      ) {
        throw new Error(
          "Runtime message effect is not owned by this active dispatcher.",
        );
      }
      const durableConversationId =
        parseConversationTarget(lockedEffect.target);
      const durableText =
        parseMessageText(lockedEffect.payload);
      if (
        lockedEffect.effect_type !== "message_send"
        || !durableConversationId
        || !durableText
        || lockedEffect.payload_hash !==
          hashProactivityMessagePayload(durableText)
      ) {
        return {
          outcome: "failed" as const,
          failureCode: "PAYLOAD_INVALID" as const,
          retryable: false as const,
        };
      }
      if (
        durableConversationId !== conversationId
        || durableText !== text
      ) {
        return {
          outcome: "failed" as const,
          failureCode: "PAYLOAD_INVALID" as const,
          retryable: false as const,
        };
      }

      const existing = await transaction
        .select({
          messageId:
            runtimeEffectMessageDeliveries.messageId,
        })
        .from(runtimeEffectMessageDeliveries)
        .where(
          and(
            eq(
              runtimeEffectMessageDeliveries.effectId,
              input.effect.effectId,
            ),
            eq(
              runtimeEffectMessageDeliveries.userId,
              input.effect.userId,
            ),
          ),
        )
        .limit(1);
      if (existing[0]) {
        return {
          outcome: "observed" as const,
          messageId: existing[0].messageId,
        };
      }

      const wakes = await transaction
        .select({
          contextSnapshot:
            runtimeProactivityWakes.contextSnapshot,
        })
        .from(runtimeProactivityWakes)
        .where(
          and(
            eq(
              runtimeProactivityWakes.id,
              lockedEffect.source_wake_id,
            ),
            eq(
              runtimeProactivityWakes.userId,
              input.effect.userId,
            ),
            eq(runtimeProactivityWakes.status, "decided"),
          ),
        )
        .limit(1);
      const expectedHead = parseSourceHead(
        wakes[0]?.contextSnapshot ?? null,
      );
      if (!expectedHead) {
        return {
          outcome: "failed" as const,
          failureCode: "TARGET_INVALID" as const,
          retryable: false as const,
        };
      }

      const activeForeground = await transaction
        .select({ id: nativeLiveTurnPreparations.id })
        .from(nativeLiveTurnPreparations)
        .where(
          and(
            eq(
              nativeLiveTurnPreparations.userId,
              input.effect.userId,
            ),
            sql`${nativeLiveTurnPreparations.dispatchStatus}
              IN (
                'staged',
                'pending',
                'reserved',
                'executing',
                'delivery_unknown'
              )`,
          ),
        )
        .limit(1);
      if (activeForeground.length > 0) {
        return {
          outcome: "failed" as const,
          failureCode: "TARGET_BUSY" as const,
          retryable: true as const,
        };
      }

      const targetRows = await transaction.execute<{
        id: string;
        lifecycle_status: string;
        current_head_message_id: string | null;
      }>(sql`
        SELECT id, lifecycle_status, current_head_message_id
        FROM conversations
        WHERE id = ${conversationId}::uuid
          AND user_id = ${input.effect.userId}::uuid
          AND origin = 'native_live'
        FOR UPDATE
      `);
      const target = targetRows[0];
      if (!target) {
        return {
          outcome: "failed" as const,
          failureCode: "TARGET_UNAVAILABLE" as const,
          retryable: false as const,
        };
      }
      if (target.lifecycle_status !== "active") {
        return {
          outcome: "failed" as const,
          failureCode: "TARGET_BUSY" as const,
          retryable: true as const,
        };
      }
      if (
        target.current_head_message_id !== expectedHead
      ) {
        return {
          outcome: "failed" as const,
          failureCode: "TARGET_HEAD_CHANGED" as const,
          retryable: false as const,
        };
      }

      const parentRows = await transaction
        .select({
          id: conversationMessages.id,
          role: conversationMessages.role,
          status: conversationMessages.status,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.id, expectedHead),
            eq(
              conversationMessages.conversationId,
              conversationId,
            ),
            eq(
              conversationMessages.userId,
              input.effect.userId,
            ),
          ),
        )
        .limit(1);
      const parent = parentRows[0];
      if (
        !parent
        || parent.role !== "assistant"
        || parent.status !== "completed"
      ) {
        return {
          outcome: "failed" as const,
          failureCode: "TARGET_HEAD_CHANGED" as const,
          retryable: false as const,
        };
      }

      const checkpoints = await transaction
        .select({
          providerSessionId:
            conversationProviderSessionCheckpoints.providerSessionId,
          providerCheckpointId:
            conversationProviderSessionCheckpoints.providerCheckpointId,
        })
        .from(conversationProviderSessionCheckpoints)
        .where(
          and(
            eq(
              conversationProviderSessionCheckpoints.userId,
              input.effect.userId,
            ),
            eq(
              conversationProviderSessionCheckpoints.conversationId,
              conversationId,
            ),
            eq(
              conversationProviderSessionCheckpoints.canonicalMessageId,
              expectedHead,
            ),
            eq(
              conversationProviderSessionCheckpoints.provider,
              "claude_code",
            ),
          ),
        )
        .limit(1);
      const parentCheckpoint = checkpoints[0];
      if (!parentCheckpoint) {
        return {
          outcome: "failed" as const,
          failureCode: "TARGET_CHECKPOINT_MISSING" as const,
          retryable: false as const,
        };
      }

      const messageId = messageIdForEffect(
        input.effect.effectId,
      );
      const now = new Date();
      await transaction
        .insert(conversationMessages)
        .values({
          id: messageId,
          userId: input.effect.userId,
          conversationId,
          parentMessageId: expectedHead,
          role: "assistant",
          rawRole: "assistant",
          status: "completed",
          displayText: text,
          completedAt: now,
          sourceNodeId: null,
          sourceFingerprint: null,
          firstSeenImportId: null,
          lastSeenImportId: null,
        })
;

      await transaction
        .insert(conversationContentBlocks)
        .values({
          userId: input.effect.userId,
          messageId,
          ordinal: 0,
          kind: "text",
          rawType: "runtime_proactivity",
          text,
          payload: {
            runtime_effect_id: input.effect.effectId,
            origin: "proactivity",
          },
        })
;

      // A proactive assistant message is canonical but not a new
      // Claude execution. Bind it to the exact parent provider session so
      // the next user turn can fork the same runtime anchor while Context
      // Assembly supplies the proactive message from canonical Surface.
      await transaction
        .insert(conversationProviderSessionCheckpoints)
        .values({
          userId: input.effect.userId,
          conversationId,
          canonicalMessageId: messageId,
          provider: "claude_code",
          providerSessionId:
            parentCheckpoint.providerSessionId,
          providerCheckpointId:
            parentCheckpoint.providerCheckpointId,
        })
;

      const moved = await transaction
        .update(conversations)
        .set({
          currentHeadMessageId: messageId,
          updatedAt: now,
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, input.effect.userId),
            eq(
              conversations.currentHeadMessageId,
              expectedHead,
            ),
            eq(conversations.origin, "native_live"),
            eq(conversations.lifecycleStatus, "active"),
          ),
        )
        .returning({ id: conversations.id });
      if (moved.length !== 1) {
        throw new Error(
          "Runtime message effect lost its canonical head lock.",
        );
      }

      await transaction
        .insert(runtimeEffectMessageDeliveries)
        .values({
          effectId: input.effect.effectId,
          userId: input.effect.userId,
          conversationId,
          messageId,
        })
;

      return {
        outcome: "observed" as const,
        messageId,
      };
    }, { isolationLevel: "serializable" });
  }

  async reconcile(input: {
    effect: RuntimeEffectRecord;
  }): Promise<RuntimeMessageEffectReconciliationResult> {
    const rows = await this.db
      .select({
        messageId: runtimeEffectMessageDeliveries.messageId,
      })
      .from(runtimeEffectMessageDeliveries)
      .where(
        and(
          eq(
            runtimeEffectMessageDeliveries.effectId,
            input.effect.effectId,
          ),
          eq(
            runtimeEffectMessageDeliveries.userId,
            input.effect.userId,
          ),
        ),
      )
      .limit(1);
    if (rows[0]) {
      return {
        outcome: "observed",
        messageId: rows[0].messageId,
      };
    }
    return {
      outcome: "failed",
      failureCode:
        "CANONICAL_DELIVERY_NOT_COMMITTED",
      retryable: true,
    };
  }
}

function parseConversationTarget(
  target: string,
): string | null {
  const match = target.match(
    /^conversation:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu,
  );
  return match?.[1] ?? null;
}

function parseMessageText(
  payload: Record<string, unknown>,
): string | null {
  const raw = payload.text;
  if (typeof raw !== "string") return null;
  const text = raw.normalize("NFC").trim();
  if (!text || [...text].length > 8_000) return null;
  return text;
}

function parseSourceHead(
  context: Record<string, unknown> | null,
): string | null {
  if (!context) return null;
  const value = context.sourceHeadMessageId;
  if (
    typeof value !== "string"
    || !isUuid(value)
  ) {
    return null;
  }
  return value;
}

function messageIdForEffect(effectId: string): string {
  const digest = createHash("sha256")
    .update(
      "leileios:runtime-effect-message:v1:" + effectId,
      "utf8",
    )
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
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


function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(value);
}
