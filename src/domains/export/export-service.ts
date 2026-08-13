import type {
  ExportDiaryRecord,
  ExportDocument,
  ExportLifecycleEvent,
  ExportMemoryRecord,
  ExportScope,
  ExportTaskRecord,
  ExportToolActivity,
  ExportTodoPaper,
} from "./export-types.js";
import { createOwnerFingerprint } from "./owner-fingerprint.js";

export interface ExportRepository {
  listMemory(userId: string): Promise<ExportMemoryRecord[]>;
  listDiary(userId: string): Promise<ExportDiaryRecord[]>;
  listTasks(userId: string): Promise<ExportTaskRecord[]>;
  listTodo(userId: string): Promise<ExportTodoPaper[]>;
  listLifecycleAudit(userId: string): Promise<ExportLifecycleEvent[]>;
  listToolActivity(userId: string): Promise<ExportToolActivity[]>;
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
