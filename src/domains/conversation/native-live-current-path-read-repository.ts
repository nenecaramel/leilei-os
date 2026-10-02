import {
  and,
  asc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationContentBlocks,
  conversationMessages,
  conversations,
} from "../../database/schema.js";
import type {
  NativeLiveMessage,
} from "./native-live-conversation-types.js";
import {
  readNativeLiveMessageActivityByAssistantMessage,
} from "./native-live-message-activity-read-repository.js";

type Database = ReturnType<typeof createDatabase>["db"];

export const DEFAULT_NATIVE_LIVE_CURRENT_PATH_LIMIT = 100;
export const MAX_NATIVE_LIVE_CURRENT_PATH_LIMIT = 200;

export type NativeLiveCurrentPathSnapshot = {
  conversationId: string;
  title: string | null;
  currentHeadMessageId: string | null;
  updatedAt: string;
  syncToken: string;
  truncated: boolean;
  olderCursor: string | null;
  resetRequired: boolean;
  messages: NativeLiveMessage[];
};

type CurrentPathIdRow = {
  id: string;
  depth: number;
};

export interface NativeLiveCurrentPathReader {
  readCurrentPath(input: {
    userId: string;
    conversationId: string;
    limit: number;
    beforeMessageId?: string | null;
    afterMessageId?: string | null;
  }): Promise<NativeLiveCurrentPathSnapshot | null>;
}

export class DrizzleNativeLiveCurrentPathReader
implements NativeLiveCurrentPathReader {
  constructor(private readonly db: Database) {}

  async readCurrentPath(input: {
    userId: string;
    conversationId: string;
    limit: number;
    beforeMessageId?: string | null;
    afterMessageId?: string | null;
  }): Promise<NativeLiveCurrentPathSnapshot | null> {
    const limit = normalizeCurrentPathLimit(input.limit);
    if (input.beforeMessageId && input.afterMessageId) {
      throw new RangeError(
        "Native live current path accepts either beforeMessageId or afterMessageId, not both.",
      );
    }
    const [conversation] = await this.db
      .select({
        id: conversations.id,
        title: conversations.title,
        currentHeadMessageId:
          conversations.currentHeadMessageId,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.userId, input.userId),
          eq(conversations.origin, "native_live"),
          eq(conversations.lifecycleStatus, "active"),
        ),
      )
      .limit(1);

    if (!conversation) return null;

    const headMessageId =
      conversation.currentHeadMessageId;
    if (!headMessageId) {
      return {
        conversationId: conversation.id,
        title: conversation.title,
        currentHeadMessageId: null,
        updatedAt: conversation.updatedAt.toISOString(),
        syncToken: emptySyncToken(conversation.id),
        truncated: false,
        olderCursor: null,
        resetRequired: false,
        messages: [],
      };
    }

    let startMessageId = headMessageId;
    if (input.beforeMessageId) {
      const membership =
        await this.db.execute<{ id: string }>(sql`
          WITH RECURSIVE current_path AS (
            SELECT
              message.id,
              message.parent_message_id
            FROM conversation_messages AS message
            WHERE message.id = ${headMessageId}::uuid
              AND message.user_id = ${input.userId}::uuid
              AND message.conversation_id =
                ${input.conversationId}::uuid

            UNION ALL

            SELECT
              parent.id,
              parent.parent_message_id
            FROM conversation_messages AS parent
            JOIN current_path AS path
              ON parent.id = path.parent_message_id
            WHERE parent.user_id = ${input.userId}::uuid
              AND parent.conversation_id =
                ${input.conversationId}::uuid
              AND path.id <> ${input.beforeMessageId}::uuid
          )
          SELECT id
          FROM current_path
          WHERE id = ${input.beforeMessageId}::uuid
          LIMIT 1
        `);
      if (membership.length === 0) {
        return this.readCurrentPath({
          userId: input.userId,
          conversationId: input.conversationId,
          limit,
        }).then((latest) =>
          latest
            ? { ...latest, resetRequired: true }
            : null
        );
      }

      const [cursor] = await this.db
        .select({
          parentMessageId: conversationMessages.parentMessageId,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.userId, input.userId),
            eq(
              conversationMessages.conversationId,
              input.conversationId,
            ),
            eq(conversationMessages.id, input.beforeMessageId),
          ),
        )
        .limit(1);
      if (!cursor) {
        throw new RangeError(
          "Native live current path beforeMessageId is invalid.",
        );
      }
      if (!cursor.parentMessageId) {
        return {
          conversationId: conversation.id,
          title: conversation.title,
          currentHeadMessageId: headMessageId,
          updatedAt: conversation.updatedAt.toISOString(),
          syncToken: headSyncToken(headMessageId),
          truncated: false,
          olderCursor: null,
          resetRequired: false,
          messages: [],
        };
      }
      startMessageId = cursor.parentMessageId;
    }

    const pathRows =
      await this.db.execute<CurrentPathIdRow>(sql`
        WITH RECURSIVE current_path AS (
          SELECT
            message.id,
            message.parent_message_id,
            0 AS depth
          FROM conversation_messages AS message
          WHERE message.id = ${startMessageId}::uuid
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
            AND path.depth < ${limit}
        )
        SELECT id, depth
        FROM current_path
        ORDER BY depth DESC
      `);

    if (
      pathRows.length === 0
      || pathRows[pathRows.length - 1]?.id !== startMessageId
    ) {
      throw new Error(
        "Native live current path anchor is not readable.",
      );
    }

    let truncated = false;
    let resetRequired = false;
    let boundedPathRows: CurrentPathIdRow[];

    if (input.afterMessageId) {
      if (input.afterMessageId === headMessageId) {
        boundedPathRows = [];
      } else {
        const afterIndex =
          pathRows.findIndex((row) => row.id === input.afterMessageId);
        if (afterIndex >= 0) {
          boundedPathRows = pathRows.slice(afterIndex + 1);
        } else {
          resetRequired = true;
          truncated = pathRows.length > limit;
          boundedPathRows = truncated
            ? pathRows.slice(pathRows.length - limit)
            : pathRows;
        }
      }
    } else {
      truncated = pathRows.length > limit;
      boundedPathRows = truncated
        ? pathRows.slice(pathRows.length - limit)
        : pathRows;
    }

    const olderCursor =
      (input.afterMessageId && !resetRequired)
        ? null
        : truncated
          ? boundedPathRows[0]?.id ?? null
          : null;
    const messageIds =
      boundedPathRows.map((row) => row.id);

    if (messageIds.length === 0) {
      return {
        conversationId: conversation.id,
        title: conversation.title,
        currentHeadMessageId: headMessageId,
        updatedAt: conversation.updatedAt.toISOString(),
        syncToken: headSyncToken(headMessageId),
        truncated,
        olderCursor,
        resetRequired,
        messages: [],
      };
    }

    const messageRows = await this.db
      .select({
        id: conversationMessages.id,
        conversationId:
          conversationMessages.conversationId,
        parentMessageId:
          conversationMessages.parentMessageId,
        role: conversationMessages.role,
        status: conversationMessages.status,
        createdAt: conversationMessages.createdAt,
        completedAt: conversationMessages.completedAt,
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.userId, input.userId),
          eq(
            conversationMessages.conversationId,
            input.conversationId,
          ),
          inArray(conversationMessages.id, messageIds),
        ),
      );

    if (messageRows.length !== messageIds.length) {
      throw new Error(
        "Native live current path changed while it was being read.",
      );
    }

    const messagesById =
      new Map(messageRows.map((row) => [row.id, row]));

    const activityByMessage =
      await readNativeLiveMessageActivityByAssistantMessage(
        this.db,
        {
          userId: input.userId,
          conversationId: input.conversationId,
          messageRows,
        },
      );

    const blockRows = await this.db
      .select({
        id: conversationContentBlocks.id,
        messageId:
          conversationContentBlocks.messageId,
        ordinal:
          conversationContentBlocks.ordinal,
        kind: conversationContentBlocks.kind,
        rawType:
          conversationContentBlocks.rawType,
        text: conversationContentBlocks.text,
        payload:
          conversationContentBlocks.payload,
        createdAt:
          conversationContentBlocks.createdAt,
      })
      .from(conversationContentBlocks)
      .where(
        and(
          eq(
            conversationContentBlocks.userId,
            input.userId,
          ),
          inArray(
            conversationContentBlocks.messageId,
            messageIds,
          ),
        ),
      )
      .orderBy(
        asc(conversationContentBlocks.messageId),
        asc(conversationContentBlocks.ordinal),
      );

    const blocksByMessage = new Map<
      string,
      NativeLiveMessage["blocks"]
    >();
    for (const row of blockRows) {
      if (
        row.kind !== "text"
        && row.kind !== "tool_use"
        && row.kind !== "tool_result"
        && row.kind !== "attachment"
      ) {
        continue;
      }
      const blocks =
        blocksByMessage.get(row.messageId) ?? [];
      blocks.push({
        id: row.id,
        ordinal: row.ordinal,
        kind: row.kind,
        rawType: row.rawType,
        text: row.text,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      });
      blocksByMessage.set(row.messageId, blocks);
    }

    const messages = boundedPathRows.map((pathRow) => {
      const row = messagesById.get(pathRow.id);
      if (!row) {
        throw new Error(
          "Native live current path message disappeared.",
        );
      }
      if (row.role !== "user" && row.role !== "assistant") {
        throw new Error(
          "Native live current path contains an unsupported role.",
        );
      }
      return {
        id: row.id,
        conversationId: row.conversationId,
        parentMessageId: row.parentMessageId,
        role: row.role,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        completedAt:
          row.completedAt?.toISOString() ?? null,
        blocks: blocksByMessage.get(row.id) ?? [],
        activity:
          row.role === "assistant"
            ? activityByMessage.get(row.id) ?? null
            : null,
      };
    });

    return {
      conversationId: conversation.id,
      title: conversation.title,
      currentHeadMessageId: headMessageId,
      updatedAt: conversation.updatedAt.toISOString(),
      syncToken: headSyncToken(headMessageId),
      truncated,
      olderCursor,
      resetRequired,
      messages,
    };
  }


}

export function normalizeCurrentPathLimit(
  value: number,
): number {
  if (
    !Number.isInteger(value)
    || value < 1
    || value > MAX_NATIVE_LIVE_CURRENT_PATH_LIMIT
  ) {
    throw new RangeError(
      "Native live current path limit must be an integer from 1 to 200.",
    );
  }
  return value;
}

export function nativeLiveCurrentPathEtag(
  syncToken: string,
  limit: number,
  cursor: {
    beforeMessageId?: string | null;
    afterMessageId?: string | null;
  } = {},
  activityRevision?: string | null,
): string {
  const before = cursor.beforeMessageId ?? "-";
  const after = cursor.afterMessageId ?? "-";
  const activity =
    activityRevision ? `:activity:${activityRevision}` : "";
  return `"${syncToken}:limit:${normalizeCurrentPathLimit(limit)}:before:${before}:after:${after}${activity}"`;
}

function headSyncToken(headMessageId: string): string {
  return `head:${headMessageId}`;
}

function emptySyncToken(conversationId: string): string {
  return `empty:${conversationId}`;
}
