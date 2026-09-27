import { createHash } from "node:crypto";
import { z } from "zod";
import { CONTENT_AUTHORS } from "../content-author.js";
import {
  PROJECT_RESOURCE_KINDS,
} from "../project-workspace/project-workspace-types.js";
import type {
  RestorableExportDocument,
} from "../export/export-types.js";
import {
  DIARY_MOOD_MAX_LENGTH,
  DIARY_TAGS_MAX_COUNT,
  DIARY_TITLE_MAX_LENGTH,
  MAX_IMPORT_AUDIT_EVENTS_PER_TYPE,
  MAX_IMPORT_RECORDS_PER_MODULE,
  MAX_TODO_ENTRIES,
} from "../resource-limits.js";

export const MAX_IMPORT_PACKAGE_BYTES = 50 * 1024 * 1024;

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
const nullableBounded = (max: number) =>
  z.string().max(max).nullable();

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

const projectWorkspaceRecord = z.object({
  id: uuid,
  name: z.string().min(1).max(200),
  description: nullableBounded(4000),
  version: z.number().int().min(1),
  created_at: isoDateTime,
  updated_at: isoDateTime,
}).strict();

const projectRecord = z.object({
  id: uuid,
  workspace_id: uuid,
  name: z.string().min(1).max(200),
  description: nullableBounded(4000),
  version: z.number().int().min(1),
  created_at: isoDateTime,
  updated_at: isoDateTime,
}).strict();

const projectResourceRecord = z.object({
  id: uuid,
  project_id: uuid,
  kind: z.enum(PROJECT_RESOURCE_KINDS),
  key: z.string().min(1).max(1000),
  title: nullableBounded(500),
  content: nullableBounded(1_000_000),
  metadata: z.record(z.string(), z.unknown()),
  version: z.number().int().min(1),
  created_at: isoDateTime,
  updated_at: isoDateTime,
}).strict();

const projectConversationRecord = z.object({
  project_id: uuid,
  conversation_id: uuid,
  added_at: isoDateTime,
}).strict();

const projectsBundle = z.object({
  workspaces: z.array(projectWorkspaceRecord).max(MAX_IMPORT_RECORDS_PER_MODULE),
  projects: z.array(projectRecord).max(MAX_IMPORT_RECORDS_PER_MODULE),
  resources: z.array(projectResourceRecord).max(MAX_IMPORT_RECORDS_PER_MODULE),
  conversations: z.array(projectConversationRecord).max(MAX_IMPORT_RECORDS_PER_MODULE),
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

const auditSchema = z.object({
  lifecycle: z.array(lifecycleEvent).max(MAX_IMPORT_AUDIT_EVENTS_PER_TYPE),
  tool_activity: z.array(toolActivity).max(MAX_IMPORT_AUDIT_EVENTS_PER_TYPE),
}).strict();

const dataV2Schema = z.object({
  diary: z.array(diaryRecord).max(MAX_IMPORT_RECORDS_PER_MODULE).optional(),
  todo: z.array(todoPaper).max(MAX_IMPORT_RECORDS_PER_MODULE).optional(),
}).strict();

const dataV3Schema = z.object({
  diary: z.array(diaryRecord).max(MAX_IMPORT_RECORDS_PER_MODULE).optional(),
  todo: z.array(todoPaper).max(MAX_IMPORT_RECORDS_PER_MODULE).optional(),
  projects: projectsBundle.optional(),
}).strict();

const documentV2Schema = z.object({
  schema_version: z.literal(2),
  owner_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  exported_at: isoDateTime,
  data: dataV2Schema,
  audit: auditSchema.optional(),
}).strict();

const documentV3Schema = z.object({
  schema_version: z.literal(3),
  owner_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  exported_at: isoDateTime,
  data: dataV3Schema,
  audit: auditSchema.optional(),
}).strict();

function assertBusinessInvariants(document: RestorableExportDocument): void {
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

  if (document.schema_version === 3 && document.data.projects) {
    for (const workspace of document.data.projects.workspaces) {
      if (workspace.name.trim().length === 0) {
        throw new ImportValidationError(
          "INVALID_IMPORT_FILE",
          "workspace name must not be blank",
        );
      }
    }
    for (const project of document.data.projects.projects) {
      if (project.name.trim().length === 0) {
        throw new ImportValidationError(
          "INVALID_IMPORT_FILE",
          "project name must not be blank",
        );
      }
    }
    for (const resource of document.data.projects.resources) {
      if (resource.key.trim().length === 0) {
        throw new ImportValidationError(
          "INVALID_IMPORT_FILE",
          "project resource key must not be blank",
        );
      }
    }
  }
}

export type ParsedImportPackage = {
  document: RestorableExportDocument;
  package_sha256: string;
  raw_bytes: number;
};

export function parseImportPackage(input: Uint8Array): ParsedImportPackage {
  if (input.byteLength > MAX_IMPORT_PACKAGE_BYTES) {
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

  if (!value || typeof value !== "object") {
    throw new ImportValidationError(
      "INVALID_IMPORT_FILE",
      "invalid export document",
    );
  }

  const version = (value as { schema_version?: unknown }).schema_version;
  if (version === 1) {
    throw new ImportValidationError(
      "UNSUPPORTED_EXPORT_VERSION",
      "export v1 cannot be restored",
    );
  }

  const schema =
    version === 2
      ? documentV2Schema
      : version === 3
        ? documentV3Schema
        : null;
  if (!schema) {
    throw new ImportValidationError(
      "INVALID_IMPORT_FILE",
      "invalid export version",
    );
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ImportValidationError(
      "INVALID_IMPORT_FILE",
      "export schema validation failed",
    );
  }

  const document = parsed.data as RestorableExportDocument;
  assertBusinessInvariants(document);

  return {
    document,
    package_sha256: createHash("sha256").update(input).digest("hex"),
    raw_bytes: input.byteLength,
  };
}
