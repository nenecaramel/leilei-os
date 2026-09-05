import type { ContentAuthor } from "../content-author.js";

export type ExportScope = "all" | "memory" | "diary" | "task" | "todo";

export type ExportMemoryRecord = {
  id: string;
  category: string;
  key: string;
  content: string;
  tags: string[];
  visibility: string;
  source: string;
  author: ContentAuthor | null;
  status: "active" | "archived";
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ExportDiaryRecord = {
  id: string;
  title: string;
  content: string;
  date: string;
  tags: string[];
  mood: string | null;
  source: string;
  author: ContentAuthor | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type ExportTaskRecord = {
  id: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  resume_status: "pending" | "in_progress" | "completed" | "cancelled" | null;
  lifecycle_status: "active" | "archived";
  author: ContentAuthor | null;
  priority: "low" | "normal" | "high" | "urgent";
  due_time: string | null;
  timezone: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ExportTodoPaper = {
  date: string;
  author: ContentAuthor;
  revision: number;
  created_at: string;
  updated_at: string;
  entries: Array<{
    id: string;
    kind: "pending" | "completed" | "record";
    text: string;
  }>;
};

export type ExportLifecycleEvent = {
  id: string;
  resource_type: string;
  resource_id: string;
  action: string;
  actor_type: string;
  channel: string;
  created_at: string;
};

export type ExportToolActivity = {
  id: string;
  tool_name: string;
  operation: string;
  resource_type: string;
  resource_id: string | null;
  status: string;
  error_code: string | null;
  created_at: string;
};

export type ExportDataV1 = {
  memory?: ExportMemoryRecord[];
  diary?: ExportDiaryRecord[];
  task?: ExportTaskRecord[];
  todo?: ExportTodoPaper[];
};

export type ExportDocumentV1 = {
  schema_version: 1;
  exported_at: string;
  data: ExportDataV1;
  audit?: {
    lifecycle: ExportLifecycleEvent[];
    tool_activity: ExportToolActivity[];
  };
};

export type ExportDocumentV2 = {
  schema_version: 2;
  owner_fingerprint: string;
  exported_at: string;
  data: ExportDataV1;
  audit?: {
    lifecycle: ExportLifecycleEvent[];
    tool_activity: ExportToolActivity[];
  };
};

export type ExportDocument = ExportDocumentV2;
