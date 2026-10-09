import {
  createOwnerFingerprint,
} from "../../src/domains/export/owner-fingerprint.js";
import type {
  ExportConversationAttachmentRecord,
  ExportConversationContentBlockRecord,
  ExportConversationMessageRecord,
  ExportConversationProviderCheckpointRecord,
  ExportConversationRecord,
  ExportConversationsBundle,
  ExportDiaryCommentRecord,
  ExportDiaryRecord,
  ExportMindContinuityBundle,
  ExportMindCuriosityResolutionEventRecord,
  ExportMindDistillationWatermarkRecord,
  ExportMindDriveSatisfactionEventRecord,
  ExportMindSemanticGroupingResultRecord,
  HistoricalMindStateRecord,
  ExportProjectConversationRecord,
  ExportProjectRecord,
  ExportProjectResourceRecord,
  ExportProjectsBundle,
  ExportProjectWorkspaceRecord,
  ExportTodoPaper,
  ExportUniverseBundle,
} from "../../src/domains/export/export-types.js";
import type {
  ImportAuditRun,
  ImportRepository,
} from "../../src/domains/import/import-repository.js";
import type {
  ImportCurrentState,
  ImportModule,
} from "../../src/domains/import/import-planner.js";

export const USER_ID = "00000000-0000-4000-8000-000000000099";

export const NOW = "2026-08-14T00:00:00.000Z";

export const diary: ExportDiaryRecord = {
  id: "00000000-0000-4000-8000-000000000031",
  title: "Diary",
  content: "Canonical diary content",
  date: "2026-08-13",
  tags: [],
  mood: null,
  source: "chatgpt_mcp",
  author: "C",
  status: "active",
  created_at: NOW,
  updated_at: NOW,
};

export const diaryComment: ExportDiaryCommentRecord = {
  id: "00000000-0000-4000-8000-000000000072",
  diary_id: diary.id,
  author: "G",
  content: "Comment",
  revision: 2,
  created_at: NOW,
  updated_at: NOW,
};

export const todo: ExportTodoPaper = {
  date: "2026-08-13",
  author: "C",
  revision: 2,
  created_at: NOW,
  updated_at: NOW,
  entries: [
    { id: "entry-1", kind: "pending", text: "Todo" },
  ],
};

export const universeBundle: ExportUniverseBundle = {
  version: 7,
  snapshot: {
    schemaVersion: 2,
    meta: {
      name: "蕾蕾宇宙",
      createdAt: NOW,
      updatedAt: NOW,
    },
    galaxies: [{
      id: "galaxy-1",
      title: "Galaxy",
      description: "Description",
      color: "#ffffff",
      order: 0,
    }],
    nodes: [{
      id: "node-1",
      title: "Node",
      summary: "Summary",
      content: "Content",
      type: "idea",
      tags: ["portable"],
      galaxies: [{ id: "galaxy-1", weight: 1 }],
      position: { x: 1, y: 2 },
      createdAt: NOW,
      updatedAt: NOW,
    }],
    relations: [],
    revisions: [],
  },
  diary_sources: [{
    node_id: "node-1",
    diary_id: diary.id,
  }],
};

export const CONVERSATION_ID =
  "00000000-0000-4000-8000-000000000041";

export const mindState: HistoricalMindStateRecord = {
  id: "00000000-0000-4000-8000-000000000061",
  subject_id: "claude",
  kind: "memory",
  text: "Durable memory",
  payload: {
    lifecycle_v1: {
      status: "active",
      reinforcementCount: 2,
    },
  },
  scope_applicability: "global",
  scope_conversation_id: null,
  scope_path_head_message_id: null,
  settlement_status: "settled",
  path_status: "current",
  validity_status: "valid",
  envelope: {
    authority: "subject_authorized",
    provenance: {
      sources: [{ kind: "conversation_message", id: "source-1" }],
    },
  },
  created_at: NOW,
  updated_at: NOW,
};

export const driveState: HistoricalMindStateRecord = {
  ...mindState,
  id: "00000000-0000-4000-8000-000000000064",
  kind: "drive",
  text: "Durable drive",
  payload: { drive_v1: { phase: "active" } },
};

export const driveCandidateState: HistoricalMindStateRecord = {
  ...mindState,
  id: "00000000-0000-4000-8000-000000000068",
  kind: "drive",
  text: "Earlier durable drive",
  payload: { drive_v1: { phase: "active" } },
};

export const curiosityState: HistoricalMindStateRecord = {
  ...mindState,
  id: "00000000-0000-4000-8000-000000000065",
  kind: "curiosity",
  text: "Durable curiosity",
  payload: { curiosity_v1: { phase: "resolved" } },
};

export const conversationBundle: ExportConversationsBundle = {
  conversations: [{
    id: CONVERSATION_ID,
    title: "Native conversation",
    lifecycle_status: "active",
    current_head_message_id:
      "00000000-0000-4000-8000-000000000043",
    default_model: "claude-sonnet",
    provider_metadata: {},
    created_at: NOW,
    updated_at: NOW,
    archived_at: null,
  }],
  messages: [
    {
      id: "00000000-0000-4000-8000-000000000042",
      conversation_id: CONVERSATION_ID,
      parent_message_id: null,
      role: "user",
      status: "completed",
      raw_role: null,
      model: null,
      is_current_path: true,
      current_path_index: 0,
      turn_index: 0,
      is_primary: true,
      display_text: "hello",
      created_at: NOW,
      completed_at: NOW,
      updated_at: NOW,
    },
    {
      id: "00000000-0000-4000-8000-000000000043",
      conversation_id: CONVERSATION_ID,
      parent_message_id:
        "00000000-0000-4000-8000-000000000042",
      role: "assistant",
      status: "completed",
      raw_role: null,
      model: "claude-sonnet",
      is_current_path: true,
      current_path_index: 1,
      turn_index: 0,
      is_primary: true,
      display_text: "hi",
      created_at: NOW,
      completed_at: NOW,
      updated_at: NOW,
    },
  ],
  content_blocks: [{
    id: "00000000-0000-4000-8000-000000000044",
    message_id:
      "00000000-0000-4000-8000-000000000043",
    ordinal: 0,
    kind: "text",
    raw_type: "text",
    text: "hi",
    payload: null,
    created_at: NOW,
  }],
  attachments: [{
    id: "00000000-0000-4000-8000-000000000045",
    message_id:
      "00000000-0000-4000-8000-000000000042",
    ordinal: 0,
    source_attachment_id: null,
    name: "note.txt",
    mime_type: "text/plain",
    size_bytes: 4,
    payload: { logical_ref: "attachment:test" },
  }],
  provider_checkpoints: [{
    id: "00000000-0000-4000-8000-000000000046",
    conversation_id: CONVERSATION_ID,
    canonical_message_id:
      "00000000-0000-4000-8000-000000000043",
    provider: "claude_code",
    provider_session_id: "session-roundtrip-1",
    effective_working_directory: null,
    runtime_metadata: {
      context_window: 200000,
    },
    provider_checkpoint_id: "checkpoint-roundtrip-1",
    created_at: NOW,
  }],
};

export const mindContinuity: ExportMindContinuityBundle = {
  drive_satisfaction_events: [{
    id: "00000000-0000-4000-8000-000000000066",
    subject_id: "claude",
    drive_state_id: driveState.id,
    conversation_id: CONVERSATION_ID,
    evidence_message_id:
      "00000000-0000-4000-8000-000000000043",
    evidence_block_id: null,
    evidence_kind: "assistant_message",
    amount: 0.5,
    idempotency_key: "drive-satisfy-000001",
    created_at: NOW,
  }],
  curiosity_resolution_events: [{
    id: "00000000-0000-4000-8000-000000000067",
    subject_id: "claude",
    curiosity_state_id: curiosityState.id,
    conversation_id: CONVERSATION_ID,
    requested_resolution_source_id:
      "00000000-0000-4000-8000-000000000043",
    result_resolution_source_id: "resolution-source",
    resolved_at: NOW,
    idempotency_key: "curiosity-resolve-01",
    created_at: NOW,
  }],
  distillation_watermarks: [{
    subject_id: "claude",
    conversation_id: CONVERSATION_ID,
    last_source_message_id:
      "00000000-0000-4000-8000-000000000043",
    process_version: "distill-v1",
    updated_at: NOW,
  }],
  semantic_grouping_results: [{
    id: "00000000-0000-4000-8000-000000000069",
    subject_id: "claude",
    kind: "drive",
    query_state_id: driveState.id,
    query: "Durable drive",
    candidates: [{
      stateId: driveCandidateState.id,
      kind: "drive",
      text: "Earlier durable drive",
    }],
    scores: {
      [driveCandidateState.id]: 0.91,
    },
    created_at: NOW,
    updated_at: NOW,
    completed_at: NOW,
  }],
};

export const projectBundle: ExportProjectsBundle = {
  workspaces: [{
    id: "00000000-0000-4000-8000-000000000051",
    name: "Workspace",
    description: "Portable workspace",
    version: 3,
    created_at: NOW,
    updated_at: NOW,
  }],
  projects: [{
    id: "00000000-0000-4000-8000-000000000052",
    workspace_id:
      "00000000-0000-4000-8000-000000000051",
    name: "Project",
    description: null,
    version: 2,
    created_at: NOW,
    updated_at: NOW,
  }],
  resources: [{
    id: "00000000-0000-4000-8000-000000000053",
    project_id:
      "00000000-0000-4000-8000-000000000052",
    kind: "file",
    key: "notes/context.md",
    title: "Context",
    content: "project content",
    metadata: { source: "test" },
    version: 4,
    created_at: NOW,
    updated_at: NOW,
  }],
  conversations: [{
    project_id:
      "00000000-0000-4000-8000-000000000052",
    conversation_id: CONVERSATION_ID,
    added_at: NOW,
  }],
};

export const canonicalProjectBundle: ExportProjectsBundle = {
  workspaces: projectBundle.projects.map((record) => ({
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    created_at: record.created_at,
    updated_at: record.updated_at,
  })),
  projects: projectBundle.projects.map((record) => ({
    ...record,
    workspace_id: record.id,
  })),
  resources: structuredClone(projectBundle.resources),
  conversations: structuredClone(projectBundle.conversations),
};

export const workspaceBundle = {
  items: canonicalProjectBundle.workspaces.map((record) => ({
    ...record,
  })),
  resources: canonicalProjectBundle.resources.map((record) => ({
    id: record.id,
    workspace_id: record.project_id,
    kind: record.kind,
    key: record.key,
    title: record.title,
    content: record.content,
    metadata: structuredClone(record.metadata),
    version: record.version,
    created_at: record.created_at,
    updated_at: record.updated_at,
  })),
  conversations: canonicalProjectBundle.conversations.map((record) => ({
    workspace_id: record.project_id,
    conversation_id: record.conversation_id,
    added_at: record.added_at,
  })),
};

export function packageBytes(
  data: Record<string, unknown> = {
    diary: [diary],
    todo: [todo],
  },
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schema_version: 2,
      owner_fingerprint:
        createOwnerFingerprint(USER_ID),
      exported_at: NOW,
      data,
    }),
  );
}

export function v3PackageBytes(
  data: Record<string, unknown> = {
    projects: projectBundle,
  },
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schema_version: 3,
      owner_fingerprint:
        createOwnerFingerprint(USER_ID),
      exported_at: NOW,
      data,
    }),
  );
}

export function v4PackageBytes(
  data: Record<string, unknown> = {
    workspaces: workspaceBundle,
  },
  audit?: Record<string, unknown>,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schema_version: 4,
      owner_fingerprint:
        createOwnerFingerprint(USER_ID),
      exported_at: NOW,
      data,
      ...(audit ? { audit } : {}),
    }),
  );
}

export function cloneState(
  state: ImportCurrentState,
): ImportCurrentState {
  return {
    diary: structuredClone(state.diary),
    diary_comments: state.diary_comments
      ? structuredClone(state.diary_comments)
      : undefined,
    todo: structuredClone(state.todo),
    projects: state.projects
      ? structuredClone(state.projects)
      : undefined,
    mind: state.mind
      ? structuredClone(state.mind)
      : undefined,
    mind_continuity: state.mind_continuity
      ? structuredClone(state.mind_continuity)
      : undefined,
    conversations: state.conversations
      ? structuredClone(state.conversations)
      : undefined,
    universe:
      state.universe === undefined
        ? undefined
        : structuredClone(state.universe),
    foreign_diary_ids:
      state.foreign_diary_ids
        ? new Set(state.foreign_diary_ids)
        : undefined,
    foreign_diary_comment_ids:
      state.foreign_diary_comment_ids
        ? new Set(state.foreign_diary_comment_ids)
        : undefined,
    foreign_workspace_ids:
      state.foreign_workspace_ids
        ? new Set(state.foreign_workspace_ids)
        : undefined,
    foreign_project_ids:
      state.foreign_project_ids
        ? new Set(state.foreign_project_ids)
        : undefined,
    foreign_project_resource_ids:
      state.foreign_project_resource_ids
        ? new Set(state.foreign_project_resource_ids)
        : undefined,
    foreign_mind_ids:
      state.foreign_mind_ids
        ? new Set(state.foreign_mind_ids)
        : undefined,
    foreign_drive_satisfaction_event_ids:
      state.foreign_drive_satisfaction_event_ids
        ? new Set(state.foreign_drive_satisfaction_event_ids)
        : undefined,
    foreign_curiosity_resolution_event_ids:
      state.foreign_curiosity_resolution_event_ids
        ? new Set(state.foreign_curiosity_resolution_event_ids)
        : undefined,
    foreign_semantic_grouping_result_ids:
      state.foreign_semantic_grouping_result_ids
        ? new Set(state.foreign_semantic_grouping_result_ids)
        : undefined,
    occupied_semantic_grouping_keys:
      state.occupied_semantic_grouping_keys
        ? new Set(state.occupied_semantic_grouping_keys)
        : undefined,
    foreign_conversation_ids:
      state.foreign_conversation_ids
        ? new Set(state.foreign_conversation_ids)
        : undefined,
    foreign_conversation_message_ids:
      state.foreign_conversation_message_ids
        ? new Set(state.foreign_conversation_message_ids)
        : undefined,
    foreign_conversation_content_block_ids:
      state.foreign_conversation_content_block_ids
        ? new Set(state.foreign_conversation_content_block_ids)
        : undefined,
    foreign_conversation_attachment_ids:
      state.foreign_conversation_attachment_ids
        ? new Set(state.foreign_conversation_attachment_ids)
        : undefined,
    foreign_conversation_checkpoint_ids:
      state.foreign_conversation_checkpoint_ids
        ? new Set(state.foreign_conversation_checkpoint_ids)
        : undefined,
    native_live_conversation_ids:
      state.native_live_conversation_ids
        ? new Set(state.native_live_conversation_ids)
        : undefined,
  };
}

export class FakeImportRepository implements ImportRepository {
  state: ImportCurrentState;
  audits: ImportAuditRun[] = [];
  writes = 0;
  status: "active" | "disabled" = "active";

  constructor(
    initial: ImportCurrentState = {
      diary: [],
      todo: [],
    },
  ) {
    this.state = cloneState(initial);
  }

  async findUserById() {
    return { status: this.status };
  }

  async withTransaction<T>(
    work: (
      repository: ImportRepository,
    ) => Promise<T>,
  ): Promise<T> {
    const snapshot = cloneState(this.state);
    const audits = [...this.audits];
    const writes = this.writes;
    try {
      return await work(this);
    } catch (error) {
      this.state = snapshot;
      this.audits = audits;
      this.writes = writes;
      throw error;
    }
  }

  async readCurrentState() {
    return cloneState(this.state);
  }

  async insertDiary(
    _userId: string,
    record: ExportDiaryRecord,
  ) {
    this.state.diary.push(
      structuredClone(record),
    );
    this.writes += 1;
  }

  async insertDiaryComment(
    _userId: string,
    record: ExportDiaryCommentRecord,
  ) {
    const comments = this.state.diary_comments ??= [];
    comments.push(structuredClone(record));
    this.writes += 1;
  }

  async insertTodo(
    _userId: string,
    record: ExportTodoPaper,
  ) {
    this.state.todo.push(
      structuredClone(record),
    );
    this.writes += 1;
  }

  async insertUniverse(
    _userId: string,
    record: ExportUniverseBundle,
  ) {
    this.state.universe = structuredClone(record);
    this.writes += 1;
  }

  async insertConversation(
    _userId: string,
    record: ExportConversationRecord,
  ) {
    const conversations = this.state.conversations ??= {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    };
    conversations.conversations.push({
      ...structuredClone(record),
      current_head_message_id: null,
    });
    this.state.native_live_conversation_ids ??= new Set();
    this.state.native_live_conversation_ids.add(record.id);
    this.writes += 1;
  }

  async insertConversationMessage(
    _userId: string,
    record: ExportConversationMessageRecord,
  ) {
    const conversations = this.state.conversations ??= {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    };
    conversations.messages.push(structuredClone(record));
    this.writes += 1;
  }

  async setConversationCurrentHead(
    _userId: string,
    conversationId: string,
    currentHeadMessageId: string,
  ) {
    const conversations = this.state.conversations;
    const conversation = conversations?.conversations.find(
      (candidate) => candidate.id === conversationId,
    );
    if (!conversation) {
      throw new Error("conversation not found");
    }
    conversation.current_head_message_id = currentHeadMessageId;
  }

  async insertConversationContentBlock(
    _userId: string,
    record: ExportConversationContentBlockRecord,
  ) {
    const conversations = this.state.conversations ??= {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    };
    conversations.content_blocks.push(structuredClone(record));
    this.writes += 1;
  }

  async insertConversationAttachment(
    _userId: string,
    record: ExportConversationAttachmentRecord,
  ) {
    const conversations = this.state.conversations ??= {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    };
    conversations.attachments.push(structuredClone(record));
    this.writes += 1;
  }

  async insertConversationProviderCheckpoint(
    _userId: string,
    record: ExportConversationProviderCheckpointRecord,
  ) {
    const conversations = this.state.conversations ??= {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    };
    conversations.provider_checkpoints.push(
      structuredClone(record),
    );
    this.writes += 1;
  }

  async insertMind(
    _userId: string,
    record: HistoricalMindStateRecord,
  ) {
    const mind = this.state.mind ??= [];
    mind.push(structuredClone(record));
    this.writes += 1;
  }

  async insertMindDriveSatisfactionEvent(
    _userId: string,
    record: ExportMindDriveSatisfactionEventRecord,
  ) {
    const continuity = this.state.mind_continuity ??= {
      drive_satisfaction_events: [],
      curiosity_resolution_events: [],
      distillation_watermarks: [],
      semantic_grouping_results: [],
    };
    continuity.drive_satisfaction_events.push(
      structuredClone(record),
    );
    this.writes += 1;
  }

  async insertMindCuriosityResolutionEvent(
    _userId: string,
    record: ExportMindCuriosityResolutionEventRecord,
  ) {
    const continuity = this.state.mind_continuity ??= {
      drive_satisfaction_events: [],
      curiosity_resolution_events: [],
      distillation_watermarks: [],
      semantic_grouping_results: [],
    };
    continuity.curiosity_resolution_events.push(
      structuredClone(record),
    );
    this.writes += 1;
  }

  async insertMindDistillationWatermark(
    _userId: string,
    record: ExportMindDistillationWatermarkRecord,
  ) {
    const continuity = this.state.mind_continuity ??= {
      drive_satisfaction_events: [],
      curiosity_resolution_events: [],
      distillation_watermarks: [],
      semantic_grouping_results: [],
    };
    continuity.distillation_watermarks.push(
      structuredClone(record),
    );
    this.writes += 1;
  }

  async insertMindSemanticGroupingResult(
    _userId: string,
    record: ExportMindSemanticGroupingResultRecord,
  ) {
    const continuity = this.state.mind_continuity ??= {
      drive_satisfaction_events: [],
      curiosity_resolution_events: [],
      distillation_watermarks: [],
      semantic_grouping_results: [],
    };
    continuity.semantic_grouping_results.push(
      structuredClone(record),
    );
    this.writes += 1;
  }

  async insertProjectWorkspace(
    _userId: string,
    record: ExportProjectWorkspaceRecord,
  ) {
    const projects = this.state.projects ??= {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    };
    projects.workspaces.push(structuredClone(record));
    projects.projects.push({
      id: record.id,
      workspace_id: record.id,
      name: record.name,
      description: record.description,
      version: record.version,
      created_at: record.created_at,
      updated_at: record.updated_at,
    });
    this.writes += 1;
  }

  async insertProject(
    _userId: string,
    record: ExportProjectRecord,
  ) {
    const projects = this.state.projects ??= {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    };
    projects.workspaces.push({
      id: record.id,
      name: record.name,
      description: record.description,
      version: record.version,
      created_at: record.created_at,
      updated_at: record.updated_at,
    });
    projects.projects.push({
      ...structuredClone(record),
      workspace_id: record.id,
    });
    this.writes += 1;
  }

  async insertProjectResource(
    _userId: string,
    record: ExportProjectResourceRecord,
  ) {
    const projects = this.state.projects ??= {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    };
    projects.resources.push(structuredClone(record));
    this.writes += 1;
  }

  async insertProjectConversation(
    _userId: string,
    record: ExportProjectConversationRecord,
  ) {
    const projects = this.state.projects ??= {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    };
    projects.conversations.push(structuredClone(record));
    this.writes += 1;
  }

  async rereadCreatedState(
    _userId: string,
    modules: Set<ImportModule>,
  ) {
    return {
      diary: modules.has("diary")
        ? structuredClone(this.state.diary)
        : [],
      diary_comments: modules.has("diary_comments")
        ? structuredClone(this.state.diary_comments ?? [])
        : undefined,
      todo: modules.has("todo")
        ? structuredClone(this.state.todo)
        : [],
      universe: modules.has("universe")
        ? structuredClone(this.state.universe ?? null)
        : undefined,
      mind: modules.has("mind")
        ? structuredClone(this.state.mind ?? [])
        : undefined,
      mind_continuity: modules.has("mind")
        ? structuredClone(this.state.mind_continuity ?? {
            drive_satisfaction_events: [],
            curiosity_resolution_events: [],
            distillation_watermarks: [],
            semantic_grouping_results: [],
          })
        : undefined,
      conversations: modules.has("conversations")
        ? structuredClone(this.state.conversations ?? {
            conversations: [],
            messages: [],
            content_blocks: [],
            attachments: [],
            provider_checkpoints: [],
          })
        : undefined,
      projects: modules.has("workspaces")
        ? structuredClone(this.state.projects ?? {
            workspaces: [],
            projects: [],
            resources: [],
            conversations: [],
          })
        : undefined,
    };
  }

  async recordAuditRun(
    _userId: string,
    run: ImportAuditRun,
  ) {
    this.audits.push(
      structuredClone(run),
    );
  }
}

export const watermarkOnlyContinuity: ExportMindContinuityBundle = {
  drive_satisfaction_events: [],
  curiosity_resolution_events: [],
  distillation_watermarks: mindContinuity.distillation_watermarks,
  semantic_grouping_results: [],
};

export function emptyContinuityRepository() {
  return new FakeImportRepository({
    diary: [],
    todo: [],
    mind: [],
    mind_continuity: {
      drive_satisfaction_events: [],
      curiosity_resolution_events: [],
      distillation_watermarks: [],
      semantic_grouping_results: [],
    },
    conversations: {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    },
  });
}
