import type { ContentAuthor } from "../content-author.js";
import type { UniverseSnapshot } from "../universe/universe-types.js";
import type { ProjectResourceKind } from "../../database/schema.js";

export type ExportScope = "all" | "diary" | "todo";

export type ExportDiaryRecord = {
  id: string;
  title: string;
  content: string;
  date: string;
  tags: string[];
  mood: string | null;
  source: "chatgpt_mcp";
  author: ContentAuthor | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type ExportDiaryCommentRecord = {
  id: string;
  diary_id: string;
  author: ContentAuthor;
  content: string;
  revision: number;
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

export type ExportUniverseDiarySourceRecord = {
  node_id: string;
  diary_id: string;
};

export type ExportUniverseBundle = {
  version: number;
  snapshot: UniverseSnapshot;
  diary_sources: ExportUniverseDiarySourceRecord[];
};

export type ExportConversationRecord = {
  id: string;
  title: string | null;
  lifecycle_status: "active" | "archived";
  current_head_message_id: string | null;
  default_model: string | null;
  provider_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ExportConversationMessageRecord = {
  id: string;
  conversation_id: string;
  parent_message_id: string | null;
  role: "user" | "assistant" | "system" | "tool" | "reasoning" | "unknown";
  status: "pending" | "streaming" | "completed" | "error";
  raw_role: string | null;
  model: string | null;
  is_current_path: boolean;
  current_path_index: number | null;
  turn_index: number | null;
  is_primary: boolean;
  display_text: string;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
};

export type ExportConversationContentBlockRecord = {
  id: string;
  message_id: string;
  ordinal: number;
  kind:
    | "text"
    | "thinking"
    | "reasoning_recap"
    | "tool_use"
    | "tool_result"
    | "image"
    | "audio"
    | "video"
    | "file"
    | "attachment"
    | "unknown";
  raw_type: string;
  text: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type ExportConversationAttachmentRecord = {
  id: string;
  message_id: string;
  ordinal: number;
  source_attachment_id: string | null;
  name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  payload: Record<string, unknown>;
};

export type ExportConversationProviderCheckpointRecord = {
  id: string;
  conversation_id: string;
  canonical_message_id: string;
  provider: "claude_code";
  provider_session_id: string;
  workspace_id: string | null;
  effective_workspace_root: string | null;
  runtime_metadata: Record<string, unknown> | null;
  provider_checkpoint_id: string | null;
  created_at: string;
};

export type ExportConversationsBundle = {
  conversations: ExportConversationRecord[];
  messages: ExportConversationMessageRecord[];
  content_blocks: ExportConversationContentBlockRecord[];
  attachments: ExportConversationAttachmentRecord[];
  provider_checkpoints: ExportConversationProviderCheckpointRecord[];
};

export type ExportMindDriveSatisfactionEventRecord = {
  id: string;
  subject_id: string;
  drive_state_id: string;
  conversation_id: string;
  evidence_message_id: string;
  evidence_block_id: string | null;
  evidence_kind: "user_message" | "assistant_message" | "tool_result";
  amount: number;
  idempotency_key: string;
  created_at: string;
};

export type ExportMindCuriosityResolutionEventRecord = {
  id: string;
  subject_id: string;
  curiosity_state_id: string;
  conversation_id: string;
  requested_resolution_source_id: string;
  result_resolution_source_id: string;
  resolved_at: string;
  idempotency_key: string;
  created_at: string;
};

export type ExportMindDistillationWatermarkRecord = {
  subject_id: string;
  conversation_id: string;
  last_source_message_id: string;
  process_version: string;
  updated_at: string;
};

export type ExportMindSemanticGroupingResultRecord = {
  id: string;
  subject_id: string;
  kind: "drive" | "thought" | "curiosity" | "topic";
  query_state_id: string;
  query: string;
  candidates: Record<string, unknown>[];
  scores: Record<string, number>;
  created_at: string;
  updated_at: string;
  completed_at: string;
};

export type ExportMindContinuityBundle = {
  drive_satisfaction_events: ExportMindDriveSatisfactionEventRecord[];
  curiosity_resolution_events: ExportMindCuriosityResolutionEventRecord[];
  distillation_watermarks: ExportMindDistillationWatermarkRecord[];
  semantic_grouping_results: ExportMindSemanticGroupingResultRecord[];
};

export type ExportMindStateRecord = {
  id: string;
  subject_id: string;
  kind: "feel" | "memory" | "drive" | "thought" | "curiosity" | "topic";
  text: string | null;
  payload: Record<string, unknown> | null;
  scope_applicability: "global" | "conversation" | "path";
  scope_conversation_id: string | null;
  scope_path_head_message_id: string | null;
  settlement_status: "unsettled" | "settled" | "rejected";
  path_status: "current" | "superseded";
  validity_status: "valid" | "invalidated" | "tombstoned";
  envelope: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
  diary_comments?: ExportDiaryCommentRecord[];
  projects?: ExportProjectsBundle;
  mind?: ExportMindStateRecord[];
  mind_continuity?: ExportMindContinuityBundle;
  conversations?: ExportConversationsBundle;
  universe?: ExportUniverseBundle | null;
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
