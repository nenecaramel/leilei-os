import { createHash } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
} from "drizzle-orm";
import { withNativeLiveAttachmentObjectLock, type NativeLiveAttachmentDb } from "./native-live-attachment-service.js";
import type { createDatabase } from "../../../database/client.js";
import {
  nativeLiveChatAttachments,
} from "../../../database/schema.js";
import type {
  NativeLiveAttachmentObjectHead,
  NativeLiveAttachmentObjectStore,
} from "./native-live-attachment-storage.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type NativeLiveInlineAttachmentMigrationRecord = {
  id: string;
  objectKey: string;
  content: Buffer;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};

export interface NativeLiveInlineAttachmentMigrationRepository {
  listInlineBatch(
    limit: number,
  ): Promise<NativeLiveInlineAttachmentMigrationRecord[]>;

  clearInlineContent(
    input: NativeLiveInlineAttachmentMigrationRecord,
  ): Promise<boolean>;

  withLockedRecord?<T>(
    row: NativeLiveInlineAttachmentMigrationRecord,
    operation: (row: NativeLiveInlineAttachmentMigrationRecord | null, repository: NativeLiveInlineAttachmentMigrationRepository) => Promise<T>,
  ): Promise<T>;
}

export class DrizzleNativeLiveInlineAttachmentMigrationRepository
implements NativeLiveInlineAttachmentMigrationRepository {
  constructor(
    private readonly db: NativeLiveAttachmentDb,
  ) {}

  async listInlineBatch(
    limit: number,
  ): Promise<NativeLiveInlineAttachmentMigrationRecord[]> {
    const safeLimit =
      Number.isSafeInteger(limit) && limit > 0
        ? Math.min(limit, 100)
        : 8;
    const rows = await this.db
      .select({
        id: nativeLiveChatAttachments.id,
        objectKey: nativeLiveChatAttachments.objectKey,
        content: nativeLiveChatAttachments.content,
        mimeType: nativeLiveChatAttachments.mimeType,
        sizeBytes: nativeLiveChatAttachments.sizeBytes,
        sha256: nativeLiveChatAttachments.sha256,
      })
      .from(nativeLiveChatAttachments)
      .where(
        and(
          isNotNull(nativeLiveChatAttachments.content),
          inArray(
            nativeLiveChatAttachments.status,
            ["ready", "bound"],
          ),
        ),
      )
      .orderBy(
        asc(nativeLiveChatAttachments.createdAt),
        asc(nativeLiveChatAttachments.id),
      )
      .limit(safeLimit);

    return rows.flatMap((row) =>
      row.content
        ? [{
            id: row.id,
            objectKey: row.objectKey,
            content: row.content,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            sha256: row.sha256,
          }]
        : []
    );
  }

  async withLockedRecord<T>(
    row: NativeLiveInlineAttachmentMigrationRecord,
    operation: (row: NativeLiveInlineAttachmentMigrationRecord | null, repository: NativeLiveInlineAttachmentMigrationRepository) => Promise<T>,
  ): Promise<T> {
    return withNativeLiveAttachmentObjectLock(this.db as Database, row.objectKey, async (tx) => {
      const [current] = await tx.select().from(nativeLiveChatAttachments).where(and(
        eq(nativeLiveChatAttachments.id, row.id),
        eq(nativeLiveChatAttachments.objectKey, row.objectKey),
        isNotNull(nativeLiveChatAttachments.content),
        inArray(nativeLiveChatAttachments.status, ["ready", "bound"]),
      )).limit(1);
      return operation(current?.content ? { ...current, content: current.content } : null,
        new DrizzleNativeLiveInlineAttachmentMigrationRepository(tx));
    });
  }

  async clearInlineContent(input: NativeLiveInlineAttachmentMigrationRecord): Promise<boolean> {
    const cleared = await this.db.update(nativeLiveChatAttachments).set({
      content: null, updatedAt: new Date(),
    }).where(and(
      eq(nativeLiveChatAttachments.id, input.id),
      eq(nativeLiveChatAttachments.objectKey, input.objectKey),
      eq(nativeLiveChatAttachments.mimeType, input.mimeType),
      eq(nativeLiveChatAttachments.sizeBytes, input.sizeBytes),
      eq(nativeLiveChatAttachments.sha256, input.sha256),
      eq(nativeLiveChatAttachments.content, input.content),
      isNotNull(nativeLiveChatAttachments.content),
      inArray(nativeLiveChatAttachments.status, ["ready", "bound"]),
    )).returning({ id: nativeLiveChatAttachments.id });
    return cleared.length === 1;
  }
}

export type NativeLiveAttachmentMigrationStats = {
  examined: number;
  migrated: number;
  skipped: number;
  failed: number;
  bytesMigrated: number;
};

export async function migrateNativeLiveAttachmentInlineContentBatch(
  repository: NativeLiveInlineAttachmentMigrationRepository,
  objectStore: NativeLiveAttachmentObjectStore,
  limit = 8,
  fetchImpl: typeof fetch = fetch,
): Promise<NativeLiveAttachmentMigrationStats> {
  const rows = await repository.listInlineBatch(limit);
  const result: NativeLiveAttachmentMigrationStats = { examined: rows.length, migrated: 0, skipped: 0, failed: 0, bytesMigrated: 0 };
  for (const row of rows) {
    try {
      const migrate = async (current: NativeLiveInlineAttachmentMigrationRecord | null, repo: NativeLiveInlineAttachmentMigrationRepository) => {
        if (!current) return { migrated: false, bytes: 0 };
        if (!inlineRecordMatchesDeclaredMetadata(current)) throw new Error("Invalid inline attachment metadata");
        let head = await objectStore.headObject({ objectKey: current.objectKey });
        if (!head) {
          const slot = objectStore.createUploadSlot({ objectKey: current.objectKey, mimeType: current.mimeType, sha256: current.sha256 });
          const response = await fetchImpl(slot.url, {
            method: slot.method, headers: slot.headers,
            body: Uint8Array.from(current.content), signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok) throw new Error("Attachment upload failed");
          head = await objectStore.headObject({ objectKey: current.objectKey });
        }
        // A mismatching existing object must never be overwritten.
        if (!objectHeadMatchesRecord(head, current)) throw new Error("Attachment HEAD verification failed");
        const cleared = await repo.clearInlineContent(current);
        return { migrated: cleared, bytes: cleared ? current.content.byteLength : 0 };
      };
      const outcome = repository.withLockedRecord
        ? await repository.withLockedRecord(row, migrate)
        : await migrate(row, repository);
      if (outcome.migrated) {
        result.migrated++;
        result.bytesMigrated += outcome.bytes;
      } else result.skipped++;
    } catch { result.failed++; }
  }
  return result;
}

export async function migrateNativeLiveAttachmentInlineContentUntilIdle(
  repository: NativeLiveInlineAttachmentMigrationRepository,
  objectStore: NativeLiveAttachmentObjectStore,
  options: {
    batchSize?: number;
    maxBatches?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<NativeLiveAttachmentMigrationStats & { batches: number }> {
  const batchSize =
    Number.isSafeInteger(options.batchSize)
      && (options.batchSize ?? 0) > 0
      ? Math.min(options.batchSize!, 100)
      : 8;
  const maxBatches =
    Number.isSafeInteger(options.maxBatches)
      && (options.maxBatches ?? 0) > 0
      ? Math.min(options.maxBatches!, 1_000)
      : 128;

  let examined = 0;
  let migrated = 0;
  let failed = 0;
  let batches = 0;
  let skipped = 0;
  let bytesMigrated = 0;

  while (batches < maxBatches) {
    const batch =
      await migrateNativeLiveAttachmentInlineContentBatch(
        repository,
        objectStore,
        batchSize,
        options.fetchImpl,
      );
    batches += 1;
    examined += batch.examined;
    migrated += batch.migrated;
    failed += batch.failed;
    skipped += batch.skipped;
    bytesMigrated += batch.bytesMigrated;

    if (
      batch.examined === 0
      || batch.migrated === 0
    ) {
      break;
    }
  }

  return {
    examined,
    migrated,
    failed,
    skipped,
    bytesMigrated,
    batches,
  };
}

function inlineRecordMatchesDeclaredMetadata(
  row: NativeLiveInlineAttachmentMigrationRecord,
): boolean {
  return (
    /^native-live\/[^/]+\/[^/]+$/u.test(row.objectKey)
    && /^[^\s/;]+\/[^\s/;]+$/u.test(row.mimeType)
    && Number.isSafeInteger(row.sizeBytes) && row.sizeBytes > 0
    && /^[a-f0-9]{64}$/u.test(row.sha256)
    && row.content.byteLength === row.sizeBytes
    && createHash("sha256")
      .update(row.content)
      .digest("hex") === row.sha256
  );
}

function objectHeadMatchesRecord(
  head: NativeLiveAttachmentObjectHead | null,
  row: NativeLiveInlineAttachmentMigrationRecord,
): boolean {
  return Boolean(
    head
    && head.sizeBytes === row.sizeBytes
    && head.mimeType?.toLowerCase()
      === row.mimeType.toLowerCase()
    && head.sha256?.toLowerCase()
      === row.sha256.toLowerCase(),
  );
}
