import type {
  ExportConversationsBundle,
  ExportDiaryCommentRecord,
  ExportDiaryRecord,
  ExportDocument,
  ExportLifecycleEvent,
  ExportMindContinuityBundle,
  ExportMindStateRecord,
  ExportWorkspacesBundle,
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
  listWorkspaces(userId: string): Promise<ExportWorkspacesBundle>;
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

export type ExportInProgressReason =
  | "prepared_turn"
  | "mind_followup"
  | "canonical_message";

export class ExportServiceError extends Error {
  constructor(
    public readonly code: ExportServiceErrorCode,
    public readonly reason: ExportInProgressReason | null = null,
  ) {
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
    includeAudit: boolean,
  ): Promise<ExportDocument> {
    return this.repository.withConsistentSnapshot(
      async (repository) =>
        this.createExportFromSnapshot(
          repository,
          userId,
          includeAudit,
        ),
    );
  }

  private async createExportFromSnapshot(
    repository: ExportRepository,
    userId: string,
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

    const [diary, diaryComments, todo] = await Promise.all([
      repository.listDiary(userId),
      repository.listDiaryComments(userId),
      repository.listTodo(userId),
    ]);

    // Portable backup snapshots committed product state. Only foreground
    // finalization that can leave Conversation/Mind product state half-written
    // blocks the snapshot. Semantic grouping and background model queues are
    // recoverable operational work owned by the Mac Companion and may remain
    // pending while the companion is offline; they must not make backup
    // unavailable indefinitely.
    const [incompleteTurns, incompleteMind] = await Promise.all([
      repository.hasIncompleteTurnPreparations(userId),
      repository.hasIncompleteMindFollowUps(userId),
    ]);
    if (incompleteTurns) {
      throw new ExportServiceError(
        "EXPORT_IN_PROGRESS",
        "prepared_turn",
      );
    }
    if (incompleteMind) {
      throw new ExportServiceError(
        "EXPORT_IN_PROGRESS",
        "mind_followup",
      );
    }

    const [
      workspaces,
      mind,
      mindContinuity,
      conversations,
      universe,
    ] = await Promise.all([
      repository.listWorkspaces(userId),
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
      throw new ExportServiceError(
        "EXPORT_IN_PROGRESS",
        "canonical_message",
      );
    }

    const data: ExportDocument["data"] = {
      diary,
      diary_comments: diaryComments,
      todo,
      workspaces,
      mind,
      mind_continuity: mindContinuity,
      conversations,
      universe,
    };

    const document: ExportDocument = {
      schema_version: 4,
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
