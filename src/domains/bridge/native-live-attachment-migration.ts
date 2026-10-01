import { createHash } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  nativeLiveChatAttachments,
} from "../../database/schema.js";
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
    input: { id: string },
  ): Promise<void>;
}

export class DrizzleNativeLiveInlineAttachmentMigrationRepository
implements NativeLiveInlineAttachmentMigrationRepository {
  constructor(
    private readonly db: Database,
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

  async clearInlineContent(
    input: { id: string },
  ): Promise<void> {
    await this.db
      .update(nativeLiveChatAttachments)
      .set({
        content: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(nativeLiveChatAttachments.id, input.id),
          isNotNull(nativeLiveChatAttachments.content),
          inArray(
            nativeLiveChatAttachments.status,
            ["ready", "bound"],
          ),
        ),
      );
  }
}

export async function migrateNativeLiveAttachmentInlineContentBatch(
  repository: NativeLiveInlineAttachmentMigrationRepository,
  objectStore: NativeLiveAttachmentObjectStore,
  limit = 8,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  examined: number;
  migrated: number;
  failed: number;
}> {
  const rows = await repository.listInlineBatch(limit);
  let migrated = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (!inlineRecordMatchesDeclaredMetadata(row)) {
        failed += 1;
        continue;
      }

      let head = await objectStore.headObject({
        objectKey: row.objectKey,
      });
      if (!head) {
        const slot = objectStore.createUploadSlot({
          objectKey: row.objectKey,
          mimeType: row.mimeType,
          sha256: row.sha256,
        });
        const response = await fetchImpl(slot.url, {
          method: slot.method,
          headers: slot.headers,
          body: row.content,
        });
        if (!response.ok) {
          failed += 1;
          continue;
        }
        head = await objectStore.headObject({
          objectKey: row.objectKey,
        });
      }

      if (!objectHeadMatchesRecord(head, row)) {
        failed += 1;
        continue;
      }

      await repository.clearInlineContent({
        id: row.id,
      });
      migrated += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    examined: rows.length,
    migrated,
    failed,
  };
}

export async function migrateNativeLiveAttachmentInlineContentUntilIdle(
  repository: NativeLiveInlineAttachmentMigrationRepository,
  objectStore: NativeLiveAttachmentObjectStore,
  options: {
    batchSize?: number;
    maxBatches?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{
  examined: number;
  migrated: number;
  failed: number;
  batches: number;
}> {
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
    batches,
  };
}

function inlineRecordMatchesDeclaredMetadata(
  row: NativeLiveInlineAttachmentMigrationRecord,
): boolean {
  return (
    row.content.byteLength === row.sizeBytes
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
