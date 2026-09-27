import type {
  ExportConversationAttachmentRecord,
  ExportConversationContentBlockRecord,
  ExportConversationMessageRecord,
  ExportConversationRecord,
  ExportDiaryRecord,
  ExportMindStateRecord,
  ExportTodoPaper,
  RestorableExportDocument,
} from "../export/export-types.js";
import {
  buildImportPlan,
  type ConversationRestoreRecord,
  type ImportCurrentState,
  type ImportModule,
  type ImportPlan,
  type ImportPlanItem,
  type ImportSummary,
  type ProjectRestoreRecord,
} from "./import-planner.js";
import { hashCanonical } from "./import-canonical.js";
import {
  ImportValidationError,
  parseImportPackage,
} from "./import-schema.js";
import type { ImportRepository } from "./import-repository.js";
import {
  ActiveUserAuthorizationError,
  requireActiveUser,
} from "../require-active-user.js";

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

export class ImportAuthorizationError extends Error {
  constructor(public readonly code: "USER_NOT_FOUND" | "USER_DISABLED") {
    super("Import is unavailable for the authenticated user.");
    this.name = "ImportAuthorizationError";
  }
}

function toPreview(plan: ImportPlan): ImportPreview {
  return {
    package_sha256: plan.package_sha256,
    preview_fingerprint: plan.preview_fingerprint,
    summary: plan.summary,
    can_execute: plan.can_execute,
  };
}

function includedModules(document: RestorableExportDocument): Set<ImportModule> {
  const modules: ImportModule[] = [];
  if (document.data.diary) modules.push("diary");
  if (document.data.todo) modules.push("todo");
  if (document.schema_version === 3 && document.data.mind) {
    modules.push("mind");
  }
  if (document.schema_version === 3 && document.data.projects) {
    modules.push("projects");
  }
  if (document.schema_version === 3 && document.data.conversations) {
    modules.push("conversations");
  }
  return new Set(modules);
}

function hasExactProjectValue(
  record: ProjectRestoreRecord,
  state: ImportCurrentState,
): boolean {
  const projects = state.projects ?? {
    workspaces: [],
    projects: [],
    resources: [],
    conversations: [],
  };
  if (record.entity === "workspace") {
    return projects.workspaces.some(
      (candidate) =>
        candidate.id === record.value.id
        && hashCanonical(candidate) === hashCanonical(record.value),
    );
  }
  if (record.entity === "project") {
    return projects.projects.some(
      (candidate) =>
        candidate.id === record.value.id
        && hashCanonical(candidate) === hashCanonical(record.value),
    );
  }
  if (record.entity === "resource") {
    return projects.resources.some(
      (candidate) =>
        candidate.id === record.value.id
        && hashCanonical(candidate) === hashCanonical(record.value),
    );
  }
  return projects.conversations.some(
    (candidate) =>
      candidate.project_id === record.value.project_id
      && candidate.conversation_id === record.value.conversation_id
      && hashCanonical(candidate) === hashCanonical(record.value),
  );
}

function hasExactConversationValue(
  record: ConversationRestoreRecord,
  state: ImportCurrentState,
): boolean {
  const conversations = state.conversations ?? {
    conversations: [],
    messages: [],
    content_blocks: [],
    attachments: [],
  };
  if (record.entity === "conversation") {
    return conversations.conversations.some(
      (candidate) =>
        candidate.id === record.value.id
        && hashCanonical(candidate) === hashCanonical(record.value),
    );
  }
  if (record.entity === "message") {
    return conversations.messages.some(
      (candidate) =>
        candidate.id === record.value.id
        && hashCanonical(candidate) === hashCanonical(record.value),
    );
  }
  if (record.entity === "content_block") {
    return conversations.content_blocks.some(
      (candidate) =>
        candidate.id === record.value.id
        && hashCanonical(candidate) === hashCanonical(record.value),
    );
  }
  return conversations.attachments.some(
    (candidate) =>
      candidate.id === record.value.id
      && hashCanonical(candidate) === hashCanonical(record.value),
  );
}

function hasExactCreatedValue(
  item: ImportPlanItem,
  state: ImportCurrentState,
): boolean {
  if (item.module === "diary") {
    const record = item.record as ExportDiaryRecord;
    return state.diary.some(
      (candidate) =>
        candidate.id === record.id
        && hashCanonical(candidate) === hashCanonical(record),
    );
  }

  if (item.module === "todo") {
    const record = item.record as ExportTodoPaper;
    return state.todo.some(
      (paper) =>
        paper.date === record.date
        && paper.author === record.author
        && hashCanonical(paper) === hashCanonical(record),
    );
  }

  if (item.module === "mind") {
    const record = item.record as ExportMindStateRecord;
    return (state.mind ?? []).some(
      (candidate) =>
        candidate.id === record.id
        && hashCanonical(candidate) === hashCanonical(record),
    );
  }

  if (item.module === "conversations") {
    return hasExactConversationValue(
      item.record as ConversationRestoreRecord,
      state,
    );
  }

  return hasExactProjectValue(
    item.record as ProjectRestoreRecord,
    state,
  );
}

function hasDatabaseErrorCode(error: unknown, code: string): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (
      "code" in current
      && (current as { code?: unknown }).code === code
    ) return true;
    current = "cause" in current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return false;
}

function projectRecords(
  creates: ImportPlanItem[],
  entity: ProjectRestoreRecord["entity"],
): ProjectRestoreRecord[] {
  return creates.flatMap((item) => {
    if (item.module !== "projects") return [];
    const record = item.record as ProjectRestoreRecord;
    return record.entity === entity ? [record] : [];
  });
}

function conversationRecords(
  creates: ImportPlanItem[],
  entity: ConversationRestoreRecord["entity"],
): ConversationRestoreRecord[] {
  return creates.flatMap((item) => {
    if (item.module !== "conversations") return [];
    const record = item.record as ConversationRestoreRecord;
    return record.entity === entity ? [record] : [];
  });
}

function orderMessageCreates(
  records: ConversationRestoreRecord[],
  current: ImportCurrentState,
): ExportConversationMessageRecord[] {
  const pending = new Map<string, ExportConversationMessageRecord>();
  for (const record of records) {
    if (record.entity === "message") {
      pending.set(record.value.id, record.value);
    }
  }

  const available = new Set(
    (current.conversations?.messages ?? [])
      .map((record) => record.id),
  );
  const ordered: ExportConversationMessageRecord[] = [];

  while (pending.size > 0) {
    let progressed = false;
    for (const [id, record] of pending) {
      if (
        record.parent_message_id !== null
        && !available.has(record.parent_message_id)
      ) continue;
      ordered.push(record);
      available.add(id);
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) {
      throw new ImportValidationError(
        "IMPORT_CONFLICT",
        "conversation graph cannot be restored",
      );
    }
  }

  return ordered;
}

async function executeCreates(
  repository: ImportRepository,
  userId: string,
  creates: ImportPlanItem[],
  current: ImportCurrentState,
): Promise<void> {
  for (const item of creates) {
    if (item.module === "diary") {
      await repository.insertDiary(
        userId,
        item.record as ExportDiaryRecord,
      );
    }
  }

  for (const item of creates) {
    if (item.module === "todo") {
      await repository.insertTodo(
        userId,
        item.record as ExportTodoPaper,
      );
    }
  }

  for (const record of conversationRecords(creates, "conversation")) {
    await repository.insertConversation(
      userId,
      record.value as ExportConversationRecord,
    );
  }

  for (
    const record of orderMessageCreates(
      conversationRecords(creates, "message"),
      current,
    )
  ) {
    await repository.insertConversationMessage(userId, record);
  }

  for (const record of conversationRecords(creates, "content_block")) {
    await repository.insertConversationContentBlock(
      userId,
      record.value as ExportConversationContentBlockRecord,
    );
  }

  for (const record of conversationRecords(creates, "attachment")) {
    await repository.insertConversationAttachment(
      userId,
      record.value as ExportConversationAttachmentRecord,
    );
  }

  for (const item of creates) {
    if (item.module === "mind") {
      await repository.insertMind(
        userId,
        item.record as ExportMindStateRecord,
      );
    }
  }

  for (const record of projectRecords(creates, "workspace")) {
    await repository.insertProjectWorkspace(userId, record.value);
  }
  for (const record of projectRecords(creates, "project")) {
    await repository.insertProject(userId, record.value);
  }
  for (const record of projectRecords(creates, "resource")) {
    await repository.insertProjectResource(userId, record.value);
  }
  for (const record of projectRecords(creates, "conversation")) {
    await repository.insertProjectConversation(userId, record.value);
  }
}

export class ImportService {
  constructor(private readonly repository: ImportRepository) {}

  async preview(raw: Uint8Array, userId: string): Promise<ImportPreview> {
    await this.requireActiveUser(this.repository, userId);
    const parsed = parseImportPackage(raw);
    const current = await this.repository.readCurrentState(userId);
    return toPreview(buildImportPlan(parsed, userId, current));
  }

  async execute(
    raw: Uint8Array,
    userId: string,
    expectedPreviewFingerprint: string,
  ): Promise<ImportExecution> {
    await this.requireActiveUser(this.repository, userId);
    const parsed = parseImportPackage(raw);
    if (!/^[0-9a-f]{64}$/u.test(expectedPreviewFingerprint)) {
      throw new ImportValidationError(
        "IMPORT_PREVIEW_STALE",
        "IMPORT_PREVIEW_STALE",
      );
    }
    try {
      return await this.repository.withTransaction(async (transaction) => {
        await this.requireActiveUser(transaction, userId);
        const current = await transaction.readCurrentState(userId);
        const plan = buildImportPlan(parsed, userId, current);
        if (plan.preview_fingerprint !== expectedPreviewFingerprint) {
          throw new ImportValidationError(
            "IMPORT_PREVIEW_STALE",
            "IMPORT_PREVIEW_STALE",
          );
        }
        if (
          plan.items.some(
            (item) =>
              item.classification === "conflict"
              || item.classification === "invalid",
          )
        ) {
          throw new ImportValidationError(
            "IMPORT_CONFLICT",
            "IMPORT_CONFLICT",
          );
        }

        const creates = plan.items.filter(
          (item) => item.classification === "create",
        );
        if (creates.length === 0) {
          throw new ImportValidationError(
            "IMPORT_NOTHING_TO_RESTORE",
            "IMPORT_NOTHING_TO_RESTORE",
          );
        }

        await executeCreates(
          transaction,
          userId,
          creates,
          current,
        );

        const reread = await transaction.rereadCreatedState(
          userId,
          includedModules(parsed.document),
        );
        if (
          creates.some(
            (item) => !hasExactCreatedValue(item, reread),
          )
        ) {
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
      if (
        error instanceof Error
        && error.message === "IMPORT_VERIFY_FAILED"
      ) {
        throw new ImportValidationError(
          "IMPORT_CONFLICT",
          "IMPORT_CONFLICT",
        );
      }
      if (
        hasDatabaseErrorCode(error, "23503")
        || hasDatabaseErrorCode(error, "23505")
      ) {
        throw new ImportValidationError(
          "IMPORT_CONFLICT",
          "IMPORT_CONFLICT",
        );
      }
      if (hasDatabaseErrorCode(error, "40001")) {
        throw new ImportValidationError(
          "IMPORT_PREVIEW_STALE",
          "IMPORT_PREVIEW_STALE",
        );
      }
      throw error;
    }
  }

  private async requireActiveUser(
    repository: ImportRepository,
    userId: string,
  ): Promise<void> {
    try {
      await requireActiveUser(repository, userId);
    } catch (error) {
      if (error instanceof ActiveUserAuthorizationError) {
        throw new ImportAuthorizationError(error.code);
      }
      throw error;
    }
  }
}
