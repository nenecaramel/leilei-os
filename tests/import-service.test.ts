import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";
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
  ExportMindStateRecord,
  ExportProjectConversationRecord,
  ExportProjectRecord,
  ExportProjectResourceRecord,
  ExportProjectsBundle,
  ExportProjectWorkspaceRecord,
  ExportTodoPaper,
  ExportUniverseBundle,
} from "../src/domains/export/export-types.js";
import {
  ImportService,
} from "../src/domains/import/import-service.js";
import type {
  ImportAuditRun,
  ImportRepository,
} from "../src/domains/import/import-repository.js";
import type {
  ImportCurrentState,
  ImportModule,
} from "../src/domains/import/import-planner.js";
import {
  ImportValidationError,
} from "../src/domains/import/import-schema.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const NOW = "2026-08-14T00:00:00.000Z";

const diary: ExportDiaryRecord = {
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

const diaryComment: ExportDiaryCommentRecord = {
  id: "00000000-0000-4000-8000-000000000072",
  diary_id: diary.id,
  author: "G",
  content: "Comment",
  revision: 2,
  created_at: NOW,
  updated_at: NOW,
};

const todo: ExportTodoPaper = {
  date: "2026-08-13",
  author: "C",
  revision: 2,
  created_at: NOW,
  updated_at: NOW,
  entries: [
    { id: "entry-1", kind: "pending", text: "Todo" },
  ],
};

const universeBundle: ExportUniverseBundle = {
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

const CONVERSATION_ID =
  "00000000-0000-4000-8000-000000000041";
const mindState: ExportMindStateRecord = {
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


const driveState: ExportMindStateRecord = {
  ...mindState,
  id: "00000000-0000-4000-8000-000000000064",
  kind: "drive",
  text: "Durable drive",
  payload: { drive_v1: { phase: "active" } },
};

const driveCandidateState: ExportMindStateRecord = {
  ...mindState,
  id: "00000000-0000-4000-8000-000000000068",
  kind: "drive",
  text: "Earlier durable drive",
  payload: { drive_v1: { phase: "active" } },
};

const curiosityState: ExportMindStateRecord = {
  ...mindState,
  id: "00000000-0000-4000-8000-000000000065",
  kind: "curiosity",
  text: "Durable curiosity",
  payload: { curiosity_v1: { phase: "resolved" } },
};

const conversationBundle: ExportConversationsBundle = {
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
    workspace_id: null,
    effective_workspace_root: null,
    runtime_metadata: {
      context_window: 200000,
    },
    provider_checkpoint_id: "checkpoint-roundtrip-1",
    created_at: NOW,
  }],
};

const mindContinuity: ExportMindContinuityBundle = {
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

const projectBundle: ExportProjectsBundle = {
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

const canonicalProjectBundle: ExportProjectsBundle = {
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

function packageBytes(
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

function v3PackageBytes(
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

function cloneState(
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

class FakeImportRepository implements ImportRepository {
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
    record: ExportMindStateRecord,
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
      projects: modules.has("projects")
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

test("preview reports active Diary and Todo creates", async () => {
  const repository =
    new FakeImportRepository();
  const service =
    new ImportService(repository);

  const preview = await service.preview(
    packageBytes(),
    USER_ID,
  );

  assert.equal(preview.summary.diary.create, 1);
  assert.equal(preview.summary.todo.create, 1);
  assert.equal(preview.can_execute, true);
  assert.equal(repository.writes, 0);
});

test("execute restores active modules and records safe audit metadata", async () => {
  const repository =
    new FakeImportRepository();
  const service =
    new ImportService(repository);
  const raw = packageBytes();

  const preview = await service.preview(
    raw,
    USER_ID,
  );
  const result = await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.equal(result.summary.diary.create, 1);
  assert.equal(result.summary.todo.create, 1);
  assert.deepEqual(repository.state.diary, [diary]);
  assert.deepEqual(repository.state.todo, [todo]);
  assert.equal(repository.writes, 2);
  assert.equal(repository.audits.length, 1);
  assert.equal(
    JSON.stringify(repository.audits[0]).includes(
      diary.content,
    ),
    false,
  );
});

test("execute preserves C author values", async () => {
  const repository =
    new FakeImportRepository();
  const service =
    new ImportService(repository);
  const raw = packageBytes();

  const preview = await service.preview(
    raw,
    USER_ID,
  );
  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.equal(
    repository.state.diary[0]?.author,
    "C",
  );
  assert.equal(
    repository.state.todo[0]?.author,
    "C",
  );
});

test("execute rejects a stale preview and rolls back", async () => {
  const repository =
    new FakeImportRepository();
  const service =
    new ImportService(repository);
  const raw = packageBytes();

  const preview = await service.preview(
    raw,
    USER_ID,
  );
  repository.state.diary.push({
    ...diary,
    content: "Concurrent replacement",
  });

  await assert.rejects(
    service.execute(
      raw,
      USER_ID,
      preview.preview_fingerprint,
    ),
    (error: unknown) =>
      error instanceof ImportValidationError
      && error.code === "IMPORT_PREVIEW_STALE",
  );
  assert.equal(repository.writes, 0);
});

test("execute keeps a preview valid across unrelated concurrent records", async () => {
  const repository = new FakeImportRepository();
  const service = new ImportService(repository);
  const raw = packageBytes();

  const preview = await service.preview(
    raw,
    USER_ID,
  );
  repository.state.diary.push({
    ...diary,
    id: "00000000-0000-4000-8000-000000000032",
    title: "Unrelated",
  });

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.equal(
    repository.state.diary.some(
      (record) =>
        record.id
        === "00000000-0000-4000-8000-000000000032",
    ),
    true,
  );
  assert.equal(
    repository.state.diary.some(
      (record) => record.id === diary.id,
    ),
    true,
  );
});

test("execute rejects duplicate-only packages", async () => {
  const repository =
    new FakeImportRepository({
      diary: [diary],
      todo: [todo],
    });
  const service =
    new ImportService(repository);
  const raw = packageBytes();

  const preview = await service.preview(
    raw,
    USER_ID,
  );
  assert.equal(preview.can_execute, false);

  await assert.rejects(
    service.execute(
      raw,
      USER_ID,
      preview.preview_fingerprint,
    ),
    (error: unknown) =>
      error instanceof ImportValidationError
      && error.code
        === "IMPORT_NOTHING_TO_RESTORE",
  );
});

test("retired module records are rejected during preview", async () => {
  const repository =
    new FakeImportRepository();
  const service =
    new ImportService(repository);

  for (const data of [
    { memory: [] },
    { task: [] },
    { shared_paper: [] },
  ]) {
    await assert.rejects(
      service.preview(
        packageBytes(data),
        USER_ID,
      ),
      (error: unknown) =>
        error instanceof ImportValidationError
        && error.code === "INVALID_IMPORT_FILE",
    );
  }

  assert.equal(repository.writes, 0);
});

test("disabled users cannot preview imports", async () => {
  const repository =
    new FakeImportRepository();
  repository.status = "disabled";
  const service =
    new ImportService(repository);

  await assert.rejects(
    service.preview(
      packageBytes(),
      USER_ID,
    ),
  );
});


test("v3 preview and execute restore Projects atomically with exact product state", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    projects: {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    },
    native_live_conversation_ids:
      new Set([CONVERSATION_ID]),
  });
  const service = new ImportService(repository);
  const raw = v3PackageBytes();

  const preview = await service.preview(raw, USER_ID);
  assert.deepEqual(preview.summary.projects, {
    create: 3,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.equal(preview.can_execute, true);

  const result = await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.equal(result.summary.projects?.create, 3);
  assert.deepEqual(repository.state.projects, canonicalProjectBundle);
  assert.equal(repository.writes, 3);
  assert.equal(repository.audits[0]?.schema_version, 3);
});

test("v3 Projects preview rejects cross-user ids before any write", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    projects: {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    },
    foreign_workspace_ids:
      new Set([projectBundle.projects[0]!.id]),
    native_live_conversation_ids:
      new Set([CONVERSATION_ID]),
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes(),
    USER_ID,
  );

  assert.equal(preview.summary.projects?.conflict, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});


test("v3 Mind restore preserves durable state semantics exactly", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    mind: [],
  });
  const service = new ImportService(repository);
  const raw = v3PackageBytes({
    mind: [mindState],
  });

  const preview = await service.preview(raw, USER_ID);
  assert.deepEqual(preview.summary.mind, {
    create: 1,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.deepEqual(repository.state.mind, [mindState]);
  assert.equal(repository.writes, 1);
});

test("v3 Mind restore rejects a state id owned by another user", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    mind: [],
    foreign_mind_ids: new Set([mindState.id]),
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({ mind: [mindState] }),
    USER_ID,
  );

  assert.equal(preview.summary.mind?.conflict, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});


test("v3 all-state restore creates canonical conversations before Project membership", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    projects: {
      workspaces: [],
      projects: [],
      resources: [],
      conversations: [],
    },
    mind: [],
    conversations: {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    },
    native_live_conversation_ids: new Set(),
  });
  const service = new ImportService(repository);
  const raw = v3PackageBytes({
    conversations: conversationBundle,
    projects: projectBundle,
    mind: [mindState],
    diary: [diary],
    universe: universeBundle,
  });

  const preview = await service.preview(raw, USER_ID);
  assert.deepEqual(preview.summary.conversations, {
    create: 6,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.deepEqual(preview.summary.projects, {
    create: 3,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.equal(preview.can_execute, true);

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.deepEqual(
    repository.state.conversations,
    conversationBundle,
  );
  assert.deepEqual(
    repository.state.projects,
    projectBundle,
  );
  assert.deepEqual(repository.state.mind, [mindState]);
  assert.deepEqual(repository.state.universe, universeBundle);
  assert.equal(repository.writes, 12);
});

test("v3 conversation preview rejects a parent cycle before execute", async () => {
  const cyclic: ExportConversationsBundle = {
    ...conversationBundle,
    messages: conversationBundle.messages.map((message, index) => ({
      ...message,
      parent_message_id:
        index === 0
          ? conversationBundle.messages[1]!.id
          : conversationBundle.messages[0]!.id,
    })),
  };
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    conversations: {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    },
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({ conversations: cyclic }),
    USER_ID,
  );

  assert.ok((preview.summary.conversations?.invalid ?? 0) > 0);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});


test("v3 Diary scope restores comments after their parent Diary", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    diary_comments: [],
    todo: [],
  });
  const service = new ImportService(repository);
  const raw = v3PackageBytes({
    diary: [diary],
    diary_comments: [diaryComment],
  });

  const preview = await service.preview(raw, USER_ID);
  assert.equal(preview.summary.diary.create, 1);
  assert.equal(preview.summary.diary_comments?.create, 1);
  assert.equal(preview.can_execute, true);

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.deepEqual(repository.state.diary, [diary]);
  assert.deepEqual(
    repository.state.diary_comments,
    [diaryComment],
  );
  assert.equal(repository.writes, 2);
});

test("v3 Diary comment without an available parent is invalid", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    diary_comments: [],
    todo: [],
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({
      diary_comments: [diaryComment],
    }),
    USER_ID,
  );

  assert.equal(preview.summary.diary_comments?.invalid, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});


test("v3 scoped Mind restore preserves historical scope even after source deletion", async () => {
  const historical: ExportMindStateRecord = {
    ...mindState,
    id: "00000000-0000-4000-8000-000000000063",
    scope_applicability: "path",
    scope_conversation_id:
      "00000000-0000-4000-8000-000000000097",
    scope_path_head_message_id:
      "00000000-0000-4000-8000-000000000098",
  };
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    mind: [],
    conversations: {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    },
  });
  const service = new ImportService(repository);
  const raw = v3PackageBytes({
    mind: [historical],
  });

  const preview = await service.preview(raw, USER_ID);
  assert.equal(preview.summary.mind?.create, 1);
  assert.equal(preview.summary.mind?.invalid, 0);
  assert.equal(preview.can_execute, true);

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );
  assert.deepEqual(repository.state.mind, [historical]);
});

test("v3 Universe restore is atomic no-overwrite product state", async () => {
  const emptyRepository = new FakeImportRepository({
    diary: [diary],
    todo: [],
    universe: null,
  });
  const emptyService = new ImportService(emptyRepository);
  const raw = v3PackageBytes({
    universe: universeBundle,
  });

  const preview = await emptyService.preview(raw, USER_ID);
  assert.deepEqual(preview.summary.universe, {
    create: 1,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.equal(preview.can_execute, true);

  await emptyService.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );
  assert.deepEqual(
    emptyRepository.state.universe,
    universeBundle,
  );

  const duplicateRepository = new FakeImportRepository({
    diary: [diary],
    todo: [],
    universe: universeBundle,
  });
  const duplicatePreview = await new ImportService(
    duplicateRepository,
  ).preview(raw, USER_ID);
  assert.equal(
    duplicatePreview.summary.universe?.duplicate,
    1,
  );
  assert.equal(duplicatePreview.can_execute, false);

  const conflictRepository = new FakeImportRepository({
    diary: [diary],
    todo: [],
    universe: {
      ...universeBundle,
      version: universeBundle.version + 1,
    },
  });
  const conflictPreview = await new ImportService(
    conflictRepository,
  ).preview(raw, USER_ID);
  assert.equal(
    conflictPreview.summary.universe?.conflict,
    1,
  );
  assert.equal(conflictPreview.can_execute, false);
});

test("v3 Universe provenance rejects a missing Diary parent", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    universe: null,
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({
      universe: universeBundle,
    }),
    USER_ID,
  );

  assert.equal(preview.summary.universe?.invalid, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});


test("v3 Mind continuity restores semantic ledgers and watermark after canonical state", async () => {
  const repository = new FakeImportRepository({
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
  const service = new ImportService(repository);
  const raw = v3PackageBytes({
    conversations: conversationBundle,
    mind: [driveCandidateState, driveState, curiosityState],
    mind_continuity: mindContinuity,
  });

  const preview = await service.preview(raw, USER_ID);
  assert.equal(preview.summary.mind?.create, 7);
  assert.equal(preview.summary.mind?.invalid, 0);
  assert.equal(preview.can_execute, true);

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.deepEqual(
    repository.state.mind,
    [driveCandidateState, driveState, curiosityState],
  );
  assert.deepEqual(
    repository.state.mind_continuity,
    mindContinuity,
  );
  assert.equal(repository.writes, 13);
});

test("v3 Mind continuity rejects semantic events without canonical evidence", async () => {
  const repository = new FakeImportRepository({
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
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({
      mind: [driveCandidateState, driveState, curiosityState],
      mind_continuity: mindContinuity,
    }),
    USER_ID,
  );

  assert.ok((preview.summary.mind?.invalid ?? 0) >= 3);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});


test("v3 conversation checkpoint restore preserves continuation handle", async () => {
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    conversations: {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    },
  });
  const service = new ImportService(repository);

  const raw = v3PackageBytes({
    conversations: conversationBundle,
  });
  const preview = await service.preview(raw, USER_ID);

  assert.equal(preview.summary.conversations?.create, 6);
  assert.equal(preview.can_execute, true);

  await service.execute(
    raw,
    USER_ID,
    preview.preview_fingerprint,
  );

  assert.deepEqual(
    repository.state.conversations?.provider_checkpoints,
    conversationBundle.provider_checkpoints,
  );
});

test("v3 conversation checkpoint preview rejects a foreign checkpoint id", async () => {
  const checkpoint = conversationBundle.provider_checkpoints[0]!;
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    conversations: {
      conversations: [],
      messages: [],
      content_blocks: [],
      attachments: [],
      provider_checkpoints: [],
    },
    foreign_conversation_checkpoint_ids:
      new Set([checkpoint.id]),
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({
      conversations: conversationBundle,
    }),
    USER_ID,
  );

  assert.equal(preview.summary.conversations?.conflict, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});


test("v3 semantic grouping restore rejects a missing candidate state", async () => {
  const grouping =
    mindContinuity.semantic_grouping_results[0]!;
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    mind: [],
    mind_continuity: {
      drive_satisfaction_events: [],
      curiosity_resolution_events: [],
      distillation_watermarks: [],
      semantic_grouping_results: [],
    },
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({
      mind: [driveState],
      mind_continuity: {
        drive_satisfaction_events: [],
        curiosity_resolution_events: [],
        distillation_watermarks: [],
        semantic_grouping_results: [grouping],
      },
    }),
    USER_ID,
  );

  assert.equal(preview.summary.mind?.invalid, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});

test("v3 semantic grouping restore conflicts with an occupied nonterminal grouping key", async () => {
  const grouping =
    mindContinuity.semantic_grouping_results[0]!;
  const repository = new FakeImportRepository({
    diary: [],
    todo: [],
    mind: [driveCandidateState, driveState],
    mind_continuity: {
      drive_satisfaction_events: [],
      curiosity_resolution_events: [],
      distillation_watermarks: [],
      semantic_grouping_results: [],
    },
    occupied_semantic_grouping_keys: new Set([
      `${grouping.subject_id}:${grouping.kind}:${grouping.query_state_id}`,
    ]),
  });
  const service = new ImportService(repository);

  const preview = await service.preview(
    v3PackageBytes({
      mind_continuity: {
        drive_satisfaction_events: [],
        curiosity_resolution_events: [],
        distillation_watermarks: [],
        semantic_grouping_results: [grouping],
      },
    }),
    USER_ID,
  );

  assert.equal(preview.summary.mind?.conflict, 1);
  assert.equal(preview.can_execute, false);
  assert.equal(repository.writes, 0);
});
