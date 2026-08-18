import { createOwnerFingerprint } from "../export/owner-fingerprint.js";
import type {
  ExportDiaryRecord,
  ExportMemoryRecord,
  ExportTaskRecord,
  ExportTodoPaper,
} from "../export/export-types.js";
import { ImportValidationError, type ParsedImportPackage } from "./import-schema.js";
import { hashCanonical } from "./import-canonical.js";

export type ImportModule = "memory" | "diary" | "task" | "todo";
export type ImportClassification = "create" | "duplicate" | "conflict" | "invalid";
export type ImportCurrentState = {
  memory: ExportMemoryRecord[];
  diary: ExportDiaryRecord[];
  task: ExportTaskRecord[];
  todo: ExportTodoPaper[];
  foreign_memory_ids?: Set<string>;
  foreign_diary_ids?: Set<string>;
  foreign_task_ids?: Set<string>;
};
export type ImportSummary = Record<ImportModule, {
  create: number;
  duplicate: number;
  conflict: number;
  invalid: number;
}>;
export type ImportPlanItem = {
  module: ImportModule;
  logical_key: string;
  classification: ImportClassification;
  record: ExportMemoryRecord | ExportDiaryRecord | ExportTaskRecord | ExportTodoPaper;
  current_hash: string | null;
};
export type ImportPlan = {
  package_sha256: string;
  preview_fingerprint: string;
  can_execute: boolean;
  summary: ImportSummary;
  items: ImportPlanItem[];
};

const emptyCounts = () => ({ create: 0, duplicate: 0, conflict: 0, invalid: 0 });

function classify<T>(
  module: ImportModule,
  imported: T[],
  current: T[],
  key: (record: T) => string,
): ImportPlanItem[] {
  const occurrences = new Map<string, number>();
  for (const record of imported) occurrences.set(key(record), (occurrences.get(key(record)) ?? 0) + 1);
  const items: ImportPlanItem[] = [];
  for (const record of imported) {
    const logicalKey = key(record);
    const existing = current.find((candidate) => key(candidate) === logicalKey);
    let classification: ImportClassification;
    if ((occurrences.get(logicalKey) ?? 0) > 1) classification = "invalid";
    else if (!existing) classification = "create";
    else if (hashCanonical(existing) === hashCanonical(record)) classification = "duplicate";
    else classification = "conflict";
    items.push({
      module,
      logical_key: logicalKey,
      classification,
      record: record as unknown as ImportPlanItem["record"],
      current_hash: existing ? hashCanonical(existing) : null,
    });
  }
  return items;
}

function memoryItems(imported: ExportMemoryRecord[], current: ExportMemoryRecord[]): ImportPlanItem[] {
  const occurrences = new Map<string, number>();
  const keyOccurrences = new Map<string, number>();
  for (const record of imported) occurrences.set(record.id, (occurrences.get(record.id) ?? 0) + 1);
  for (const record of imported) keyOccurrences.set(record.key, (keyOccurrences.get(record.key) ?? 0) + 1);
  return imported.map((record) => {
    const idKey = `id:${record.id}`;
    const existingById = current.find((candidate) => candidate.id === record.id);
    const existingByKey = current.find((candidate) => candidate.key === record.key);
    const existing = existingById ?? existingByKey;
    const classification: ImportClassification = (occurrences.get(record.id) ?? 0) > 1 || (keyOccurrences.get(record.key) ?? 0) > 1
      ? "invalid"
      : existingById
        ? hashCanonical(existingById) === hashCanonical(record) ? "duplicate" : "conflict"
        : existingByKey ? "conflict" : "create";
    return {
      module: "memory",
      logical_key: idKey,
      classification,
      record,
      current_hash: existing ? hashCanonical(existing) : null,
    };
  });
}

function summarize(items: ImportPlanItem[]): ImportSummary {
  const summary = {
    memory: emptyCounts(), diary: emptyCounts(), task: emptyCounts(), todo: emptyCounts(),
  } satisfies ImportSummary;
  for (const item of items) summary[item.module][item.classification] += 1;
  return summary;
}

export function buildImportPlan(
  parsed: ParsedImportPackage,
  userId: string,
  current: ImportCurrentState,
): ImportPlan {
  if (parsed.document.owner_fingerprint !== createOwnerFingerprint(userId)) {
    throw new ImportValidationError("IMPORT_OWNER_MISMATCH", "IMPORT_OWNER_MISMATCH");
  }
  const items: ImportPlanItem[] = [];
  if (parsed.document.data.memory) {
    items.push(...memoryItems(parsed.document.data.memory, current.memory));
    for (const item of items.filter((candidate) => candidate.module === "memory" && candidate.classification === "create")) {
      if (current.foreign_memory_ids?.has((item.record as ExportMemoryRecord).id)) item.classification = "conflict";
    }
  }
  if (parsed.document.data.diary) {
    items.push(...classify("diary", parsed.document.data.diary, current.diary, (record) => `id:${record.id}`));
    for (const item of items.filter((candidate) => candidate.module === "diary" && candidate.classification === "create")) {
      if (current.foreign_diary_ids?.has((item.record as ExportDiaryRecord).id)) item.classification = "conflict";
    }
  }
  if (parsed.document.data.task) {
    items.push(...classify("task", parsed.document.data.task, current.task, (record) => `id:${record.id}`));
    for (const item of items.filter((candidate) => candidate.module === "task" && candidate.classification === "create")) {
      if (current.foreign_task_ids?.has((item.record as ExportTaskRecord).id)) item.classification = "conflict";
    }
  }
  if (parsed.document.data.todo) items.push(...classify("todo", parsed.document.data.todo, current.todo, (record) => `paper:${record.date}:${record.author}`));
  const summary = summarize(items);
  const fingerprint = hashCanonical({
    package_sha256: parsed.package_sha256,
    items: items.map(({ module, logical_key, classification, current_hash }) => ({ module, logical_key, classification, current_hash })),
  });
  const hasConflict = items.some((item) => item.classification === "conflict" || item.classification === "invalid");
  const hasCreate = items.some((item) => item.classification === "create");
  return {
    package_sha256: parsed.package_sha256,
    preview_fingerprint: fingerprint,
    can_execute: !hasConflict && hasCreate,
    summary,
    items,
  };
}
