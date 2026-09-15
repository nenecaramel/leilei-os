import type {
  ExportDiaryRecord,
  ExportDocument,
  ExportLifecycleEvent,
  ExportMemoryRecord,
  ExportScope,
  ExportTaskRecord,
  ExportToolActivity,
  ExportSharedPaper,
  ExportTodoPaper,
} from "./export-types.js";
import { createOwnerFingerprint } from "./owner-fingerprint.js";
import {
  ActiveUserAuthorizationError,
  requireActiveUser,
} from "../require-active-user.js";

export interface ExportRepository {
  findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null>;
  listMemory(userId: string): Promise<ExportMemoryRecord[]>;
  listDiary(userId: string): Promise<ExportDiaryRecord[]>;
  listTasks(userId: string): Promise<ExportTaskRecord[]>;
  listTodo(userId: string): Promise<ExportTodoPaper[]>;
  listSharedPapers(userId: string): Promise<ExportSharedPaper[]>;
  listLifecycleAudit(userId: string): Promise<ExportLifecycleEvent[]>;
  listToolActivity(userId: string): Promise<ExportToolActivity[]>;
}

export type ExportServiceErrorCode = "USER_NOT_FOUND" | "USER_DISABLED";

export class ExportServiceError extends Error {
  constructor(public readonly code: ExportServiceErrorCode) {
    super("Export is unavailable for the authenticated user.");
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
    try {
      await requireActiveUser(this.repository, userId);
    } catch (error) {
      if (error instanceof ActiveUserAuthorizationError) {
        throw new ExportServiceError(error.code);
      }
      throw error;
    }
    const data: ExportDocument["data"] = {};
    if (scope === "all" || scope === "memory") {
      data.memory = await this.repository.listMemory(userId);
    }
    if (scope === "all" || scope === "diary") {
      data.diary = await this.repository.listDiary(userId);
    }
    if (scope === "all" || scope === "task") {
      data.task = await this.repository.listTasks(userId);
    }
    if (scope === "all" || scope === "todo") {
      data.todo = await this.repository.listTodo(userId);
    }
    if (scope === "all" || scope === "shared_paper") {
      data.shared_paper = await this.repository.listSharedPapers(userId);
    }

    const document: ExportDocument = {
      schema_version: 2,
      owner_fingerprint: createOwnerFingerprint(userId),
      exported_at: this.now().toISOString(),
      data,
    };
    if (includeAudit) {
      const [lifecycle, tool_activity] = await Promise.all([
        this.repository.listLifecycleAudit(userId),
        this.repository.listToolActivity(userId),
      ]);
      document.audit = { lifecycle, tool_activity };
    }
    return document;
  }
}
