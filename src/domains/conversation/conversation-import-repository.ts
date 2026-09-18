import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { createDatabase } from "../../database/client.js";
import {
  conversationExclusions,
  conversationImportBlobs,
  conversationImportRuns,
  conversationImportSources,
  users,
} from "../../database/schema.js";
import type { ConversationProvider } from "./conversation-types.js";
import type { ConversationExclusionRule } from "./conversation-exclusions.js";

type Database = ReturnType<typeof createDatabase>["db"];
 
export type ConversationStoredSource = {
  id: string;
  userId: string;
  provider: ConversationProvider;
  originalFilename: string;
  rawSha256: string;
  rawBytes: number;
  storageKind: string | null;
  storageKey: string | null;
};

export type ConversationStoredBlob = {
  sourceId: string;
  encoding: "raw" | "gzip";
  originalBytes: number;
  storedBytes: number;
  data: Buffer;
};

export type ConversationStoredRun = {
  id: string;
  userId: string;
  sourceId: string;
  parserVersion: string;
  executionKey: string;
  status: "processing" | "executed" | "failed";
  previewFingerprint: string | null;
  summary: Record<string, unknown>;
  warningCount: number;
  completedAt: Date | null;
  source: ConversationStoredSource;
};

export interface ConversationImportRepository {
  findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null>;
  findSourceBySha(userId: string, rawSha256: string): Promise<ConversationStoredSource | null>;
  findSourceById(userId: string, sourceId: string): Promise<ConversationStoredSource | null>;
  listSourcesForProvider?(input: {
    userId: string;
    provider: ConversationProvider;
  }): Promise<ConversationStoredSource[]>;
  createOrReuseSourceWithBlob(input: {
    userId: string;
    provider: ConversationProvider;
    originalFilename: string;
    rawSha256: string;
    rawBytes: number;
    encoding: "raw" | "gzip";
    data: Buffer;
  }): Promise<{ source: ConversationStoredSource; reused: boolean }>;
  createPreviewRun(input: {
    userId: string;
    sourceId: string;
    parserVersion: string;
    executionKey: string;
    previewFingerprint: string;
    summary: Record<string, unknown>;
    warningCount: number;
  }): Promise<{ id: string }>;
  findExecutedRun(input: {
    userId: string;
    sourceId: string;
    parserVersion: string;
    previewFingerprint: string;
    executionKey: string;
  }): Promise<{ id: string; summary: Record<string, unknown> } | null>;
  findRunById(input: {
    userId: string;
    runId: string;
  }): Promise<ConversationStoredRun | null>;
  readStoredBlob(input: {
    userId: string;
    sourceId: string;
  }): Promise<ConversationStoredBlob | null>;
  listExclusions(userId: string): Promise<ConversationExclusionRule[]>;
}

function toSource(
  row: typeof conversationImportSources.$inferSelect,
): ConversationStoredSource {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    originalFilename: row.originalFilename,
    rawSha256: row.rawSha256,
    rawBytes: row.rawBytes,
    storageKind: row.storageKind,
    storageKey: row.storageKey,
  };
}

export class DrizzleConversationImportRepository
implements ConversationImportRepository {
  constructor(private readonly db: Database) {}

  async findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null> {
    const [row] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

  async findSourceBySha(
    userId: string,
    rawSha256: string,
  ): Promise<ConversationStoredSource | null> {
    const [row] = await this.db
      .select()
      .from(conversationImportSources)
      .where(and(
        eq(conversationImportSources.userId, userId),
        eq(conversationImportSources.rawSha256, rawSha256),
      ))
      .limit(1);
    return row ? toSource(row) : null;
  }

  async findSourceById(
    userId: string,
    sourceId: string,
  ): Promise<ConversationStoredSource | null> {
    const [row] = await this.db
      .select()
      .from(conversationImportSources)
      .where(and(
        eq(conversationImportSources.userId, userId),
        eq(conversationImportSources.id, sourceId),
      ))
      .limit(1);
    return row ? toSource(row) : null;
  }

  async listSourcesForProvider(input: {
    userId: string;
    provider: ConversationProvider;
  }): Promise<ConversationStoredSource[]> {
    const rows = await this.db
      .select()
      .from(conversationImportSources)
      .where(and(
        eq(conversationImportSources.userId, input.userId),
        eq(conversationImportSources.provider, input.provider),
      ));
    return rows.map(toSource);
  }

  async createOrReuseSourceWithBlob(input: {
    userId: string;
    provider: ConversationProvider;
    originalFilename: string;
    rawSha256: string;
    rawBytes: number;
    encoding: "raw" | "gzip";
    data: Buffer;
  }): Promise<{ source: ConversationStoredSource; reused: boolean }> {
    return this.db.transaction(async (transaction) => {
      const [existingRow] = await transaction
        .select()
        .from(conversationImportSources)
        .where(and(
          eq(conversationImportSources.userId, input.userId),
          eq(conversationImportSources.rawSha256, input.rawSha256),
        ))
        .limit(1);
      const existing = existingRow ? toSource(existingRow) : null;
      if (existing) {
        if (existing.provider !== input.provider) {
          throw Object.assign(new Error("Stored source provider does not match."), {
            code: "CONVERSATION_IMPORT_PROVIDER_MISMATCH",
          });
        }
        return { source: existing, reused: true };
      }

      const sourceId = randomUUID();
      const storageKind = "postgres_bytea";
      const [sourceRow] = await transaction
        .insert(conversationImportSources)
        .values({
          id: sourceId,
          userId: input.userId,
          provider: input.provider,
          originalFilename: input.originalFilename,
          rawSha256: input.rawSha256,
          rawBytes: input.rawBytes,
          storageKind,
          storageKey: sourceId,
        })
        .returning();
      if (!sourceRow) throw new Error("Conversation import source insert failed.");

      await transaction.insert(conversationImportBlobs).values({
        sourceId,
        userId: input.userId,
        encoding: input.encoding,
        originalBytes: input.rawBytes,
        storedBytes: input.data.length,
        data: input.data,
      });
      return { source: toSource(sourceRow), reused: false };
    }, { isolationLevel: "serializable" });
  }

  async createPreviewRun(input: {
    userId: string;
    sourceId: string;
    parserVersion: string;
    executionKey: string;
    previewFingerprint: string;
    summary: Record<string, unknown>;
    warningCount: number;
  }): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(conversationImportRuns)
      .values({
        userId: input.userId,
        sourceId: input.sourceId,
        parserVersion: input.parserVersion,
        executionKey: input.executionKey,
        status: "processing",
        previewFingerprint: input.previewFingerprint,
        summary: input.summary,
        warningCount: input.warningCount,
      })
      .returning({ id: conversationImportRuns.id });
    if (!row) throw new Error("Conversation import preview run insert failed.");
    return row;
  }

  async findExecutedRun(input: {
    userId: string;
    sourceId: string;
    parserVersion: string;
    previewFingerprint: string;
    executionKey: string;
  }): Promise<{ id: string; summary: Record<string, unknown> } | null> {
    const [row] = await this.db
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

  async findRunById(input: {
    userId: string;
    runId: string;
  }): Promise<ConversationStoredRun | null> {
    const [row] = await this.db
      .select({
        id: conversationImportRuns.id,
        userId: conversationImportRuns.userId,
        sourceId: conversationImportRuns.sourceId,
        parserVersion: conversationImportRuns.parserVersion,
        executionKey: conversationImportRuns.executionKey,
        status: conversationImportRuns.status,
        previewFingerprint: conversationImportRuns.previewFingerprint,
        summary: conversationImportRuns.summary,
        warningCount: conversationImportRuns.warningCount,
        completedAt: conversationImportRuns.completedAt,
        sourceProvider: conversationImportSources.provider,
        originalFilename: conversationImportSources.originalFilename,
        rawSha256: conversationImportSources.rawSha256,
        rawBytes: conversationImportSources.rawBytes,
        storageKind: conversationImportSources.storageKind,
        storageKey: conversationImportSources.storageKey,
      })
      .from(conversationImportRuns)
      .innerJoin(
        conversationImportSources,
        and(
          eq(conversationImportSources.id, conversationImportRuns.sourceId),
          eq(conversationImportSources.userId, conversationImportRuns.userId),
        ),
      )
      .where(and(
        eq(conversationImportRuns.userId, input.userId),
        eq(conversationImportRuns.id, input.runId),
      ))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      sourceId: row.sourceId,
      parserVersion: row.parserVersion,
      executionKey: row.executionKey,
      status: row.status,
      previewFingerprint: row.previewFingerprint,
      summary: row.summary,
      warningCount: row.warningCount,
      completedAt: row.completedAt,
      source: {
        id: row.sourceId,
        userId: row.userId,
        provider: row.sourceProvider,
        originalFilename: row.originalFilename,
        rawSha256: row.rawSha256,
        rawBytes: row.rawBytes,
        storageKind: row.storageKind,
        storageKey: row.storageKey,
      },
    };
  }

  async listExclusions(userId: string): Promise<ConversationExclusionRule[]> {
    const rows = await this.db
      .select({
        provider: conversationExclusions.provider,
        scope: conversationExclusions.scope,
        sourceConversationId: conversationExclusions.sourceConversationId,
        sourceNodeId: conversationExclusions.sourceNodeId,
      })
      .from(conversationExclusions)
      .where(eq(conversationExclusions.userId, userId));
    return rows;
  }

  async readStoredBlob(input: {
    userId: string;
    sourceId: string;
  }): Promise<ConversationStoredBlob | null> {
    const [row] = await this.db
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
}
