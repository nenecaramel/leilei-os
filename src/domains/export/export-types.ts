import type { ContentAuthor } from "../content-author.js";

export type ExportScope = "all" | "diary" | "todo";

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

export type ExportDataV2 = {
  diary?: ExportDiaryRecord[];
  todo?: ExportTodoPaper[];
};

export type ExportDocumentV2 = {
  schema_version: 2;
  owner_fingerprint: string;
  exported_at: string;
  data: ExportDataV2;
  audit?: {
    lifecycle: ExportLifecycleEvent[];
    tool_activity: ExportToolActivity[];
  };
};

export type ExportDocument = ExportDocumentV2;
