import type {
  ExportConversationsBundle,
  ExportDiaryCommentRecord,
  ExportDiaryRecord,
  ExportDocument,
  ExportLifecycleEvent,
  ExportMindContinuityBundle,
  ExportMindStateRecord,
  ExportProjectsBundle,
  ExportScope,
  ExportToolActivity,
  ExportTodoPaper,
  ExportUniverseBundle,
} from "./export-types.js";
import { createOwnerFingerprint } from "./owner-fingerprint.js";
import { MAX_PRODUCT_BACKUP_BYTES } from "./product-backup-limits.js";
import {
  ActiveUserAuthorizationError,
  requireActiveUser,
} from "../require-active-user.js";

export interface ExportRepository {
  withConsistentSnapshot<T>(
    work: (repository: ExportRepository) => Promise<T>,
  ): Promise<T>;
  findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null>;
  listDiary(userId: string): Promise<ExportDiaryRecord[]>;
  listDiaryComments(userId: string): Promise<ExportDiaryCommentRecord[]>;
  listTodo(userId: string): Promise<ExportTodoPaper[]>;
  listProjects(userId: string): Promise<ExportProjectsBundle>;
  listMind(userId: string): Promise<ExportMindStateRecord[]>;
  listMindContinuity(userId: string): Promise<ExportMindContinuityBundle>;
  hasIncompleteMindFollowUps(userId: string): Promise<boolean>;
  hasIncompleteTurnPreparations(userId: string): Promise<boolean>;
  hasIncompleteMindSemanticGrouping(userId: string): Promise<boolean>;
  hasIncompleteBackgroundModelJobs(userId: string): Promise<boolean>;
  listConversations(userId: string): Promise<ExportConversationsBundle>;
  listUniverse(userId: string): Promise<ExportUniverseBundle | null>;
  listLifecycleAudit(userId: string): Promise<ExportLifecycleEvent[]>;
  listToolActivity(userId: string): Promise<ExportToolActivity[]>;
}

export type ExportServiceErrorCode =
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "EXPORT_IN_PROGRESS"
  | "EXPORT_TOO_LARGE";

export class ExportServiceError extends Error {
  constructor(public readonly code: ExportServiceErrorCode) {
    super(
      code === "EXPORT_IN_PROGRESS"
        ? "Product export is unavailable while runtime processing is incomplete."
        : code === "EXPORT_TOO_LARGE"
          ? "Product export exceeds the current portable backup size limit."
          : "Export is unavailable for the authenticated user.",
    );
    this.name = "ExportServiceError";
  }
}

export class ExportService {
  constructor(
    private readonly repository: ExportRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createExport(
    userId: string,
    scope: ExportScope,
    includeAudit: boolean,
  ): Promise<ExportDocument> {
    return this.repository.withConsistentSnapshot(
      async (repository) =>
        this.createExportFromSnapshot(
          repository,
          userId,
          scope,
          includeAudit,
        ),
    );
  }

  private async createExportFromSnapshot(
    repository: ExportRepository,
    userId: string,
    scope: ExportScope,
    includeAudit: boolean,
  ): Promise<ExportDocument> {
    try {
      await requireActiveUser(repository, userId);
    } catch (error) {
      if (error instanceof ActiveUserAuthorizationError) {
        throw new ExportServiceError(error.code);
      }
      throw error;
    }

    const data: ExportDocument["data"] = {};
    if (scope === "all" || scope === "diary") {
      const [diary, diaryComments] = await Promise.all([
        repository.listDiary(userId),
        repository.listDiaryComments(userId),
      ]);
      data.diary = diary;
      data.diary_comments = diaryComments;
    }
    if (scope === "all" || scope === "todo") {
      data.todo = await repository.listTodo(userId);
    }
    if (scope === "all") {
      const [
        incompleteTurns,
        incompleteMind,
        incompleteSemanticGrouping,
        incompleteBackgroundModel,
      ] = await Promise.all([
        repository.hasIncompleteTurnPreparations(userId),
        repository.hasIncompleteMindFollowUps(userId),
        repository.hasIncompleteMindSemanticGrouping(userId),
        repository.hasIncompleteBackgroundModelJobs(userId),
      ]);
      if (
        incompleteTurns
        || incompleteMind
        || incompleteSemanticGrouping
        || incompleteBackgroundModel
      ) {
        throw new ExportServiceError("EXPORT_IN_PROGRESS");
      }

      const [
        projects,
        mind,
        mindContinuity,
        conversations,
        universe,
      ] = await Promise.all([
        repository.listProjects(userId),
        repository.listMind(userId),
        repository.listMindContinuity(userId),
        repository.listConversations(userId),
        repository.listUniverse(userId),
      ]);
      if (
        conversations.messages.some(
          (message) =>
            message.status === "pending"
            || message.status === "streaming",
        )
      ) {
        throw new ExportServiceError("EXPORT_IN_PROGRESS");
      }
      data.projects = projects;
      data.mind = mind;
      data.mind_continuity = mindContinuity;
      data.conversations = conversations;
      data.universe = universe;
    }

    const document: ExportDocument = {
      schema_version: 3,
      owner_fingerprint: createOwnerFingerprint(userId),
      exported_at: this.now().toISOString(),
      data,
    };
    if (includeAudit) {
      const [lifecycle, tool_activity] = await Promise.all([
        repository.listLifecycleAudit(userId),
        repository.listToolActivity(userId),
      ]);
      document.audit = { lifecycle, tool_activity };
    }
    const serializedBytes = Buffer.byteLength(
      JSON.stringify(document),
      "utf8",
    );
    if (serializedBytes > MAX_PRODUCT_BACKUP_BYTES) {
      throw new ExportServiceError("EXPORT_TOO_LARGE");
    }

    return document;
  }
}
