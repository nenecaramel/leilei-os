import { createOwnerFingerprint } from "../export/owner-fingerprint.js";
import type {
  ExportDiaryRecord,
  ExportMindStateRecord,
  ExportProjectConversationRecord,
  ExportProjectRecord,
  ExportProjectResourceRecord,
  ExportProjectsBundle,
  ExportProjectWorkspaceRecord,
  ExportTodoPaper,
} from "../export/export-types.js";
import {
  ImportValidationError,
  type ParsedImportPackage,
} from "./import-schema.js";
import { hashCanonical } from "./import-canonical.js";

export type ImportModule = "diary" | "todo" | "projects" | "mind";
export type ImportClassification =
  | "create"
  | "duplicate"
  | "conflict"
  | "invalid";

export type ImportCounts = {
  create: number;
  duplicate: number;
  conflict: number;
  invalid: number;
};

export type ImportCurrentState = {
  diary: ExportDiaryRecord[];
  todo: ExportTodoPaper[];
  projects?: ExportProjectsBundle;
  mind?: ExportMindStateRecord[];
  foreign_diary_ids?: Set<string>;
  foreign_workspace_ids?: Set<string>;
  foreign_project_ids?: Set<string>;
  foreign_project_resource_ids?: Set<string>;
  foreign_mind_ids?: Set<string>;
  native_live_conversation_ids?: Set<string>;
};

export type ImportSummary = {
  diary: ImportCounts;
  todo: ImportCounts;
  projects?: ImportCounts;
  mind?: ImportCounts;
};

export type ProjectRestoreRecord =
  | {
      entity: "workspace";
      value: ExportProjectWorkspaceRecord;
    }
  | {
      entity: "project";
      value: ExportProjectRecord;
    }
  | {
      entity: "resource";
      value: ExportProjectResourceRecord;
    }
  | {
      entity: "conversation";
      value: ExportProjectConversationRecord;
    };

export type ImportPlanItem = {
  module: ImportModule;
  logical_key: string;
  classification: ImportClassification;
  record:
    | ExportDiaryRecord
    | ExportTodoPaper
    | ExportMindStateRecord
    | ProjectRestoreRecord;
  current_hash: string | null;
};

export type ImportPlan = {
  package_sha256: string;
  preview_fingerprint: string;
  can_execute: boolean;
  summary: ImportSummary;
  items: ImportPlanItem[];
};

const emptyCounts = (): ImportCounts => ({
  create: 0,
  duplicate: 0,
  conflict: 0,
  invalid: 0,
});

function classify<T extends ExportDiaryRecord | ExportTodoPaper | ExportMindStateRecord>(
  module: "diary" | "todo" | "mind",
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

function classifyProjectEntity<T>(
  entity: ProjectRestoreRecord["entity"],
  imported: T[],
  current: T[],
  key: (record: T) => string,
): ImportPlanItem[] {
  const occurrences = new Map<string, number>();
  for (const record of imported) {
    const logicalKey = `${entity}:${key(record)}`;
    occurrences.set(
      logicalKey,
      (occurrences.get(logicalKey) ?? 0) + 1,
    );
  }

  return imported.map((record) => {
    const logicalKey = `${entity}:${key(record)}`;
    const existing = current.find(
      (candidate) => key(candidate) === key(record),
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

    return {
      module: "projects" as const,
      logical_key: logicalKey,
      classification,
      record: {
        entity,
        value: record,
      } as ProjectRestoreRecord,
      current_hash: existing
        ? hashCanonical(existing)
        : null,
    };
  });
}

function projectItems(
  imported: ExportProjectsBundle,
  current: ImportCurrentState,
): ImportPlanItem[] {
  const currentProjects = current.projects ?? {
    workspaces: [],
    projects: [],
    resources: [],
    conversations: [],
  };
  const items = [
    ...classifyProjectEntity(
      "workspace",
      imported.workspaces,
      currentProjects.workspaces,
      (record) => record.id,
    ),
    ...classifyProjectEntity(
      "project",
      imported.projects,
      currentProjects.projects,
      (record) => record.id,
    ),
    ...classifyProjectEntity(
      "resource",
      imported.resources,
      currentProjects.resources,
      (record) => record.id,
    ),
    ...classifyProjectEntity(
      "conversation",
      imported.conversations,
      currentProjects.conversations,
      (record) =>
        `${record.project_id}:${record.conversation_id}`,
    ),
  ];

  const workspaceIds = new Set([
    ...currentProjects.workspaces.map((record) => record.id),
    ...imported.workspaces.map((record) => record.id),
  ]);
  const projectIds = new Set([
    ...currentProjects.projects.map((record) => record.id),
    ...imported.projects.map((record) => record.id),
  ]);
  const conversationIds =
    current.native_live_conversation_ids ?? new Set<string>();

  for (const item of items) {
    if (item.classification !== "create") continue;
    const record = item.record as ProjectRestoreRecord;

    if (
      record.entity === "workspace"
      && current.foreign_workspace_ids?.has(record.value.id)
    ) {
      item.classification = "conflict";
      continue;
    }
    if (
      record.entity === "project"
      && (
        current.foreign_project_ids?.has(record.value.id)
        || !workspaceIds.has(record.value.workspace_id)
      )
    ) {
      item.classification = current.foreign_project_ids?.has(record.value.id)
        ? "conflict"
        : "invalid";
      continue;
    }
    if (
      record.entity === "resource"
      && (
        current.foreign_project_resource_ids?.has(record.value.id)
        || !projectIds.has(record.value.project_id)
      )
    ) {
      item.classification = current.foreign_project_resource_ids?.has(record.value.id)
        ? "conflict"
        : "invalid";
      continue;
    }
    if (
      record.entity === "conversation"
      && (
        !projectIds.has(record.value.project_id)
        || !conversationIds.has(record.value.conversation_id)
      )
    ) {
      item.classification = "invalid";
    }
  }

  return items;
}

function summarize(
  items: ImportPlanItem[],
  includeProjects: boolean,
  includeMind: boolean,
): ImportSummary {
  const summary: ImportSummary = {
    diary: emptyCounts(),
    todo: emptyCounts(),
    ...(includeProjects
      ? { projects: emptyCounts() }
      : {}),
    ...(includeMind
      ? { mind: emptyCounts() }
      : {}),
  };

  for (const item of items) {
    const counts = summary[item.module];
    if (counts) counts[item.classification] += 1;
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

  const importedProjects =
    parsed.document.schema_version === 3
      ? parsed.document.data.projects
      : undefined;
  if (importedProjects) {
    items.push(...projectItems(importedProjects, current));
  }

  const importedMind =
    parsed.document.schema_version === 3
      ? parsed.document.data.mind
      : undefined;
  if (importedMind) {
    const mindItems = classify(
      "mind",
      importedMind,
      current.mind ?? [],
      (record) => `id:${record.id}`,
    );
    for (const item of mindItems) {
      if (
        item.classification === "create"
        && current.foreign_mind_ids?.has(
          (item.record as ExportMindStateRecord).id,
        )
      ) {
        item.classification = "conflict";
      }
    }
    items.push(...mindItems);
  }

  const summary = summarize(
    items,
    Boolean(importedProjects),
    Boolean(importedMind),
  );
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
