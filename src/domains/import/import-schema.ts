import { createHash } from "node:crypto";
import { z } from "zod";
import type { ExportDocumentV2 } from "../export/export-types.js";

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
    message = code,
  ) {
    super(message);
    this.name = "ImportValidationError";
  }
}

const isoDateTime = z.string().datetime({ offset: true });
const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const uuid = z.string().uuid();
const author = z.union([z.literal("L"), z.literal("G"), z.null()]);
const boundedTags = z.array(z.string().max(50)).max(20);

const memoryRecord = z.object({
  id: uuid,
  category: z.enum(["profile", "preference", "goal", "project"]),
  key: z.string().min(1).max(100),
  content: z.string().min(1),
  tags: boundedTags,
  visibility: z.enum(["assistant", "private", "restricted"]),
  source: z.string().min(1).max(100),
  author,
  status: z.enum(["active", "archived"]),
  sort_order: z.number().int().nonnegative(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
}).strict();

const diaryRecord = z.object({
  id: uuid,
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  date: businessDate,
  tags: boundedTags,
  mood: z.string().max(50).nullable(),
  source: z.literal("chatgpt_mcp"),
  author,
  status: z.enum(["active", "archived"]),
  created_at: isoDateTime,
  updated_at: isoDateTime,
}).strict();

const taskRecord = z.object({
  id: uuid,
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  resume_status: z.enum(["pending", "in_progress", "completed", "cancelled"]).nullable(),
  lifecycle_status: z.enum(["active", "archived"]),
  author,
  priority: z.enum(["low", "normal", "high", "urgent"]),
  due_time: isoDateTime.nullable(),
  timezone: z.string().min(1).max(64),
  tags: boundedTags,
  created_at: isoDateTime,
  updated_at: isoDateTime,
  completed_at: isoDateTime.nullable(),
}).strict();

const todoEntry = z.object({
  id: z.string().min(1),
  kind: z.enum(["pending", "completed", "record"]),
  text: z.string().min(1),
}).strict();

const todoPaper = z.object({
  date: businessDate,
  author: z.enum(["L", "G"]),
  revision: z.number().int().nonnegative(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
  entries: z.array(todoEntry),
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
    memory: z.array(memoryRecord).optional(),
    diary: z.array(diaryRecord).optional(),
    task: z.array(taskRecord).optional(),
    todo: z.array(todoPaper).optional(),
  }).strict(),
  audit: z.object({
    lifecycle: z.array(lifecycleEvent),
    tool_activity: z.array(toolActivity),
  }).strict().optional(),
}).strict();

function assertBusinessInvariants(document: ExportDocumentV2): void {
  const included = Object.keys(document.data);
  if (included.length === 0) {
    throw new ImportValidationError("INVALID_IMPORT_FILE", "no supported module data");
  }
  for (const record of document.data.memory ?? []) {
    if (record.key.trim().length === 0 || record.content.trim().length === 0 || record.source.trim().length === 0) {
      throw new ImportValidationError("INVALID_IMPORT_FILE", "memory text must not be blank");
    }
  }
  for (const record of document.data.diary ?? []) {
    if (record.title.trim().length === 0 || record.content.trim().length === 0 || (record.mood !== null && record.mood.trim().length === 0)) {
      throw new ImportValidationError("INVALID_IMPORT_FILE", "diary text must not be blank");
    }
  }
  for (const record of document.data.task ?? []) {
    if (record.title.trim().length === 0 || record.description.trim().length === 0) {
      throw new ImportValidationError("INVALID_IMPORT_FILE", "task text must not be blank");
    }
    const terminal = record.status === "completed" || record.status === "cancelled";
    if (record.status === "completed" && record.completed_at === null) {
      throw new ImportValidationError("INVALID_IMPORT_FILE", "completed task requires completed_at");
    }
    if (record.status !== "completed" && record.completed_at !== null) {
      throw new ImportValidationError("INVALID_IMPORT_FILE", "only completed task may have completed_at");
    }
    if (terminal && !["pending", "in_progress"].includes(record.resume_status ?? "")) {
      throw new ImportValidationError("INVALID_IMPORT_FILE", "terminal task requires an active resume_status");
    }
    if (!terminal && record.resume_status !== null) {
      throw new ImportValidationError("INVALID_IMPORT_FILE", "active task status cannot have resume_status");
    }
  }
  for (const paper of document.data.todo ?? []) {
    const ids = new Set<string>();
    for (const entry of paper.entries) {
      if (entry.id.trim().length === 0 || entry.text.trim().length === 0 || ids.has(entry.id)) {
        throw new ImportValidationError("INVALID_IMPORT_FILE", "todo entries must have unique nonblank ids and text");
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
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input));
  } catch {
    throw new ImportValidationError("INVALID_IMPORT_FILE", "invalid JSON");
  }
  if (!value || typeof value !== "object" || (value as { schema_version?: unknown }).schema_version !== 2) {
    if (value && typeof value === "object" && (value as { schema_version?: unknown }).schema_version === 1) {
      throw new ImportValidationError("UNSUPPORTED_EXPORT_VERSION", "export v1 cannot be restored");
    }
    throw new ImportValidationError("INVALID_IMPORT_FILE", "invalid export version");
  }
  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) {
    throw new ImportValidationError("INVALID_IMPORT_FILE", "export schema validation failed");
  }
  const document = parsed.data as ExportDocumentV2;
  assertBusinessInvariants(document);
  return {
    document,
    package_sha256: createHash("sha256").update(input).digest("hex"),
    raw_bytes: input.byteLength,
  };
}

