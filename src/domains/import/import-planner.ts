import { createOwnerFingerprint } from "../export/owner-fingerprint.js";
import type {
  ExportDiaryRecord,
  ExportTodoPaper,
} from "../export/export-types.js";
import {
  ImportValidationError,
  type ParsedImportPackage,
} from "./import-schema.js";
import { hashCanonical } from "./import-canonical.js";

export type ImportModule = "diary" | "todo";
export type ImportClassification =
  | "create"
  | "duplicate"
  | "conflict"
  | "invalid";

export type ImportCurrentState = {
  diary: ExportDiaryRecord[];
  todo: ExportTodoPaper[];
  foreign_diary_ids?: Set<string>;
};

export type ImportSummary = Record<
  ImportModule,
  {
    create: number;
    duplicate: number;
    conflict: number;
    invalid: number;
  }
>;

export type ImportPlanItem = {
  module: ImportModule;
  logical_key: string;
  classification: ImportClassification;
  record: ExportDiaryRecord | ExportTodoPaper;
  current_hash: string | null;
};

export type ImportPlan = {
  package_sha256: string;
  preview_fingerprint: string;
  can_execute: boolean;
  summary: ImportSummary;
  items: ImportPlanItem[];
};

const emptyCounts = () => ({
  create: 0,
  duplicate: 0,
  conflict: 0,
  invalid: 0,
});

function classify<T extends ExportDiaryRecord | ExportTodoPaper>(
  module: ImportModule,
  imported: T[],
  current: T[],
  key: (record: T) => string,
): ImportPlanItem[] {
  const occurrences = new Map<string, number>();
  for (const record of imported) {
    const logicalKey = key(record);
    occurrences.set(
      logicalKey,
      (occurrences.get(logicalKey) ?? 0) + 1,
    );
  }

  const items: ImportPlanItem[] = [];
  for (const record of imported) {
    const logicalKey = key(record);
    const existing = current.find(
      (candidate) => key(candidate) === logicalKey,
    );
    let classification: ImportClassification;

    if ((occurrences.get(logicalKey) ?? 0) > 1) {
      classification = "invalid";
    } else if (!existing) {
      classification = "create";
    } else if (
      hashCanonical(existing) === hashCanonical(record)
    ) {
      classification = "duplicate";
    } else {
      classification = "conflict";
    }

    items.push({
      module,
      logical_key: logicalKey,
      classification,
      record,
      current_hash: existing
        ? hashCanonical(existing)
        : null,
    });
  }
  return items;
}

function summarize(items: ImportPlanItem[]): ImportSummary {
  const summary = {
    diary: emptyCounts(),
    todo: emptyCounts(),
  } satisfies ImportSummary;

  for (const item of items) {
    summary[item.module][item.classification] += 1;
  }
  return summary;
}

export function buildImportPlan(
  parsed: ParsedImportPackage,
  userId: string,
  current: ImportCurrentState,
): ImportPlan {
  if (
    parsed.document.owner_fingerprint
    !== createOwnerFingerprint(userId)
  ) {
    throw new ImportValidationError(
      "IMPORT_OWNER_MISMATCH",
      "IMPORT_OWNER_MISMATCH",
    );
  }

  const items: ImportPlanItem[] = [];

  if (parsed.document.data.diary) {
    items.push(
      ...classify(
        "diary",
        parsed.document.data.diary,
        current.diary,
        (record) => `id:${record.id}`,
      ),
    );

    for (const item of items.filter(
      (candidate) =>
        candidate.module === "diary"
        && candidate.classification === "create",
    )) {
      if (
        current.foreign_diary_ids?.has(
          (item.record as ExportDiaryRecord).id,
        )
      ) {
        item.classification = "conflict";
      }
    }
  }

  if (parsed.document.data.todo) {
    items.push(
      ...classify(
        "todo",
        parsed.document.data.todo,
        current.todo,
        (record) =>
          `paper:${record.date}:${record.author}`,
      ),
    );
  }

  const summary = summarize(items);
  const fingerprint = hashCanonical({
    package_sha256: parsed.package_sha256,
    items: items.map(
      ({
        module,
        logical_key,
        classification,
        current_hash,
      }) => ({
        module,
        logical_key,
        classification,
        current_hash,
      }),
    ),
  });

  const hasConflict = items.some(
    (item) =>
      item.classification === "conflict"
      || item.classification === "invalid",
  );
  const hasCreate = items.some(
    (item) => item.classification === "create",
  );

  return {
    package_sha256: parsed.package_sha256,
    preview_fingerprint: fingerprint,
    can_execute: !hasConflict && hasCreate,
    summary,
    items,
  };
}
