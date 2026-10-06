import { and, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationProviderSessionCheckpoints,
  conversations,
} from "../../database/schema.js";
import type {
  NativeLiveRuntimeMetadata,
} from "../bridge/protocol/native-live-runtime-protocol.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type NativeLiveConversationRuntimeMetadataSnapshot = {
  conversationId: string;
  currentHeadMessageId: string | null;
  sourceMessageId: string | null;
  effectiveWorkingDirectory: string | null;
  runtimeMetadata: NativeLiveRuntimeMetadata | null;
  observedAt: string | null;
};

export interface NativeLiveConversationRuntimeMetadataReader {
  readLatest(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversationRuntimeMetadataSnapshot | null>;
}

export class DrizzleNativeLiveConversationRuntimeMetadataReader
implements NativeLiveConversationRuntimeMetadataReader {
  constructor(private readonly db: Database) {}

  async readLatest(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversationRuntimeMetadataSnapshot | null> {
    const [conversation] = await this.db
      .select({
        id: conversations.id,
        currentHeadMessageId: conversations.currentHeadMessageId,
      })
      .from(conversations)
      .where(and(
        eq(conversations.id, input.conversationId),
        eq(conversations.userId, input.userId),
        eq(conversations.origin, "native_live"),
        inArray(conversations.lifecycleStatus, ["active", "archived"]),
      ))
      .limit(1);

    if (!conversation) return null;
    if (!conversation.currentHeadMessageId) {
      const bootstrapRows = await this.db.execute<{
        effective_working_directory: string;
        created_at: string;
      }>(sql`
        SELECT
          effective_working_directory,
          created_at::text
        FROM native_live_conversation_provider_bootstraps
        WHERE user_id = ${input.userId}::uuid
          AND conversation_id = ${input.conversationId}::uuid
          AND provider = 'claude_code'
          AND consumed_at IS NULL
        LIMIT 1
      `);
      const bootstrap = bootstrapRows[0];
      return {
        conversationId: conversation.id,
        currentHeadMessageId: null,
        sourceMessageId: null,
        effectiveWorkingDirectory:
          bootstrap?.effective_working_directory ?? null,
        runtimeMetadata: null,
        observedAt: bootstrap
          ? new Date(bootstrap.created_at).toISOString()
          : null,
      };
    }

    const rows = await this.db.execute<{
      source_message_id: string;
      effective_working_directory: string | null;
      runtime_metadata: Record<string, unknown> | null;
      observed_at: string;
    }>(sql`
      WITH RECURSIVE current_path AS (
        SELECT
          message.id,
          message.parent_message_id,
          0 AS depth
        FROM conversation_messages AS message
        WHERE message.id =
            ${conversation.currentHeadMessageId}::uuid
          AND message.user_id = ${input.userId}::uuid
          AND message.conversation_id =
            ${input.conversationId}::uuid

        UNION ALL

        SELECT
          parent.id,
          parent.parent_message_id,
          path.depth + 1
        FROM conversation_messages AS parent
        JOIN current_path AS path
          ON parent.id = path.parent_message_id
        WHERE parent.user_id = ${input.userId}::uuid
          AND parent.conversation_id =
            ${input.conversationId}::uuid
      )
      SELECT
        checkpoint.canonical_message_id AS source_message_id,
        checkpoint.effective_working_directory,
        checkpoint.runtime_metadata,
        checkpoint.created_at::text AS observed_at
      FROM current_path AS path
      INNER JOIN conversation_provider_session_checkpoints AS checkpoint
        ON checkpoint.canonical_message_id = path.id
       AND checkpoint.user_id = ${input.userId}::uuid
       AND checkpoint.conversation_id =
         ${input.conversationId}::uuid
       AND checkpoint.provider = 'claude_code'
      ORDER BY path.depth ASC
      LIMIT 1
    `);

    const latest = rows[0];
    if (!latest) {
      return {
        conversationId: conversation.id,
        currentHeadMessageId: conversation.currentHeadMessageId,
        sourceMessageId: null,
        effectiveWorkingDirectory: null,
        runtimeMetadata: null,
        observedAt: null,
      };
    }

    return {
      conversationId: conversation.id,
      currentHeadMessageId: conversation.currentHeadMessageId,
      sourceMessageId: latest.source_message_id,
      effectiveWorkingDirectory: latest.effective_working_directory,
      runtimeMetadata:
        latest.runtime_metadata as NativeLiveRuntimeMetadata | null,
      observedAt: new Date(latest.observed_at).toISOString(),
    };
  }
}
