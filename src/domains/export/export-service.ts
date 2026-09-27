import type {
  ExportConversationsBundle,
  ExportDiaryCommentRecord,
  ExportDiaryRecord,
  ExportDocument,
  ExportLifecycleEvent,
  ExportMindStateRecord,
  ExportProjectsBundle,
  ExportScope,
  ExportToolActivity,
  ExportTodoPaper,
} from "./export-types.js";
import { createOwnerFingerprint } from "./owner-fingerprint.js";
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
  listConversations(userId: string): Promise<ExportConversationsBundle>;
  listLifecycleAudit(userId: string): Promise<ExportLifecycleEvent[]>;
  listToolActivity(userId: string): Promise<ExportToolActivity[]>;
}

export type ExportServiceErrorCode =
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "EXPORT_IN_PROGRESS";

export class ExportServiceError extends Error {
  constructor(public readonly code: ExportServiceErrorCode) {
    super(
      code === "EXPORT_IN_PROGRESS"
        ? "Product export is unavailable while a native/live turn is in progress."
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
      const [projects, mind, conversations] = await Promise.all([
        repository.listProjects(userId),
        repository.listMind(userId),
        repository.listConversations(userId),
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
      data.conversations = conversations;
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
    return document;
  }
}
