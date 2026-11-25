import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "./native-live-conversation-db.js";
import type { NativeLiveConversationArchiveResult, NativeLiveConversationRestoreResult, NativeLiveConversationDeleteResult } from "./native-live-conversation-repository.js";
import { conversations, nativeLiveTurnPreparations, runtimeDistillationWatermarks } from "../../database/schema.js";
import { providerSessionUnreferenced } from "../bridge/provider-session/native-live-provider-session-references.js";

// Each operation owns its original serializable transaction, including all locks and cleanup.
export async function archiveConversation(db: DbExecutor, input: {
  userId: string;
  conversationId: string;
}): Promise<NativeLiveConversationArchiveResult> {
  return db.transaction(
    async (transaction) => {
      const [conversation] = await transaction
        .select({
          id: conversations.id,
          lifecycleStatus: conversations.lifecycleStatus,
          archivedAt: conversations.archivedAt,
        })
        .from(conversations)
        .where(and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, input.conversationId),
          eq(conversations.origin, "native_live"),
        ))
        .for("update")
        .limit(1);

      if (!conversation) return { outcome: "not_found" as const };
      if (conversation.lifecycleStatus === "archived") {
        if (!conversation.archivedAt) {
          throw new Error(
            "Archived native live conversation is missing archived_at.",
          );
        }
        return {
          outcome: "already_archived" as const,
          archivedAt: conversation.archivedAt.toISOString(),
        };
      }
      if (conversation.lifecycleStatus !== "active") {
        return { outcome: "not_found" as const };
      }

      const activeTurns = await transaction
        .select({ id: nativeLiveTurnPreparations.id })
        .from(nativeLiveTurnPreparations)
        .where(inFlightConversationTurns(input))
        .limit(1);
      if (activeTurns.length > 0) return { outcome: "busy" as const };

      const archivedAt = new Date();
      const updated = await transaction
        .update(conversations)
        .set({
          lifecycleStatus: "archived",
          archivedAt,
          deletedAt: null,
          updatedAt: archivedAt,
        })
        .where(and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, input.conversationId),
          eq(conversations.origin, "native_live"),
          eq(conversations.lifecycleStatus, "active"),
        ))
        .returning({ id: conversations.id });
      if (updated.length !== 1) {
        throw new Error(
          "Native live conversation archive lost its lifecycle lock.",
        );
      }
      return {
        outcome: "archived" as const,
        archivedAt: archivedAt.toISOString(),
      };
    },
    { isolationLevel: "serializable" },
  );
}

export async function restoreConversation(db: DbExecutor, input: {
  userId: string;
  conversationId: string;
}): Promise<NativeLiveConversationRestoreResult> {
  return db.transaction(
    async (transaction) => {
      const [conversation] = await transaction
        .select({
          id: conversations.id,
          lifecycleStatus: conversations.lifecycleStatus,
        })
        .from(conversations)
        .where(and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, input.conversationId),
          eq(conversations.origin, "native_live"),
        ))
        .for("update")
        .limit(1);

      if (!conversation) return { outcome: "not_found" as const };
      if (conversation.lifecycleStatus === "active") {
        return { outcome: "already_active" as const };
      }
      if (conversation.lifecycleStatus !== "archived") {
        return { outcome: "not_found" as const };
      }

      const updatedAt = new Date();
      const updated = await transaction
        .update(conversations)
        .set({
          lifecycleStatus: "active",
          archivedAt: null,
          deletedAt: null,
          updatedAt,
        })
        .where(and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, input.conversationId),
          eq(conversations.origin, "native_live"),
          eq(conversations.lifecycleStatus, "archived"),
        ))
        .returning({ id: conversations.id });
      if (updated.length !== 1) {
        throw new Error(
          "Native live conversation restore lost its lifecycle lock.",
        );
      }
      return { outcome: "restored" as const };
    },
    { isolationLevel: "serializable" },
  );
}

export async function deleteConversation(db: DbExecutor, input: {
  userId: string;
  conversationId: string;
}): Promise<NativeLiveConversationDeleteResult> {
  return db.transaction(
    async (transaction) => {
      const [conversation] = await transaction
        .select({
          id: conversations.id,
          lifecycleStatus: conversations.lifecycleStatus,
        })
        .from(conversations)
        .where(and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, input.conversationId),
          eq(conversations.origin, "native_live"),
        ))
        .for("update")
        .limit(1);
      if (!conversation) return { outcome: "not_found" as const };

      const activeTurns = await transaction
        .select({ id: nativeLiveTurnPreparations.id })
        .from(nativeLiveTurnPreparations)
        .where(inFlightConversationTurns(input))
        .limit(1);
      if (activeTurns.length > 0) return { outcome: "busy" as const };

      await transaction.execute(sql`
        INSERT INTO native_live_provider_session_cleanups (
          user_id, provider, provider_session_id
        )
        SELECT DISTINCT
          checkpoint.user_id,
          checkpoint.provider,
          checkpoint.provider_session_id
        FROM conversation_provider_session_checkpoints AS checkpoint
        WHERE checkpoint.user_id = ${input.userId}::uuid
          AND checkpoint.conversation_id = ${input.conversationId}::uuid
          AND ${providerSessionUnreferenced({
            userId: input.userId, providerSessionId: sql`checkpoint.provider_session_id`,
            excludeConversationId: input.conversationId,
          })}
        ON CONFLICT (user_id, provider, provider_session_id)
        DO NOTHING
      `);

      await transaction
        .delete(runtimeDistillationWatermarks)
        .where(and(
          eq(runtimeDistillationWatermarks.userId, input.userId),
          eq(
            runtimeDistillationWatermarks.conversationId,
            input.conversationId,
          ),
        ));

      const deleted = await transaction
        .delete(conversations)
        .where(and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, input.conversationId),
          eq(conversations.origin, "native_live"),
        ))
        .returning({ id: conversations.id });
      if (deleted.length !== 1) {
        throw new Error(
          "Native live conversation delete lost its lifecycle lock.",
        );
      }
      return { outcome: "deleted" as const };
    },
    { isolationLevel: "serializable" },
  );
}

/** Archive and true Delete must protect exactly the same recovery evidence. */
export function inFlightConversationTurns(input: { userId: string; conversationId: string }) {
return and(
  eq(nativeLiveTurnPreparations.userId, input.userId),
  eq(nativeLiveTurnPreparations.conversationId, input.conversationId),
  inArray(nativeLiveTurnPreparations.dispatchStatus, [
    "staged", "pending", "reserved", "executing", "delivery_unknown",
  ]),
);
}
