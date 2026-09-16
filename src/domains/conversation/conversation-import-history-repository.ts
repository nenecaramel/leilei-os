import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationImportBlobs,
  conversationImportRuns,
  conversationImportSources,
  users,
  type ConversationImportRunStatus,
  type ConversationProvider,
} from "../../database/schema.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type ConversationImportHistoryStatus =
  | "processing"
  | "executed"
  | "failed"
  | "superseded";

export type ConversationImportHistoryRun = {
  id: string;
  sourceId: string;
  parserVersion: string;
  executionKey: string;
  executionMode: "standard" | "reapply";
  status: ConversationImportHistoryStatus;
  rawStatus: ConversationImportRunStatus;
  previewFingerprint: string | null;
  warningCount: number;
  createdAt: string;
  completedAt: string | null;
  supersededByImportRunId: string | null;
  summary: Record<string, unknown>;
};

export type ConversationImportSourceStorage = {
  kind: string | null;
  retained: boolean;
  encoding: "raw" | "gzip" | null;
  storedBytes: number | null;
};

export type ConversationImportHistoryListItem = {
  sourceId: string;
  provider: ConversationProvider;
  filename: string;
  rawSha256: string;
  rawBytes: number;
  receivedAt: string;
  rawSource: ConversationImportSourceStorage;
  runCount: number;
  processingRunCount: number;
  executedRunCount: number;
  failedRunCount: number;
  supersededRunCount: number;
  latestRun: Omit<ConversationImportHistoryRun, "summary"> | null;
};

export type ConversationImportHistoryDetail = ConversationImportHistoryListItem & {
  runs: ConversationImportHistoryRun[];
};

export interface ConversationImportHistoryRepository {
  findUserStatus(userId: string): Promise<"active" | "disabled" | null>;
  listSources(input: {
    userId: string;
    provider?: ConversationProvider;
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationImportHistoryListItem[]; total: number }>;
  getSource(input: {
    userId: string;
    sourceId: string;
  }): Promise<ConversationImportHistoryDetail | null>;
}

type SourceRow = {
  sourceId: string;
  provider: ConversationProvider;
  filename: string;
  rawSha256: string;
  rawBytes: number;
  storageKind: string | null;
  storageKey: string | null;
  receivedAt: Date;
  blobSourceId: string | null;
  encoding: "raw" | "gzip" | null;
  storedBytes: number | null;
};

type RunRow = {
  id: string;
  sourceId: string;
  parserVersion: string;
  executionKey: string;
  status: ConversationImportRunStatus;
  previewFingerprint: string | null;
  summary: Record<string, unknown>;
  warningCount: number;
  createdAt: Date;
  completedAt: Date | null;
};

function toIso(value: Date): string {
  return value.toISOString();
}

function supersededBy(summary: Record<string, unknown>): string | null {
  const value = summary.superseded_by_executed_run_id;
  return typeof value === "string" ? value : null;
}

function toRun(row: RunRow): ConversationImportHistoryRun {
  const supersededByImportRunId = supersededBy(row.summary);
  return {
    id: row.id,
    sourceId: row.sourceId,
    parserVersion: row.parserVersion,
    executionKey: row.executionKey,
    executionMode: row.executionKey.startsWith("reapply:") ? "reapply" : "standard",
    status: row.status === "failed" && supersededByImportRunId
      ? "superseded"
      : row.status,
    rawStatus: row.status,
    previewFingerprint: row.previewFingerprint,
    warningCount: row.warningCount,
    createdAt: toIso(row.createdAt),
    completedAt: row.completedAt ? toIso(row.completedAt) : null,
    supersededByImportRunId,
    summary: row.summary,
  };
}

function rawSource(row: SourceRow): ConversationImportSourceStorage {
  const retained = row.storageKind === "postgres_bytea"
    ? row.blobSourceId !== null
    : row.storageKind !== null && row.storageKey !== null;
  return {
    kind: row.storageKind,
    retained,
    encoding: row.encoding,
    storedBytes: row.storedBytes,
  };
}

function summarizeSource(
  row: SourceRow,
  runs: ConversationImportHistoryRun[],
): ConversationImportHistoryListItem {
  const latest = runs[0] ?? null;
  return {
    sourceId: row.sourceId,
    provider: row.provider,
    filename: row.filename,
    rawSha256: row.rawSha256,
    rawBytes: row.rawBytes,
    receivedAt: toIso(row.receivedAt),
    rawSource: rawSource(row),
    runCount: runs.length,
    processingRunCount: runs.filter((run) => run.status === "processing").length,
    executedRunCount: runs.filter((run) => run.status === "executed").length,
    failedRunCount: runs.filter((run) => run.status === "failed").length,
    supersededRunCount: runs.filter((run) => run.status === "superseded").length,
    latestRun: latest ? {
      id: latest.id,
      sourceId: latest.sourceId,
      parserVersion: latest.parserVersion,
      executionKey: latest.executionKey,
      executionMode: latest.executionMode,
      status: latest.status,
      rawStatus: latest.rawStatus,
      previewFingerprint: latest.previewFingerprint,
      warningCount: latest.warningCount,
      createdAt: latest.createdAt,
      completedAt: latest.completedAt,
      supersededByImportRunId: latest.supersededByImportRunId,
    } : null,
  };
}

export class DrizzleConversationImportHistoryRepository
implements ConversationImportHistoryRepository {
  constructor(private readonly db: Database) {}

  async findUserStatus(userId: string): Promise<"active" | "disabled" | null> {
    const [row] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.status ?? null;
  }

  async listSources(input: {
    userId: string;
    provider?: ConversationProvider;
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationImportHistoryListItem[]; total: number }> {
    const where = and(
      eq(conversationImportSources.userId, input.userId),
      input.provider
        ? eq(conversationImportSources.provider, input.provider)
        : undefined,
    );
    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(conversationImportSources)
      .where(where);

    const rows: SourceRow[] = await this.db
      .select({
        sourceId: conversationImportSources.id,
        provider: conversationImportSources.provider,
        filename: conversationImportSources.originalFilename,
        rawSha256: conversationImportSources.rawSha256,
        rawBytes: conversationImportSources.rawBytes,
        storageKind: conversationImportSources.storageKind,
        storageKey: conversationImportSources.storageKey,
        receivedAt: conversationImportSources.createdAt,
        blobSourceId: conversationImportBlobs.sourceId,
        encoding: conversationImportBlobs.encoding,
        storedBytes: conversationImportBlobs.storedBytes,
      })
      .from(conversationImportSources)
      .leftJoin(
        conversationImportBlobs,
        and(
          eq(conversationImportBlobs.userId, input.userId),
          eq(conversationImportBlobs.sourceId, conversationImportSources.id),
        ),
      )
      .where(where)
      .orderBy(
        desc(conversationImportSources.createdAt),
        desc(conversationImportSources.id),
      )
      .limit(input.limit)
      .offset(input.offset);

    const runsBySource = await this.readRunsForSources(
      input.userId,
      rows.map((row) => row.sourceId),
    );
    return {
      total: countRow?.total ?? 0,
      items: rows.map((row) => summarizeSource(
        row,
        runsBySource.get(row.sourceId) ?? [],
      )),
    };
  }

  async getSource(input: {
    userId: string;
    sourceId: string;
  }): Promise<ConversationImportHistoryDetail | null> {
    const [row] = await this.db
      .select({
        sourceId: conversationImportSources.id,
        provider: conversationImportSources.provider,
        filename: conversationImportSources.originalFilename,
        rawSha256: conversationImportSources.rawSha256,
        rawBytes: conversationImportSources.rawBytes,
        storageKind: conversationImportSources.storageKind,
        storageKey: conversationImportSources.storageKey,
        receivedAt: conversationImportSources.createdAt,
        blobSourceId: conversationImportBlobs.sourceId,
        encoding: conversationImportBlobs.encoding,
        storedBytes: conversationImportBlobs.storedBytes,
      })
      .from(conversationImportSources)
      .leftJoin(
        conversationImportBlobs,
        and(
          eq(conversationImportBlobs.userId, input.userId),
          eq(conversationImportBlobs.sourceId, conversationImportSources.id),
        ),
      )
      .where(and(
        eq(conversationImportSources.userId, input.userId),
        eq(conversationImportSources.id, input.sourceId),
      ))
      .limit(1);
    if (!row) return null;

    const runsBySource = await this.readRunsForSources(input.userId, [input.sourceId]);
    const runs = runsBySource.get(input.sourceId) ?? [];
    return {
      ...summarizeSource(row, runs),
      runs,
    };
  }

  private async readRunsForSources(
    userId: string,
    sourceIds: string[],
  ): Promise<Map<string, ConversationImportHistoryRun[]>> {
    const result = new Map<string, ConversationImportHistoryRun[]>();
    if (sourceIds.length === 0) return result;

    const rows: RunRow[] = await this.db
      .select({
        id: conversationImportRuns.id,
        sourceId: conversationImportRuns.sourceId,
        parserVersion: conversationImportRuns.parserVersion,
        executionKey: conversationImportRuns.executionKey,
        status: conversationImportRuns.status,
        previewFingerprint: conversationImportRuns.previewFingerprint,
        summary: conversationImportRuns.summary,
        warningCount: conversationImportRuns.warningCount,
        createdAt: conversationImportRuns.createdAt,
        completedAt: conversationImportRuns.completedAt,
      })
      .from(conversationImportRuns)
      .where(and(
        eq(conversationImportRuns.userId, userId),
        inArray(conversationImportRuns.sourceId, sourceIds),
      ))
      .orderBy(
        desc(conversationImportRuns.createdAt),
        desc(conversationImportRuns.id),
      );

    for (const row of rows) {
      const run = toRun(row);
      const list = result.get(row.sourceId) ?? [];
      list.push(run);
      result.set(row.sourceId, list);
    }
    return result;
  }
}
