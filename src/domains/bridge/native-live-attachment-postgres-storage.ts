import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  and,
  eq,
  sql,
} from "drizzle-orm";
import type {
  createDatabase,
} from "../../database/client.js";
import {
  nativeLiveChatAttachments,
} from "../../database/schema.js";
import type {
  NativeLiveAttachmentDownloadSlot,
  NativeLiveAttachmentObjectHead,
  NativeLiveAttachmentObjectStore,
  NativeLiveAttachmentUploadSlot,
} from "./native-live-attachment-storage.js";

type Database = ReturnType<typeof createDatabase>["db"];

type TransferMethod = "PUT" | "GET";

type TransferClaims = {
  version: 1;
  method: TransferMethod;
  objectKey: string;
  expiresAt: number;
};

export class PostgresAttachmentTransferError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "PostgresAttachmentTransferError";
  }
}

export class PostgresInlineAttachmentObjectStore
implements NativeLiveAttachmentObjectStore {
  private readonly signingKey: Buffer;
  private readonly now: () => Date;

  constructor(
    private readonly db: Database,
    private readonly config: {
      signingSecret: string;
      transferTtlSeconds: number;
      maxFileBytes: number;
      maxTotalBytes: number;
      now?: () => Date;
      fallbackObjectStore?: NativeLiveAttachmentObjectStore;
      fetchImpl?: typeof fetch;
    },
  ) {
    if (!config.signingSecret.trim()) {
      throw new Error(
        "Postgres attachment signing secret must not be blank.",
      );
    }
    if (
      !Number.isSafeInteger(config.transferTtlSeconds)
      || config.transferTtlSeconds < 60
      || config.transferTtlSeconds > 3_600
    ) {
      throw new Error(
        "Postgres attachment transfer TTL must be 60-3600 seconds.",
      );
    }
    if (
      !Number.isSafeInteger(config.maxFileBytes)
      || config.maxFileBytes <= 0
      || !Number.isSafeInteger(config.maxTotalBytes)
      || config.maxTotalBytes < config.maxFileBytes
    ) {
      throw new Error(
        "Postgres attachment storage limits are invalid.",
      );
    }
    this.signingKey = createHash("sha256")
      .update(
        "leileios:postgres-attachment-transfer:v1\n"
        + config.signingSecret,
        "utf8",
      )
      .digest();
    this.now = config.now ?? (() => new Date());
  }

  get transferMaxFileBytes(): number {
    return this.config.maxFileBytes;
  }

  createUploadSlot(input: {
    objectKey: string;
    mimeType: string;
    sha256: string;
  }): NativeLiveAttachmentUploadSlot {
    return {
      url: this.transferUrl("PUT", input.objectKey),
      method: "PUT",
      headers: {
        "content-type": input.mimeType,
        "x-leileios-sha256": input.sha256,
      },
      expiresAt: this.expiresAt(),
    };
  }

  createDownloadSlot(input: {
    objectKey: string;
  }): NativeLiveAttachmentDownloadSlot {
    return {
      url: this.transferUrl("GET", input.objectKey),
      method: "GET",
      headers: {},
      expiresAt: this.expiresAt(),
    };
  }

  async headObject(input: {
    objectKey: string;
  }): Promise<NativeLiveAttachmentObjectHead | null> {
    const [row] = await this.db
      .select({
        content: nativeLiveChatAttachments.content,
        mimeType: nativeLiveChatAttachments.mimeType,
      })
      .from(nativeLiveChatAttachments)
      .where(
        eq(
          nativeLiveChatAttachments.objectKey,
          input.objectKey,
        ),
      )
      .limit(1);
    if (!row?.content) return null;

    return {
      sizeBytes: row.content.byteLength,
      mimeType: row.mimeType,
      sha256: createHash("sha256")
        .update(row.content)
        .digest("hex"),
    };
  }

  async deleteObject(input: {
    objectKey: string;
  }): Promise<void> {
    await this.db
      .update(nativeLiveChatAttachments)
      .set({
        content: null,
        updatedAt: this.now(),
      })
      .where(
        eq(
          nativeLiveChatAttachments.objectKey,
          input.objectKey,
        ),
      );
  }

  authorizeTransfer(
    token: string,
    method: TransferMethod,
  ): TransferClaims {
    const separator = token.lastIndexOf(".");
    if (separator <= 0 || separator === token.length - 1) {
      throw new PostgresAttachmentTransferError(
        401,
        "Attachment transfer token is invalid.",
      );
    }
    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const expected = createHmac("sha256", this.signingKey)
      .update(payload, "utf8")
      .digest("base64url");
    const actualBytes = Buffer.from(signature, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    if (
      actualBytes.byteLength !== expectedBytes.byteLength
      || !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      throw new PostgresAttachmentTransferError(
        401,
        "Attachment transfer token signature is invalid.",
      );
    }

    let claims: unknown;
    try {
      claims = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      );
    } catch {
      throw new PostgresAttachmentTransferError(
        401,
        "Attachment transfer token payload is invalid.",
      );
    }
    if (
      !claims
      || typeof claims !== "object"
      || Array.isArray(claims)
    ) {
      throw new PostgresAttachmentTransferError(
        401,
        "Attachment transfer token payload is invalid.",
      );
    }
    const record = claims as Record<string, unknown>;
    if (
      record.version !== 1
      || record.method !== method
      || typeof record.objectKey !== "string"
      || !record.objectKey.trim()
      || typeof record.expiresAt !== "number"
      || !Number.isSafeInteger(record.expiresAt)
    ) {
      throw new PostgresAttachmentTransferError(
        401,
        "Attachment transfer token claims are invalid.",
      );
    }
    const nowSeconds = Math.floor(
      this.now().getTime() / 1_000,
    );
    if (record.expiresAt < nowSeconds) {
      throw new PostgresAttachmentTransferError(
        410,
        "Attachment transfer token has expired.",
      );
    }
    return {
      version: 1,
      method,
      objectKey: record.objectKey,
      expiresAt: record.expiresAt,
    };
  }

  async putTransfer(input: {
    token: string;
    bytes: Buffer;
    contentType: string | null;
    sha256Header: string | null;
  }): Promise<void> {
    const claims = this.authorizeTransfer(
      input.token,
      "PUT",
    );
    if (
      input.bytes.byteLength <= 0
      || input.bytes.byteLength > this.config.maxFileBytes
    ) {
      throw new PostgresAttachmentTransferError(
        413,
        "Attachment payload is outside the allowed size limit.",
      );
    }

    await this.db.transaction(
      async (transaction) => {
        const [row] = await transaction
          .select({
            id: nativeLiveChatAttachments.id,
            userId: nativeLiveChatAttachments.userId,
            mimeType: nativeLiveChatAttachments.mimeType,
            sizeBytes: nativeLiveChatAttachments.sizeBytes,
            sha256: nativeLiveChatAttachments.sha256,
            status: nativeLiveChatAttachments.status,
            expiresAt: nativeLiveChatAttachments.expiresAt,
            content: nativeLiveChatAttachments.content,
          })
          .from(nativeLiveChatAttachments)
          .where(
            eq(
              nativeLiveChatAttachments.objectKey,
              claims.objectKey,
            ),
          )
          .for("update")
          .limit(1);

        if (!row) {
          throw new PostgresAttachmentTransferError(
            404,
            "Attachment upload target was not found.",
          );
        }
        if (row.status !== "uploading") {
          if (
            row.content
            && row.content.byteLength === input.bytes.byteLength
            && createHash("sha256")
              .update(row.content)
              .digest("hex") === row.sha256
          ) {
            return;
          }
          throw new PostgresAttachmentTransferError(
            409,
            "Attachment upload target is not writable.",
          );
        }
        if (row.expiresAt.getTime() <= this.now().getTime()) {
          throw new PostgresAttachmentTransferError(
            410,
            "Attachment upload target has expired.",
          );
        }

        const normalizedContentType =
          normalizeMimeType(input.contentType);
        if (
          !normalizedContentType
          || normalizedContentType !== row.mimeType.toLowerCase()
        ) {
          throw new PostgresAttachmentTransferError(
            400,
            "Attachment MIME type does not match metadata.",
          );
        }
        const headerSha =
          input.sha256Header?.trim().toLowerCase() ?? "";
        if (headerSha !== row.sha256) {
          throw new PostgresAttachmentTransferError(
            400,
            "Attachment checksum header does not match metadata.",
          );
        }
        if (input.bytes.byteLength !== row.sizeBytes) {
          throw new PostgresAttachmentTransferError(
            400,
            "Attachment size does not match metadata.",
          );
        }
        const actualSha = createHash("sha256")
          .update(input.bytes)
          .digest("hex");
        if (actualSha !== row.sha256) {
          throw new PostgresAttachmentTransferError(
            400,
            "Attachment checksum does not match metadata.",
          );
        }

        const sniffed = sniffMimeType(input.bytes);
        if (
          sniffed
          && !mimeTypesCompatible(
            row.mimeType.toLowerCase(),
            sniffed,
          )
        ) {
          throw new PostgresAttachmentTransferError(
            400,
            "Attachment content does not match declared MIME type.",
          );
        }

        const totalRows = await transaction.execute<{
          total: string | number;
        }>(sql`
          SELECT COALESCE(
            SUM(octet_length(content)),
            0
          ) AS total
          FROM native_live_chat_attachments
          WHERE user_id = ${row.userId}::uuid
            AND content IS NOT NULL
        `);
        const total = Number(totalRows[0]?.total ?? 0);
        const existingBytes =
          row.content?.byteLength ?? 0;
        if (
          !Number.isSafeInteger(total)
          || total - existingBytes + input.bytes.byteLength
            > this.config.maxTotalBytes
        ) {
          throw new PostgresAttachmentTransferError(
            413,
            "Attachment storage pool limit would be exceeded.",
          );
        }

        await transaction
          .update(nativeLiveChatAttachments)
          .set({
            content: input.bytes,
            updatedAt: this.now(),
          })
          .where(
            and(
              eq(nativeLiveChatAttachments.id, row.id),
              eq(
                nativeLiveChatAttachments.objectKey,
                claims.objectKey,
              ),
            ),
          );
      },
      { isolationLevel: "serializable" },
    );
  }

  async getTransfer(input: {
    token: string;
  }): Promise<{
    bytes: Buffer;
    mimeType: string;
    filename: string;
  }> {
    const claims = this.authorizeTransfer(
      input.token,
      "GET",
    );
    const [row] = await this.db
      .select({
        content: nativeLiveChatAttachments.content,
        mimeType: nativeLiveChatAttachments.mimeType,
        filename: nativeLiveChatAttachments.filename,
        status: nativeLiveChatAttachments.status,
        sizeBytes: nativeLiveChatAttachments.sizeBytes,
        sha256: nativeLiveChatAttachments.sha256,
      })
      .from(nativeLiveChatAttachments)
      .where(
        eq(
          nativeLiveChatAttachments.objectKey,
          claims.objectKey,
        ),
      )
      .limit(1);

    if (
      !row
      || (row.status !== "ready" && row.status !== "bound")
    ) {
      throw new PostgresAttachmentTransferError(
        404,
        "Attachment content is not available.",
      );
    }
    let bytes = row.content;
    if (bytes === null && this.config.fallbackObjectStore) {
      // Preserve already-issued GET capabilities when migration clears inline
      // content between slot creation and transfer. PUT never falls back.
      const slot = this.config.fallbackObjectStore.createDownloadSlot({ objectKey: claims.objectKey });
      const response = await (this.config.fetchImpl ?? fetch)(slot.url, {
        method: slot.method, headers: slot.headers, signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new PostgresAttachmentTransferError(502, "Migrated attachment download failed.");
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== row.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
        throw new PostgresAttachmentTransferError(502, "Migrated attachment content does not match metadata.");
      }
    }
    if (!bytes) throw new PostgresAttachmentTransferError(404, "Attachment content is not available.");
    return {
      bytes,
      mimeType: row.mimeType,
      filename: row.filename,
    };
  }

  private transferUrl(
    method: TransferMethod,
    objectKey: string,
  ): string {
    const expiresAt = Math.floor(
      (
        this.now().getTime()
        + this.config.transferTtlSeconds * 1_000
      ) / 1_000,
    );
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        method,
        objectKey,
        expiresAt,
      } satisfies TransferClaims),
      "utf8",
    ).toString("base64url");
    const signature = createHmac("sha256", this.signingKey)
      .update(payload, "utf8")
      .digest("base64url");
    return (
      "/api/v1/native-live/attachment-transfer/"
      + payload
      + "."
      + signature
    );
  }

  private expiresAt(): string {
    return new Date(
      this.now().getTime()
      + this.config.transferTtlSeconds * 1_000,
    ).toISOString();
  }
}

function normalizeMimeType(value: string | null): string | null {
  const normalized = value
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return normalized || null;
}

function mimeTypesCompatible(
  declared: string,
  sniffed: string,
): boolean {
  if (declared === sniffed) return true;
  if (
    sniffed === "application/zip"
    && (
      declared ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      || declared ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      || declared ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
  ) {
    return true;
  }
  return false;
}

function sniffMimeType(bytes: Buffer): string | null {
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) return "image/png";
  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) return "image/jpeg";
  if (
    bytes.length >= 6
    && (
      bytes.subarray(0, 6).toString("ascii") === "GIF87a"
      || bytes.subarray(0, 6).toString("ascii") === "GIF89a"
    )
  ) return "image/gif";
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (
    bytes.length >= 5
    && bytes.subarray(0, 5).toString("ascii") === "%PDF-"
  ) return "application/pdf";
  if (
    bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (
      (bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08)
    )
  ) return "application/zip";
  return null;
}
