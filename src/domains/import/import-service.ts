import type {
  ExportDiaryRecord,
  ExportDocumentV2,
  ExportMemoryRecord,
  ExportTaskRecord,
  ExportTodoPaper,
} from "../export/export-types.js";
import {
  buildImportPlan,
  type ImportCurrentState,
  type ImportModule,
  type ImportPlan,
  type ImportPlanItem,
  type ImportSummary,
} from "./import-planner.js";
import { hashCanonical } from "./import-canonical.js";
import {
  ImportValidationError,
  parseImportPackage,
  type ParsedImportPackage,
} from "./import-schema.js";
import type { ImportRepository } from "./import-repository.js";

export type ImportPreview = {
  package_sha256: string;
  preview_fingerprint: string;
  summary: ImportSummary;
  can_execute: boolean;
};

export type ImportExecution = {
  package_sha256: string;
  preview_fingerprint: string;
  summary: ImportSummary;
};

function toPreview(plan: ImportPlan): ImportPreview {
  return {
    package_sha256: plan.package_sha256,
    preview_fingerprint: plan.preview_fingerprint,
    summary: plan.summary,
    can_execute: plan.can_execute,
  };
}

function includedModules(document: ExportDocumentV2): Set<ImportModule> {
  return new Set((Object.keys(document.data) as ImportModule[]));
}

function hasExactCreatedValue(item: ImportPlanItem, state: ImportCurrentState): boolean {
  if (item.module === "memory") {
    const record = item.record as ExportMemoryRecord;
    return state.memory.some((candidate) => candidate.id === record.id && hashCanonical(candidate) === hashCanonical(record));
  }
  if (item.module === "diary") {
    const record = item.record as ExportDiaryRecord;
    return state.diary.some((candidate) => candidate.id === record.id && hashCanonical(candidate) === hashCanonical(record));
  }
  if (item.module === "task") {
    const record = item.record as ExportTaskRecord;
    return state.task.some((candidate) => candidate.id === record.id && hashCanonical(candidate) === hashCanonical(record));
  }
  const record = item.record as ExportTodoPaper;
  return state.todo.some((paper) => paper.date === record.date && paper.author === record.author && hashCanonical(paper) === hashCanonical(record));
}

function hasDatabaseErrorCode(error: unknown, code: string): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && (current as { code?: unknown }).code === code) return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

export class ImportService {
  constructor(private readonly repository: ImportRepository) {}

  async preview(raw: Uint8Array, userId: string): Promise<ImportPreview> {
    const parsed = parseImportPackage(raw);
    const current = await this.repository.readCurrentState(userId);
    return toPreview(buildImportPlan(parsed, userId, current));
  }

  async execute(raw: Uint8Array, userId: string, expectedPreviewFingerprint: string): Promise<ImportExecution> {
    const parsed = parseImportPackage(raw);
    if (!/^[0-9a-f]{64}$/u.test(expectedPreviewFingerprint)) {
      throw new ImportValidationError("IMPORT_PREVIEW_STALE", "IMPORT_PREVIEW_STALE");
    }
    try {
      return await this.repository.withTransaction(async (transaction) => {
        const current = await transaction.readCurrentState(userId);
        const plan = buildImportPlan(parsed, userId, current);
        if (plan.preview_fingerprint !== expectedPreviewFingerprint) {
          throw new ImportValidationError("IMPORT_PREVIEW_STALE", "IMPORT_PREVIEW_STALE");
        }
        if (plan.items.some((item) => item.classification === "conflict" || item.classification === "invalid")) {
          throw new ImportValidationError("IMPORT_CONFLICT", "IMPORT_CONFLICT");
        }
        const creates = plan.items.filter((item) => item.classification === "create");
        if (creates.length === 0) {
          throw new ImportValidationError("IMPORT_NOTHING_TO_RESTORE", "IMPORT_NOTHING_TO_RESTORE");
        }
        for (const item of creates) {
          if (item.module === "memory") await transaction.insertMemory(userId, item.record as ExportMemoryRecord);
          if (item.module === "diary") await transaction.insertDiary(userId, item.record as ExportDiaryRecord);
          if (item.module === "task") await transaction.insertTask(userId, item.record as ExportTaskRecord);
          if (item.module === "todo") await transaction.insertTodo(userId, item.record as ExportTodoPaper);
        }
        const reread = await transaction.rereadCreatedState(userId, includedModules(parsed.document));
        if (creates.some((item) => !hasExactCreatedValue(item, reread))) {
          throw new Error("IMPORT_VERIFY_FAILED");
        }
        await transaction.recordAuditRun(userId, {
          package_sha256: plan.package_sha256,
          preview_fingerprint: plan.preview_fingerprint,
          schema_version: parsed.document.schema_version,
          summary: plan.summary,
        });
        return {
          package_sha256: plan.package_sha256,
          preview_fingerprint: plan.preview_fingerprint,
          summary: plan.summary,
        };
      });
    } catch (error) {
      if (error instanceof ImportValidationError) throw error;
      if (error instanceof Error && error.message === "IMPORT_VERIFY_FAILED") {
        throw new ImportValidationError("IMPORT_CONFLICT", "IMPORT_CONFLICT");
      }
      if (hasDatabaseErrorCode(error, "23505")) {
        throw new ImportValidationError("IMPORT_CONFLICT", "IMPORT_CONFLICT");
      }
      if (hasDatabaseErrorCode(error, "40001")) {
        throw new ImportValidationError("IMPORT_PREVIEW_STALE", "IMPORT_PREVIEW_STALE");
      }
      throw error;
    }
  }
}
