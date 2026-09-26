import { createHash } from "node:crypto";
import { z } from "zod";
import { CONTENT_AUTHORS } from "../content-author.js";
import type { ExportDocumentV2 } from "../export/export-types.js";
import {
  DIARY_MOOD_MAX_LENGTH,
  DIARY_TAGS_MAX_COUNT,
  DIARY_TITLE_MAX_LENGTH,
  MAX_IMPORT_AUDIT_EVENTS_PER_TYPE,
  MAX_IMPORT_RECORDS_PER_MODULE,
  MAX_TODO_ENTRIES,
} from "../resource-limits.js";

export type ImportErrorCode =
  | "INVALID_IMPORT_FILE"
  | "UNSUPPORTED_EXPORT_VERSION"
  | "IMPORT_OWNER_MISMATCH"
  | "IMPORT_CONFLICT"
  | "IMPORT_PREVIEW_STALE"
  | "IMPORT_NOTHING_TO_RESTORE"
  | "IMPORT_TOO_LARGE"
  | "IMPORT_UNAVAILABLE";

export class ImportValidationError extends Error {
  constructor(
    public readonly code: ImportErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ImportValidationError";
  }
}

const isoDateTime = z.string().datetime({ offset: true });
const businessDate = z.string().refine((value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
});
const uuid = z.string().uuid();
const author = z.enum(CONTENT_AUTHORS).nullable();

// Restore accepts the full DB text payload for unbounded text[]/text columns.
// The raw package limit remains the outer resource bound so historical exports
// are not narrowed to today's live-write limits.
const diaryTags = z.array(z.string().min(1)).max(DIARY_TAGS_MAX_COUNT);

const diaryRecord = z.object({
  id: uuid,
  title: z.string().min(1).max(DIARY_TITLE_MAX_LENGTH),
  content: z.string().min(1),
  date: businessDate,
  tags: diaryTags,
  mood: z.string().max(DIARY_MOOD_MAX_LENGTH).nullable(),
  source: z.literal("chatgpt_mcp"),
  author,
  status: z.enum(["active", "archived"]),
  created_at: isoDateTime,
  updated_at: isoDateTime,
}).strict();

const todoEntry = z.object({
  id: z.string().min(1),
  kind: z.enum(["pending", "completed", "record"]),
  text: z.string().min(1),
}).strict();

const todoPaper = z.object({
  date: businessDate,
  author: z.enum(CONTENT_AUTHORS),
  revision: z.number().int().nonnegative(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
  entries: z.array(todoEntry).max(MAX_TODO_ENTRIES),
}).strict();

const lifecycleEvent = z.object({
  id: uuid,
  resource_type: z.string().min(1).max(32),
  resource_id: uuid,
  action: z.string().min(1).max(32),
  actor_type: z.string().min(1).max(32),
  channel: z.string().min(1).max(32),
  created_at: isoDateTime,
}).strict();

const toolActivity = z.object({
  id: uuid,
  tool_name: z.string().min(1).max(100),
  operation: z.string().min(1).max(50),
  resource_type: z.string().min(1).max(50),
  resource_id: uuid.nullable(),
  status: z.enum(["success", "rejected", "error"]),
  error_code: z.string().max(100).nullable(),
  created_at: isoDateTime,
}).strict();

const documentSchema = z.object({
  schema_version: z.number().int(),
  owner_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  exported_at: isoDateTime,
  data: z.object({
    diary: z.array(diaryRecord).max(MAX_IMPORT_RECORDS_PER_MODULE).optional(),
    todo: z.array(todoPaper).max(MAX_IMPORT_RECORDS_PER_MODULE).optional(),
  }).strict(),
  audit: z.object({
    lifecycle: z.array(lifecycleEvent).max(MAX_IMPORT_AUDIT_EVENTS_PER_TYPE),
    tool_activity: z.array(toolActivity).max(MAX_IMPORT_AUDIT_EVENTS_PER_TYPE),
  }).strict().optional(),
}).strict();

function assertBusinessInvariants(document: ExportDocumentV2): void {
  const included = Object.keys(document.data);
  if (included.length === 0) {
    throw new ImportValidationError(
      "INVALID_IMPORT_FILE",
      "no supported module data",
    );
  }

  for (const record of document.data.diary ?? []) {
    if (
      record.title.trim().length === 0
      || record.content.trim().length === 0
      || (
        record.mood !== null
        && record.mood.trim().length === 0
      )
    ) {
      throw new ImportValidationError(
        "INVALID_IMPORT_FILE",
        "diary text must not be blank",
      );
    }
  }

  for (const paper of document.data.todo ?? []) {
    const ids = new Set<string>();
    for (const entry of paper.entries) {
      if (
        entry.id.trim().length === 0
        || entry.text.trim().length === 0
        || ids.has(entry.id)
      ) {
        throw new ImportValidationError(
          "INVALID_IMPORT_FILE",
          "todo entries must have unique nonblank ids and text",
        );
      }
      ids.add(entry.id);
    }
  }
}

export type ParsedImportPackage = {
  document: ExportDocumentV2;
  package_sha256: string;
  raw_bytes: number;
};

export function parseImportPackage(input: Uint8Array): ParsedImportPackage {
  if (input.byteLength > 10 * 1024 * 1024) {
    throw new ImportValidationError("IMPORT_TOO_LARGE", "IMPORT_TOO_LARGE");
  }

  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(input),
    );
  } catch {
    throw new ImportValidationError(
      "INVALID_IMPORT_FILE",
      "invalid JSON",
    );
  }

  if (
    !value
    || typeof value !== "object"
    || (value as { schema_version?: unknown }).schema_version !== 2
  ) {
    if (
      value
      && typeof value === "object"
      && (value as { schema_version?: unknown }).schema_version === 1
    ) {
      throw new ImportValidationError(
        "UNSUPPORTED_EXPORT_VERSION",
        "export v1 cannot be restored",
      );
    }
    throw new ImportValidationError(
      "INVALID_IMPORT_FILE",
      "invalid export version",
    );
  }

  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) {
    throw new ImportValidationError(
      "INVALID_IMPORT_FILE",
      "export schema validation failed",
    );
  }

  const document = parsed.data as ExportDocumentV2;
  assertBusinessInvariants(document);

  return {
    document,
    package_sha256: createHash("sha256").update(input).digest("hex"),
    raw_bytes: input.byteLength,
  };
}
