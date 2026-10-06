import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  conversationAttachments,
  conversationContentBlocks,
  nativeLiveChatAttachments,
} from "../../../database/schema.js";
import type {
  NativeLiveAttachmentObjectStore,
  NativeLiveAttachmentDownloadSlot,
  NativeLiveAttachmentUploadSlot,
} from "./native-live-attachment-storage.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type NativeLiveAttachmentDb = Database | Transaction;

export type NativeLiveChatAttachmentKind = "image" | "file";
export type NativeLiveChatAttachmentStatus =
  | "uploading"
  | "ready"
  | "bound"
  | "failed";

export type NativeLiveChatAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  kind: NativeLiveChatAttachmentKind;
  status: NativeLiveChatAttachmentStatus;
  objectKey: string;
  boundMessageId: string | null;
  createdAt: string;
  expiresAt: string;
};

export type NativeLiveRuntimeAttachment = {
  attachment_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  kind: NativeLiveChatAttachmentKind;
};

export class NativeLiveAttachmentError extends Error {
  constructor(
    readonly code:
      | "INVALID_ATTACHMENT"
      | "ATTACHMENT_NOT_FOUND"
      | "ATTACHMENT_NOT_READY"
      | "ATTACHMENT_UPLOAD_MISMATCH"
      | "ATTACHMENT_STORAGE_UNAVAILABLE"
      | "ATTACHMENT_LIMIT_EXCEEDED",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveAttachmentError";
  }
}

export class NativeLiveAttachmentService {
  constructor(
    private readonly db: Database,
    private readonly objectStore:
      NativeLiveAttachmentObjectStore,
    private readonly config: {
      maxFileBytes: number;
      unboundTtlSeconds: number;
    },
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
    private readonly legacyInlineObjectStore?:
      NativeLiveAttachmentObjectStore,
  ) {}

  async createUploadSlot(input: {
    userId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    kind?: NativeLiveChatAttachmentKind | null;
  }): Promise<{
    attachment: NativeLiveChatAttachment;
    upload: NativeLiveAttachmentUploadSlot;
  }> {
    const filename = normalizeFilename(input.filename);
    const mimeType = normalizeMimeType(input.mimeType);
    const sha256 = normalizeSha256(input.sha256);
    if (
      !Number.isSafeInteger(input.sizeBytes)
      || input.sizeBytes <= 0
      || input.sizeBytes > this.config.maxFileBytes
    ) {
      throw new NativeLiveAttachmentError(
        "ATTACHMENT_LIMIT_EXCEEDED",
        "Attachment size exceeds the configured limit.",
      );
    }

    const attachmentId = this.createId();
    const kind =
      input.kind
      ?? (
        mimeType.startsWith("image/")
          ? "image"
          : "file"
      );
    if (kind !== "image" && kind !== "file") {
      throw new NativeLiveAttachmentError(
        "INVALID_ATTACHMENT",
        "Attachment kind must be image or file.",
      );
    }
    const objectKey =
      "native-live/"
      + input.userId
      + "/"
      + attachmentId;
    const now = this.now();
    const expiresAt = new Date(
      now.getTime()
      + this.config.unboundTtlSeconds * 1_000,
    );

    const [row] = await this.db
      .insert(nativeLiveChatAttachments)
      .values({
        id: attachmentId,
        userId: input.userId,
        objectKey,
        filename,
        mimeType,
        sizeBytes: input.sizeBytes,
        sha256,
        kind,
        status: "uploading",
        expiresAt,
      })
      .returning();
    if (!row) {
      throw new Error(
        "Native Live attachment insert failed.",
      );
    }

    return {
      attachment: mapAttachment(row),
      upload: this.objectStore.createUploadSlot({
        objectKey,
        mimeType,
        sha256,
      }),
    };
  }

  async completeUpload(input: {
    userId: string;
    attachmentId: string;
  }): Promise<NativeLiveChatAttachment> {
    const row = await this.readOwned(
      input.userId,
      input.attachmentId,
    );
    if (!row) {
      throw new NativeLiveAttachmentError(
        "ATTACHMENT_NOT_FOUND",
        "Attachment was not found.",
      );
    }
    if (row.status === "ready" || row.status === "bound") {
      return mapAttachment(row);
    }
    if (row.status !== "uploading") {
      throw new NativeLiveAttachmentError(
        "ATTACHMENT_NOT_READY",
        "Attachment upload is not completable.",
      );
    }
    if (row.expiresAt.getTime() <= this.now().getTime()) {
      await this.markFailed(input.userId, input.attachmentId);
      throw new NativeLiveAttachmentError(
        "ATTACHMENT_NOT_READY",
        "Attachment upload slot has expired.",
      );
    }

    const objectStore =
      row.content && this.legacyInlineObjectStore
        ? this.legacyInlineObjectStore
        : this.objectStore;
    let head;
    try {
      head = await objectStore.headObject({
        objectKey: row.objectKey,
      });
    } catch (cause) {
      throw new NativeLiveAttachmentError(
        "ATTACHMENT_STORAGE_UNAVAILABLE",
        cause instanceof Error
          ? cause.message
          : "Attachment storage is unavailable.",
      );
    }

    const mimeMatches =
      head?.mimeType?.toLowerCase()
        === row.mimeType.toLowerCase();
    const checksumMatches =
      head?.sha256?.toLowerCase()
        === row.sha256.toLowerCase();
    if (
      !head
      || head.sizeBytes !== row.sizeBytes
      || !mimeMatches
      || !checksumMatches
    ) {
      await this.markFailed(input.userId, input.attachmentId);
      throw new NativeLiveAttachmentError(
        "ATTACHMENT_UPLOAD_MISMATCH",
        "Uploaded object metadata does not match the declared attachment.",
      );
    }

    const now = this.now();
    const [ready] = await this.db
      .update(nativeLiveChatAttachments)
      .set({
        status: "ready",
        readyAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(
            nativeLiveChatAttachments.userId,
            input.userId,
          ),
          eq(
            nativeLiveChatAttachments.id,
            input.attachmentId,
          ),
          eq(
            nativeLiveChatAttachments.status,
            "uploading",
          ),
        ),
      )
      .returning();
    if (!ready) {
      const replay = await this.readOwned(
        input.userId,
        input.attachmentId,
      );
      if (
        replay
        && (
          replay.status === "ready"
          || replay.status === "bound"
        )
      ) {
        return mapAttachment(replay);
      }
      throw new NativeLiveAttachmentError(
        "ATTACHMENT_NOT_READY",
        "Attachment changed state while completing.",
      );
    }
    return mapAttachment(ready);
  }

  async createDownloadSlot(input: {
    userId: string;
    attachmentId: string;
  }): Promise<{
    attachment: NativeLiveChatAttachment;
    download: NativeLiveAttachmentDownloadSlot;
  }> {
    const row = await this.readOwned(
      input.userId,
      input.attachmentId,
    );
    if (
      !row
      || (
        row.status !== "ready"
        && row.status !== "bound"
      )
    ) {
      throw new NativeLiveAttachmentError(
        "ATTACHMENT_NOT_FOUND",
        "Attachment is not available.",
      );
    }
    if (
      row.status === "ready"
      && row.expiresAt.getTime() <= this.now().getTime()
    ) {
      throw new NativeLiveAttachmentError(
        "ATTACHMENT_NOT_READY",
        "Unbound attachment has expired.",
      );
    }
    const objectStore =
      row.content && this.legacyInlineObjectStore
        ? this.legacyInlineObjectStore
        : this.objectStore;
    return {
      attachment: mapAttachment(row),
      download: objectStore.createDownloadSlot({
        objectKey: row.objectKey,
      }),
    };
  }

  private async readOwned(
    userId: string,
    attachmentId: string,
  ) {
    const [row] = await this.db
      .select()
      .from(nativeLiveChatAttachments)
      .where(
        and(
          eq(nativeLiveChatAttachments.userId, userId),
          eq(nativeLiveChatAttachments.id, attachmentId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async markFailed(
    userId: string,
    attachmentId: string,
  ): Promise<void> {
    const now = this.now();
    await this.db
      .update(nativeLiveChatAttachments)
      .set({
        status: "failed",
        failedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(nativeLiveChatAttachments.userId, userId),
          eq(nativeLiveChatAttachments.id, attachmentId),
          eq(nativeLiveChatAttachments.status, "uploading"),
        ),
      );
  }
}

// Migration and retention share an object-key lock across replicas. Re-read
// after acquiring it so a stale candidate cannot resurrect a deleted object.
export async function withNativeLiveAttachmentObjectLock<T>(
  db: Database,
  objectKey: string,
  operation: (tx: NativeLiveAttachmentDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${objectKey}, 0))`);
    return operation(tx);
  });
}

export async function deleteExpiredNativeLiveAttachmentsBatch(
  db: Database,
  objectStore: Pick<NativeLiveAttachmentObjectStore, "deleteObject">,
  cutoff: Date,
  limit: number,
  legacyInlineObjectStore?: Pick<NativeLiveAttachmentObjectStore, "deleteObject">,
): Promise<number> {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 1_000) : 100;
  type Candidate = { id: string; userId: string; objectKey: string; hasInlineContent: boolean };
  const expired = sql`(
    (attachment.bound_message_id IS NULL AND attachment.expires_at <= ${cutoff.toISOString()}::timestamptz)
    OR (attachment.status = 'bound' AND attachment.bound_message_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM conversation_messages AS message
        WHERE message.id = attachment.bound_message_id AND message.user_id = attachment.user_id))
  )`;
  const candidates = await db.execute<Candidate>(sql`
    SELECT attachment.id, attachment.user_id AS "userId", attachment.object_key AS "objectKey",
      (attachment.content IS NOT NULL) AS "hasInlineContent"
    FROM native_live_chat_attachments AS attachment
    WHERE ${expired}
    ORDER BY attachment.created_at, attachment.id LIMIT ${safeLimit}
  `);
  let deleted = 0;
  for (const candidate of candidates) {
    try {
      deleted += await withNativeLiveAttachmentObjectLock(db, candidate.objectKey, async (tx) => {
        const [current] = await tx.execute<Candidate>(sql`
          SELECT attachment.id, attachment.user_id AS "userId", attachment.object_key AS "objectKey",
            (attachment.content IS NOT NULL) AS "hasInlineContent"
          FROM native_live_chat_attachments AS attachment
          WHERE attachment.id = ${candidate.id}::uuid
            AND attachment.object_key = ${candidate.objectKey} AND ${expired}
        `);
        if (!current) return 0;
        // A failed migration may have left a verified object alongside inline
        // bytes. Delete the Bucket copy first, including for inline candidates.
        await objectStore.deleteObject({ objectKey: current.objectKey });
        if (current.hasInlineContent && legacyInlineObjectStore) {
          await legacyInlineObjectStore.deleteObject({ objectKey: current.objectKey });
        }
        const removed = await tx.delete(nativeLiveChatAttachments).where(and(
          eq(nativeLiveChatAttachments.id, current.id),
          eq(nativeLiveChatAttachments.userId, current.userId),
          eq(nativeLiveChatAttachments.objectKey, current.objectKey),
        )).returning({ id: nativeLiveChatAttachments.id });
        return removed.length;
      });
    } catch { continue; }
  }
  return deleted;
}

export class DrizzleNativeLiveAttachmentBinding {
  constructor(
    private readonly db: NativeLiveAttachmentDb,
    private readonly maxPerTurn = 8,
  ) {}

  async bindReadyToMessage(input: {
    userId: string;
    messageId: string;
    attachmentIds: readonly string[];
    attachmentMetadata?: readonly {
      attachment_id: string;
      duration_seconds: number;
    }[];
    allowPreviouslyBound?: boolean;
    startOrdinal?: number;
    contentOrigin?: "user_send" | "provider_send";
  }): Promise<NativeLiveRuntimeAttachment[]> {
    const attachmentIds = normalizeAttachmentIds(
      input.attachmentIds,
      this.maxPerTurn,
    );
    if (attachmentIds.length === 0) return [];

    const attachmentIdSet = new Set(attachmentIds);
    const durationSecondsByAttachmentId = new Map<string, number>();
    for (const metadata of input.attachmentMetadata ?? []) {
      if (
        attachmentIdSet.has(metadata.attachment_id)
        && Number.isFinite(metadata.duration_seconds)
        && metadata.duration_seconds > 0
      ) {
        durationSecondsByAttachmentId.set(
          metadata.attachment_id,
          metadata.duration_seconds,
        );
      }
    }
    const durationPayloadFor = (
      attachment: NativeLiveRuntimeAttachment,
    ): Record<string, number> => {
      const durationSeconds =
        attachment.mime_type.startsWith("audio/")
          ? durationSecondsByAttachmentId.get(
              attachment.attachment_id,
            )
          : undefined;
      return durationSeconds === undefined
        ? {}
        : { duration_seconds: durationSeconds };
    };

    const rows = await this.db
      .select()
      .from(nativeLiveChatAttachments)
      .where(
        and(
          eq(nativeLiveChatAttachments.userId, input.userId),
          inArray(nativeLiveChatAttachments.id, attachmentIds),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = attachmentIds.map((id) => {
      const row = byId.get(id);
      if (!row) {
        throw new NativeLiveAttachmentError(
          "ATTACHMENT_NOT_FOUND",
          "Attachment was not found.",
        );
      }
      if (
        row.status !== "ready"
        && !(
          input.allowPreviouslyBound === true
          && row.status === "bound"
        )
      ) {
        throw new NativeLiveAttachmentError(
          "ATTACHMENT_NOT_READY",
          "Attachment is not ready to bind.",
        );
      }
      if (
        row.status === "ready"
        && row.expiresAt.getTime() <= Date.now()
      ) {
        throw new NativeLiveAttachmentError(
          "ATTACHMENT_NOT_READY",
          "Attachment has expired.",
        );
      }
      return row;
    });

    const now = new Date();
    const readyIds = ordered
      .filter((row) => row.status === "ready")
      .map((row) => row.id);
    if (readyIds.length > 0) {
      const updated = await this.db
        .update(nativeLiveChatAttachments)
        .set({
          status: "bound",
          boundMessageId: input.messageId,
          boundAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(nativeLiveChatAttachments.userId, input.userId),
            inArray(nativeLiveChatAttachments.id, readyIds),
            eq(nativeLiveChatAttachments.status, "ready"),
          ),
        )
        .returning({ id: nativeLiveChatAttachments.id });
      if (updated.length !== readyIds.length) {
        throw new NativeLiveAttachmentError(
          "ATTACHMENT_NOT_READY",
          "Attachment binding lost its ready-state lock.",
        );
      }
    }

    const descriptors = ordered.map(runtimeAttachmentFromRow);
    if (descriptors.length > 0) {
      await this.db
        .insert(conversationAttachments)
        .values(
          descriptors.map((attachment, index) => ({
            userId: input.userId,
            messageId: input.messageId,
            ordinal: index,
            sourceAttachmentId: attachment.attachment_id,
            name: attachment.filename,
            mimeType: attachment.mime_type,
            sizeBytes: attachment.size_bytes,
            payload: {
              attachment_id: attachment.attachment_id,
              sha256: attachment.sha256,
              kind: attachment.kind,
              storage: "native_live_attachment",
              ...durationPayloadFor(attachment),
            },
          })),
        );
      await this.db
        .insert(conversationContentBlocks)
        .values(
          descriptors.map((attachment, index) => ({
            userId: input.userId,
            messageId: input.messageId,
            ordinal: (input.startOrdinal ?? 1) + index,
            kind: "attachment" as const,
            rawType: attachment.kind,
            text: null,
            payload: {
              schema_version: 1,
              identity: "attachment",
              refs: [{ type: "attachment_ref", entity_id: attachment.attachment_id }],
              provenance: {
                ...(input.contentOrigin === "provider_send" ? { provider: "claude_code" } : {}),
                raw_type: input.contentOrigin === "provider_send" ? "send_file" : "user_attachment",
                origin: input.contentOrigin ?? "user_send",
                source_ref: { type: "attachment_ref", entity_id: attachment.attachment_id },
              },
              attachment_id: attachment.attachment_id,
              filename: attachment.filename,
              mime_type: attachment.mime_type,
              size_bytes: attachment.size_bytes,
              sha256: attachment.sha256,
              kind: attachment.kind,
              storage: "native_live_attachment",
              ...durationPayloadFor(attachment),
            },
          })),
        );
    }
    return descriptors;
  }

  async readForMessage(input: {
    userId: string;
    messageId: string;
  }): Promise<NativeLiveRuntimeAttachment[]> {
    const rows = await this.db
      .select()
      .from(conversationAttachments)
      .where(
        and(
          eq(conversationAttachments.userId, input.userId),
          eq(conversationAttachments.messageId, input.messageId),
        ),
      )
      .orderBy(conversationAttachments.ordinal);

    return rows.map((row) => {
      const attachmentId =
        row.sourceAttachmentId
        ?? readString(row.payload, "attachment_id");
      const sha256 = readString(row.payload, "sha256");
      const kind = readString(row.payload, "kind");
      if (
        !attachmentId
        || !row.name
        || !row.mimeType
        || row.sizeBytes === null
        || !sha256
        || (kind !== "image" && kind !== "file")
      ) {
        throw new Error(
          "Canonical Native Live attachment metadata is incomplete.",
        );
      }
      return {
        attachment_id: attachmentId,
        filename: row.name,
        mime_type: row.mimeType,
        size_bytes: row.sizeBytes,
        sha256,
        kind,
      };
    });
  }
}

export function normalizeAttachmentIds(
  value: readonly string[],
  maxPerTurn: number,
): string[] {
  if (value.length > maxPerTurn) {
    throw new NativeLiveAttachmentError(
      "ATTACHMENT_LIMIT_EXCEEDED",
      "Too many attachments in one turn.",
    );
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const id of value) {
    if (
      typeof id !== "string"
      || !UUID_PATTERN.test(id)
      || seen.has(id)
    ) {
      throw new NativeLiveAttachmentError(
        "INVALID_ATTACHMENT",
        "Attachment ids must be unique UUIDs.",
      );
    }
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function mapAttachment(
  row: typeof nativeLiveChatAttachments.$inferSelect,
): NativeLiveChatAttachment {
  return {
    attachmentId: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    kind: row.kind,
    status: row.status,
    objectKey: row.objectKey,
    boundMessageId: row.boundMessageId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

function runtimeAttachmentFromRow(
  row: typeof nativeLiveChatAttachments.$inferSelect,
): NativeLiveRuntimeAttachment {
  return {
    attachment_id: row.id,
    filename: row.filename,
    mime_type: row.mimeType,
    size_bytes: row.sizeBytes,
    sha256: row.sha256,
    kind: row.kind,
  };
}

function normalizeFilename(value: string): string {
  if (typeof value !== "string") {
    throw new NativeLiveAttachmentError(
      "INVALID_ATTACHMENT",
      "Attachment filename must be a string.",
    );
  }
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim();
  if (
    normalized.length === 0
    || normalized.length > 255
  ) {
    throw new NativeLiveAttachmentError(
      "INVALID_ATTACHMENT",
      "Attachment filename must contain 1-255 characters.",
    );
  }
  return normalized;
}

function normalizeMimeType(value: string): string {
  if (typeof value !== "string") {
    throw new NativeLiveAttachmentError(
      "INVALID_ATTACHMENT",
      "Attachment MIME type must be a string.",
    );
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0
    || normalized.length > 255
    || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(
      normalized,
    )
  ) {
    throw new NativeLiveAttachmentError(
      "INVALID_ATTACHMENT",
      "Attachment MIME type is invalid.",
    );
  }
  return normalized;
}

function normalizeSha256(value: string): string {
  const normalized =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : "";
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new NativeLiveAttachmentError(
      "INVALID_ATTACHMENT",
      "Attachment sha256 must be 64 lowercase hex characters.",
    );
  }
  return normalized;
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim()
    ? field
    : null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
