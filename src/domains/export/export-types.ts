import type { ContentAuthor } from "../content-author.js";
import type { ProjectResourceKind } from "../../database/schema.js";

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

export type ExportProjectWorkspaceRecord = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ExportProjectRecord = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ExportProjectResourceRecord = {
  id: string;
  project_id: string;
  kind: ProjectResourceKind;
  key: string;
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ExportProjectConversationRecord = {
  project_id: string;
  conversation_id: string;
  added_at: string;
};

export type ExportProjectsBundle = {
  workspaces: ExportProjectWorkspaceRecord[];
  projects: ExportProjectRecord[];
  resources: ExportProjectResourceRecord[];
  conversations: ExportProjectConversationRecord[];
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

export type ExportDataV3 = ExportDataV2 & {
  projects?: ExportProjectsBundle;
};

export type ExportAudit = {
  lifecycle: ExportLifecycleEvent[];
  tool_activity: ExportToolActivity[];
};

export type ExportDocumentV2 = {
  schema_version: 2;
  owner_fingerprint: string;
  exported_at: string;
  data: ExportDataV2;
  audit?: ExportAudit;
};

export type ExportDocumentV3 = {
  schema_version: 3;
  owner_fingerprint: string;
  exported_at: string;
  data: ExportDataV3;
  audit?: ExportAudit;
};

export type RestorableExportDocument =
  | ExportDocumentV2
  | ExportDocumentV3;

export type ExportDocument = ExportDocumentV3;
