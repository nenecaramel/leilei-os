import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationAttachments,
  conversationContentBlocks,
  conversationExclusions,
  conversationImportBlobs,
  conversationImportRuns,
  conversationImportSources,
  conversationMessages,
  conversationMessageVersions,
  conversations,
} from "../../database/schema.js";
import type {
  ConversationMergeConversationItem,
  ConversationMergeCurrentState,
} from "./conversation-merge-planner.js";
import { DrizzleConversationArchiveStateRepository } from "./conversation-state-repository.js";
import type { ConversationExclusionRule } from "./conversation-exclusions.js";
import type { ConversationStoredBlob } from "./conversation-import-repository.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;

const MESSAGE_BATCH = 200;
const CHILD_BATCH = 500;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    output.push(values.slice(offset, offset + size));
  }
  return output;
}

function dateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function sanitizePostgresText(value: string): string {
  return value.split(String.fromCharCode(0)).join("");
}

export type LockedConversationImportRun = {
  id: string;
  sourceId: string;
  parserVersion: string;
  executionKey: string;
  status: "processing" | "executed" | "failed";
  previewFingerprint: string | null;
  summary: Record<string, unknown>;
  warningCount: number;
};

export interface ConversationImportExecutionTransaction {
  lockSource(userId: string, sourceId: string): Promise<boolean>;
  lockRun(userId: string, runId: string): Promise<LockedConversationImportRun | null>;
  findExecutedRun(input: {
    userId: string;
    sourceId: string;
    parserVersion: string;
    previewFingerprint: string;
    executionKey: string;
  }): Promise<{ id: string; summary: Record<string, unknown> } | null>;
  readMergeState(userId: string): Promise<ConversationMergeCurrentState>;
  readExclusions(userId: string): Promise<ConversationExclusionRule[]>;
  deleteExclusion?(userId: string, exclusionId: string): Promise<boolean>;
  readStoredBlob(input: {
    userId: string;
    sourceId: string;
  }): Promise<ConversationStoredBlob | null>;
  applyConversation(input: {
    userId: string;
    importRunId: string;
    item: ConversationMergeConversationItem;
  }): Promise<void>;
  markRunExecuted(input: {
    userId: string;
    runId: string;
    summary: Record<string, unknown>;
    warningCount: number;
  }): Promise<void>;
  markRunSuperseded(input: {
    userId: string;
    runId: string;
    executedRunId: string;
  }): Promise<void>;
}

export interface ConversationImportExecutor {
  serializable<T>(
    work: (transaction: ConversationImportExecutionTransaction) => Promise<T>,
  ): Promise<T>;
}

export class DrizzleConversationImportExecutor implements ConversationImportExecutor {
  constructor(private readonly db: Database) {}

  async serializable<T>(
    work: (transaction: ConversationImportExecutionTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(
      async (transaction) => work(
        new DrizzleConversationImportExecutionTransaction(transaction as Transaction),
      ),
      { isolationLevel: "serializable" },
    );
  }
}

class DrizzleConversationImportExecutionTransaction
implements ConversationImportExecutionTransaction {
  constructor(private readonly tx: Transaction) {}

  async lockSource(userId: string, sourceId: string): Promise<boolean> {
    const [row] = await this.tx
      .select({ id: conversationImportSources.id })
      .from(conversationImportSources)
      .where(and(
        eq(conversationImportSources.userId, userId),
        eq(conversationImportSources.id, sourceId),
      ))
      .for("update")
      .limit(1);
    return Boolean(row);
  }

  async lockRun(
    userId: string,
    runId: string,
  ): Promise<LockedConversationImportRun | null> {
    const [row] = await this.tx
      .select({
        id: conversationImportRuns.id,
        sourceId: conversationImportRuns.sourceId,
        parserVersion: conversationImportRuns.parserVersion,
        executionKey: conversationImportRuns.executionKey,
        status: conversationImportRuns.status,
        previewFingerprint: conversationImportRuns.previewFingerprint,
        summary: conversationImportRuns.summary,
        warningCount: conversationImportRuns.warningCount,
      })
      .from(conversationImportRuns)
      .where(and(
        eq(conversationImportRuns.userId, userId),
        eq(conversationImportRuns.id, runId),
      ))
      .for("update")
      .limit(1);
    return row ?? null;
  }

  async findExecutedRun(input: {
    userId: string;
    sourceId: string;
    parserVersion: string;
    previewFingerprint: string;
    executionKey: string;
  }): Promise<{ id: string; summary: Record<string, unknown> } | null> {
    const [row] = await this.tx
      .select({
        id: conversationImportRuns.id,
        summary: conversationImportRuns.summary,
      })
      .from(conversationImportRuns)
      .where(and(
        eq(conversationImportRuns.userId, input.userId),
        eq(conversationImportRuns.sourceId, input.sourceId),
        eq(conversationImportRuns.parserVersion, input.parserVersion),
        eq(conversationImportRuns.previewFingerprint, input.previewFingerprint),
        eq(conversationImportRuns.executionKey, input.executionKey),
        eq(conversationImportRuns.status, "executed"),
      ))
      .limit(1);
    return row ?? null;
  }

  async readMergeState(userId: string): Promise<ConversationMergeCurrentState> {
    return new DrizzleConversationArchiveStateRepository(this.tx).readMergeState(userId);
  }

  async readExclusions(userId: string): Promise<ConversationExclusionRule[]> {
    return this.tx
      .select({
        provider: conversationExclusions.provider,
        scope: conversationExclusions.scope,
        sourceConversationId: conversationExclusions.sourceConversationId,
        sourceNodeId: conversationExclusions.sourceNodeId,
      })
      .from(conversationExclusions)
      .where(eq(conversationExclusions.userId, userId));
  }

  async deleteExclusion(userId: string, exclusionId: string): Promise<boolean> {
    const rows = await this.tx
      .delete(conversationExclusions)
      .where(and(
        eq(conversationExclusions.userId, userId),
        eq(conversationExclusions.id, exclusionId),
      ))
      .returning({ id: conversationExclusions.id });
    return rows.length > 0;
  }

  async readStoredBlob(input: {
    userId: string;
    sourceId: string;
  }): Promise<ConversationStoredBlob | null> {
    const [row] = await this.tx
      .select({
        sourceId: conversationImportBlobs.sourceId,
        encoding: conversationImportBlobs.encoding,
        originalBytes: conversationImportBlobs.originalBytes,
        storedBytes: conversationImportBlobs.storedBytes,
        data: conversationImportBlobs.data,
      })
      .from(conversationImportBlobs)
      .where(and(
        eq(conversationImportBlobs.userId, input.userId),
        eq(conversationImportBlobs.sourceId, input.sourceId),
      ))
      .limit(1);
    return row ?? null;
  }

  async applyConversation(input: {
    userId: string;
    importRunId: string;
    item: ConversationMergeConversationItem;
  }): Promise<void> {
    const { userId, importRunId, item } = input;
    const normalized = item.conversation;
    let conversationId = item.currentId;

    if (item.classification === "create") {
      conversationId = randomUUID();
      await this.tx.insert(conversations).values({
        id: conversationId,
        userId,
        provider: normalized.provider,
        sourceConversationId: normalized.sourceConversationId,
        title: normalized.title,
        sourceCreatedAt: dateOrNull(normalized.sourceCreatedAt),
        sourceUpdatedAt: dateOrNull(normalized.sourceUpdatedAt),
        currentLeafSourceNodeId: normalized.currentLeafSourceNodeId,
        defaultModel: normalized.defaultModel,
        providerMetadata: normalized.providerMetadata,
        sourceFingerprint: item.importedFingerprint,
        firstSeenImportId: importRunId,
        lastSeenImportId: importRunId,
      });
    } else {
      if (!conversationId) throw new Error("Conversation merge state is missing the canonical id.");
      const update = item.classification === "update"
        ? {
            title: normalized.title,
            sourceCreatedAt: dateOrNull(normalized.sourceCreatedAt),
            sourceUpdatedAt: dateOrNull(normalized.sourceUpdatedAt),
            currentLeafSourceNodeId: normalized.currentLeafSourceNodeId,
            defaultModel: normalized.defaultModel,
            providerMetadata: normalized.providerMetadata,
            sourceFingerprint: item.importedFingerprint,
            lastSeenImportId: importRunId,
            updatedAt: new Date(),
          }
        : {
            lastSeenImportId: importRunId,
          };
      await this.tx
        .update(conversations)
        .set(update)
        .where(and(
          eq(conversations.userId, userId),
          eq(conversations.id, conversationId),
        ));
    }

    if (!conversationId) throw new Error("Conversation id was not resolved.");

    const freshAuthoritativePath =
      item.classification !== "stale"
      && normalized.currentLeafSourceNodeId !== null;

    const existingSourceNodeIds = item.messages
      .filter((message) => message.currentId !== null)
      .map((message) => message.sourceNodeId);
    for (const nodeChunk of chunks(existingSourceNodeIds, 2_000)) {
      await this.tx
        .update(conversationMessages)
        .set({ lastSeenImportId: importRunId })
        .where(and(
          eq(conversationMessages.userId, userId),
          eq(conversationMessages.conversationId, conversationId),
          inArray(conversationMessages.sourceNodeId, nodeChunk),
        ));
    }

    const updates = item.messages.filter(
      (message) => message.classification === "update" && message.currentId !== null,
    );
    if (updates.length > 0) {
      await this.snapshotUpdatedMessages(userId, importRunId, updates.map((message) => message.currentId!));
      const updateIds = updates.map((message) => message.currentId!);
      for (const idChunk of chunks(updateIds, 2_000)) {
        await this.tx
          .delete(conversationContentBlocks)
          .where(and(
            eq(conversationContentBlocks.userId, userId),
            inArray(conversationContentBlocks.messageId, idChunk),
          ));
        await this.tx
          .delete(conversationAttachments)
          .where(and(
            eq(conversationAttachments.userId, userId),
            inArray(conversationAttachments.messageId, idChunk),
          ));
      }
    }

    if (freshAuthoritativePath && item.currentId) {
      await this.tx
        .update(conversationMessages)
        .set({
          isCurrentPath: false,
          currentPathIndex: null,
          turnIndex: null,
        })
        .where(and(
          eq(conversationMessages.userId, userId),
          eq(conversationMessages.conversationId, conversationId),
        ));
    }

    const writable = item.messages.filter(
      (message) => message.classification === "create" || message.classification === "update",
    );
    const messageIds = new Map<string, string>();
    for (const message of item.messages) {
      if (message.currentId) messageIds.set(message.sourceNodeId, message.currentId);
    }

    for (const batch of chunks(writable, MESSAGE_BATCH)) {
      const values = batch.map((planned) => {
        const message = planned.message;
        const id = randomUUID();
        if (planned.classification === "create") {
          messageIds.set(message.sourceNodeId, id);
        }
        return {
          id,
          userId,
          conversationId,
          sourceNodeId: message.sourceNodeId,
          sourceMessageId: message.sourceMessageId,
          parentSourceNodeId: message.parentSourceNodeId,
          role: message.role,
          rawRole: message.rawRole,
          model: message.model,
          sourceCreatedAt: dateOrNull(message.sourceCreatedAt),
          sourceUpdatedAt: dateOrNull(message.sourceUpdatedAt),
          isCurrentPath: false,
          currentPathIndex: null,
          turnIndex: null,
          isPrimary: message.isPrimary,
          displayText: sanitizePostgresText(message.displayText),
          sourceFingerprint: planned.importedFingerprint,
          firstSeenImportId: importRunId,
          lastSeenImportId: importRunId,
          updatedAt: new Date(),
        };
      });

      const rows = await this.tx
        .insert(conversationMessages)
        .values(values)
        .onConflictDoUpdate({
          target: [
            conversationMessages.conversationId,
            conversationMessages.sourceNodeId,
          ],
          set: {
            sourceMessageId: sql`excluded."source_message_id"`,
            parentSourceNodeId: sql`excluded."parent_source_node_id"`,
            role: sql`excluded."role"`,
            rawRole: sql`excluded."raw_role"`,
            model: sql`excluded."model"`,
            sourceCreatedAt: sql`excluded."source_created_at"`,
            sourceUpdatedAt: sql`excluded."source_updated_at"`,
            isPrimary: sql`excluded."is_primary"`,
            displayText: sql`excluded."display_text"`,
            sourceFingerprint: sql`excluded."source_fingerprint"`,
            lastSeenImportId: sql`excluded."last_seen_import_id"`,
            updatedAt: sql`now()`,
          },
        })
        .returning({
          id: conversationMessages.id,
          sourceNodeId: conversationMessages.sourceNodeId,
        });
      for (const row of rows) messageIds.set(row.sourceNodeId, row.id);
    }

    const childMessages = writable.filter((planned) => {
      const id = messageIds.get(planned.sourceNodeId);
      return Boolean(id);
    });

    const blocks = childMessages.flatMap((planned) => {
      const messageId = messageIds.get(planned.sourceNodeId)!;
      return planned.message.contentBlocks.map((block) => ({
        userId,
        messageId,
        ordinal: block.ordinal,
        kind: block.kind,
        rawType: block.rawType,
        text: block.text === null ? null : sanitizePostgresText(block.text),
        payload: block.payload,
      }));
    });
    for (const batch of chunks(blocks, CHILD_BATCH)) {
      if (batch.length > 0) await this.tx.insert(conversationContentBlocks).values(batch);
    }

    const attachments = childMessages.flatMap((planned) => {
      const messageId = messageIds.get(planned.sourceNodeId)!;
      return planned.message.attachments.map((attachment) => ({
        userId,
        messageId,
        ordinal: attachment.ordinal,
        sourceAttachmentId: attachment.sourceAttachmentId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        payload: attachment.payload,
      }));
    });
    for (const batch of chunks(attachments, CHILD_BATCH)) {
      if (batch.length > 0) await this.tx.insert(conversationAttachments).values(batch);
    }

    if (freshAuthoritativePath) {
      const pathRows = item.messages
        .filter((planned) => planned.message.isCurrentPath)
        .map((planned) => ({
          id: messageIds.get(planned.sourceNodeId),
          isCurrentPath: true as const,
          currentPathIndex: planned.message.currentPathIndex,
          turnIndex: planned.message.turnIndex,
        }))
        .filter((row): row is {
          id: string;
          isCurrentPath: true;
          currentPathIndex: number;
          turnIndex: number | null;
        } => Boolean(row.id) && row.currentPathIndex !== null);

      for (const batch of chunks(pathRows, MESSAGE_BATCH)) {
        if (batch.length === 0) continue;
        const rows = batch.map((row) => sql`(
          ${row.id}::uuid,
          ${row.isCurrentPath}::boolean,
          ${row.currentPathIndex}::integer,
          ${row.turnIndex}::integer
        )`);
        await this.tx.execute(sql`
          update "conversation_messages" as m
          set
            "is_current_path" = v.is_current_path,
            "current_path_index" = v.current_path_index,
            "turn_index" = v.turn_index,
            "last_seen_import_id" = ${importRunId}::uuid
          from (values ${sql.join(rows, sql`, `)})
            as v(id, is_current_path, current_path_index, turn_index)
          where m.id = v.id
            and m.user_id = ${userId}::uuid
        `);
      }
    }
  }

  private async snapshotUpdatedMessages(
    userId: string,
    importRunId: string,
    messageIds: string[],
  ): Promise<void> {
    const messages: Array<typeof conversationMessages.$inferSelect> = [];
    for (const idChunk of chunks(messageIds, 2_000)) {
      messages.push(...await this.tx
        .select()
        .from(conversationMessages)
        .where(and(
          eq(conversationMessages.userId, userId),
          inArray(conversationMessages.id, idChunk),
        )));
    }

    const blocks: Array<typeof conversationContentBlocks.$inferSelect> = [];
    const attachments: Array<typeof conversationAttachments.$inferSelect> = [];
    for (const idChunk of chunks(messageIds, 2_000)) {
      blocks.push(...await this.tx
        .select()
        .from(conversationContentBlocks)
        .where(and(
          eq(conversationContentBlocks.userId, userId),
          inArray(conversationContentBlocks.messageId, idChunk),
        )));
      attachments.push(...await this.tx
        .select()
        .from(conversationAttachments)
        .where(and(
          eq(conversationAttachments.userId, userId),
          inArray(conversationAttachments.messageId, idChunk),
        )));
    }

    const blocksByMessage = new Map<string, Array<typeof conversationContentBlocks.$inferSelect>>();
    for (const block of blocks) {
      const list = blocksByMessage.get(block.messageId) ?? [];
      list.push(block);
      blocksByMessage.set(block.messageId, list);
    }
    const attachmentsByMessage = new Map<string, Array<typeof conversationAttachments.$inferSelect>>();
    for (const attachment of attachments) {
      const list = attachmentsByMessage.get(attachment.messageId) ?? [];
      list.push(attachment);
      attachmentsByMessage.set(attachment.messageId, list);
    }

    const versions = messages.map((message) => ({
      userId,
      messageId: message.id,
      previousFingerprint: message.sourceFingerprint,
      replacedByImportId: importRunId,
      snapshot: {
        message: {
          source_node_id: message.sourceNodeId,
          source_message_id: message.sourceMessageId,
          parent_source_node_id: message.parentSourceNodeId,
          role: message.role,
          raw_role: message.rawRole,
          model: message.model,
          source_created_at: iso(message.sourceCreatedAt),
          source_updated_at: iso(message.sourceUpdatedAt),
          is_current_path: message.isCurrentPath,
          current_path_index: message.currentPathIndex,
          turn_index: message.turnIndex,
          is_primary: message.isPrimary,
          display_text: message.displayText,
          source_fingerprint: message.sourceFingerprint,
        },
        content_blocks: (blocksByMessage.get(message.id) ?? [])
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((block) => ({
            ordinal: block.ordinal,
            kind: block.kind,
            raw_type: block.rawType,
            text: block.text,
            payload: block.payload,
          })),
        attachments: (attachmentsByMessage.get(message.id) ?? [])
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((attachment) => ({
            ordinal: attachment.ordinal,
            source_attachment_id: attachment.sourceAttachmentId,
            name: attachment.name,
            mime_type: attachment.mimeType,
            size_bytes: attachment.sizeBytes,
            payload: attachment.payload,
          })),
      },
    }));

    for (const batch of chunks(versions, MESSAGE_BATCH)) {
      if (batch.length > 0) await this.tx.insert(conversationMessageVersions).values(batch);
    }
  }

  async markRunSuperseded(input: {
    userId: string;
    runId: string;
    executedRunId: string;
  }): Promise<void> {
    const [row] = await this.tx
      .update(conversationImportRuns)
      .set({
        status: "failed",
        summary: {
          superseded_by_executed_run_id: input.executedRunId,
          reason: "same_source_parser_already_executed",
        },
        completedAt: new Date(),
      })
      .where(and(
        eq(conversationImportRuns.userId, input.userId),
        eq(conversationImportRuns.id, input.runId),
        eq(conversationImportRuns.status, "processing"),
      ))
      .returning({ id: conversationImportRuns.id });
    if (!row) throw Object.assign(new Error("Conversation import run is not executable."), {
      code: "CONVERSATION_IMPORT_RUN_NOT_EXECUTABLE",
    });
  }

  async markRunExecuted(input: {
    userId: string;
    runId: string;
    summary: Record<string, unknown>;
    warningCount: number;
  }): Promise<void> {
    const [row] = await this.tx
      .update(conversationImportRuns)
      .set({
        status: "executed",
        summary: input.summary,
        warningCount: input.warningCount,
        completedAt: new Date(),
      })
      .where(and(
        eq(conversationImportRuns.userId, input.userId),
        eq(conversationImportRuns.id, input.runId),
        eq(conversationImportRuns.status, "processing"),
      ))
      .returning({ id: conversationImportRuns.id });
    if (!row) throw Object.assign(new Error("Conversation import run is not executable."), {
      code: "CONVERSATION_IMPORT_RUN_NOT_EXECUTABLE",
    });
  }
}
