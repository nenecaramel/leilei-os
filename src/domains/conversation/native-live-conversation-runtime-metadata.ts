import { and, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationProviderSessionCheckpoints,
  conversations,
} from "../../database/schema.js";
import type {
  NativeLiveRuntimeMetadata,
} from "../bridge/native-live-runtime-protocol.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type NativeLiveConversationRuntimeMetadataSnapshot = {
  conversationId: string;
  currentHeadMessageId: string | null;
  sourceMessageId: string | null;
  workspaceId: string | null;
  effectiveWorkspaceRoot: string | null;
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
      return {
        conversationId: conversation.id,
        currentHeadMessageId: null,
        sourceMessageId: null,
        workspaceId: null,
        effectiveWorkspaceRoot: null,
        runtimeMetadata: null,
        observedAt: null,
      };
    }

    const rows = await this.db.execute<{
      source_message_id: string;
      workspace_id: string | null;
      effective_workspace_root: string | null;
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
        checkpoint.workspace_id,
        checkpoint.effective_workspace_root,
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
        workspaceId: null,
        effectiveWorkspaceRoot: null,
        runtimeMetadata: null,
        observedAt: null,
      };
    }

    return {
      conversationId: conversation.id,
      currentHeadMessageId: conversation.currentHeadMessageId,
      sourceMessageId: latest.source_message_id,
      workspaceId: latest.workspace_id,
      effectiveWorkspaceRoot: latest.effective_workspace_root,
      runtimeMetadata:
        latest.runtime_metadata as NativeLiveRuntimeMetadata | null,
      observedAt: new Date(latest.observed_at).toISOString(),
    };
  }
}
