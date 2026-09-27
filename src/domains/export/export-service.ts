import type {
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
  findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null>;
  listDiary(userId: string): Promise<ExportDiaryRecord[]>;
  listTodo(userId: string): Promise<ExportTodoPaper[]>;
  listProjects(userId: string): Promise<ExportProjectsBundle>;
  listMind(userId: string): Promise<ExportMindStateRecord[]>;
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
    if (scope === "all" || scope === "diary") {
      data.diary = await this.repository.listDiary(userId);
    }
    if (scope === "all" || scope === "todo") {
      data.todo = await this.repository.listTodo(userId);
    }
    if (scope === "all") {
      const [projects, mind] = await Promise.all([
        this.repository.listProjects(userId),
        this.repository.listMind(userId),
      ]);
      data.projects = projects;
      data.mind = mind;
    }

    const document: ExportDocument = {
      schema_version: 3,
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
