import assert from "node:assert/strict";
import test from "node:test";
import {
  ExportService,
  type ExportRepository,
} from "../src/domains/export/export-service.js";
import type {
  ExportConversationsBundle,
  ExportDiaryCommentRecord,
  ExportDiaryRecord,
  ExportLifecycleEvent,
  ExportMindContinuityBundle,
  ExportMindStateRecord,
  ExportWorkspacesBundle,
  ExportToolActivity,
  ExportUniverseBundle,
  ExportTodoPaper,
} from "../src/domains/export/export-types.js";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";

const USER_ID = "user-export-service";
const EXPORTED_AT = "2026-08-13T05:42:00.000Z";

const diary: ExportDiaryRecord[] = [{
  id: "diary-1",
  title: "Today",
  content: "A note",
  date: "2026-08-13",
  tags: [],
  mood: null,
  source: "chatgpt_mcp",
  author: "G",
  status: "archived",
  created_at: EXPORTED_AT,
  updated_at: EXPORTED_AT,
}];

const diaryComments: ExportDiaryCommentRecord[] = [{
  id: "00000000-0000-4000-8000-000000000071",
  diary_id: "diary-1",
  author: "G",
  content: "Comment",
  revision: 2,
  created_at: EXPORTED_AT,
  updated_at: EXPORTED_AT,
}];

const todo: ExportTodoPaper[] = [{
  date: "2026-08-13",
  author: "C",
  revision: 1,
  created_at: EXPORTED_AT,
  updated_at: EXPORTED_AT,
  entries: [],
}];

const workspaces: ExportWorkspacesBundle = {
  items: [],
  resources: [],
  conversations: [],
};

const mind: ExportMindStateRecord[] = [];

const mindContinuity: ExportMindContinuityBundle = {
  drive_satisfaction_events: [],
  curiosity_resolution_events: [],
  distillation_watermarks: [],
  semantic_grouping_results: [],
};

const universe: ExportUniverseBundle | null = null;

const conversations: ExportConversationsBundle = {
  conversations: [],
  messages: [],
  content_blocks: [],
  attachments: [],
  provider_checkpoints: [],
};

const lifecycle: ExportLifecycleEvent[] = [{
  id: "lifecycle-1",
  resource_type: "diary",
  resource_id: "diary-1",
  action: "archive",
  actor_type: "user",
  channel: "web",
  created_at: EXPORTED_AT,
}];

const toolActivity: ExportToolActivity[] = [{
  id: "tool-1",
  tool_name: "write_diary",
  operation: "create",
  resource_type: "diary_entry",
  resource_id: "diary-1",
  status: "success",
  error_code: null,
  created_at: EXPORTED_AT,
}];

function createRepository(calls: string[] = []): ExportRepository {
  const repository: ExportRepository = {
    async withConsistentSnapshot(work) {
      calls.push("snapshot");
      return work(repository);
    },
    async findUserById() {
      return { status: "active" };
    },
    async listDiary(userId) {
      calls.push(`diary:${userId}`);
      return diary;
    },
    async listDiaryComments(userId) {
      calls.push(`diary_comments:${userId}`);
      return diaryComments;
    },
    async listTodo(userId) {
      calls.push(`todo:${userId}`);
      return todo;
    },
    async listWorkspaces(userId) {
      calls.push(`workspaces:${userId}`);
      return workspaces;
    },
    async listMind(userId) {
      calls.push(`mind:${userId}`);
      return mind;
    },
    async listMindContinuity(userId) {
      calls.push(`mind_continuity:${userId}`);
      return mindContinuity;
    },
    async hasIncompleteMindFollowUps(userId) {
      calls.push(`mind_quiescence:${userId}`);
      return false;
    },
    async hasIncompleteTurnPreparations(userId) {
      calls.push(`turn_quiescence:${userId}`);
      return false;
    },
    async hasIncompleteMindSemanticGrouping(userId) {
      calls.push(`semantic_grouping_quiescence:${userId}`);
      return false;
    },
    async hasIncompleteBackgroundModelJobs(userId) {
      calls.push(`background_model_quiescence:${userId}`);
      return false;
    },
    async listConversations(userId) {
      calls.push(`conversations:${userId}`);
      return conversations;
    },
    async listUniverse(userId) {
      calls.push(`universe:${userId}`);
      return universe;
    },
    async listLifecycleAudit(userId) {
      calls.push(`lifecycle:${userId}`);
      return lifecycle;
    },
    async listToolActivity(userId) {
      calls.push(`tool:${userId}`);
      return toolActivity;
    },
  };
  return repository;
}

test("ExportService emits the owner-bound v4 contract", async () => {
  const document = await new ExportService(
    createRepository(),
    () => new Date(EXPORTED_AT),
  ).createExport(USER_ID, "diary", false);

  assert.deepEqual(
    Object.keys(document),
    ["schema_version", "owner_fingerprint", "exported_at", "data"],
  );
  assert.equal(document.schema_version, 4);
  assert.equal(document.owner_fingerprint, createOwnerFingerprint(USER_ID));
  assert.equal(document.exported_at, EXPORTED_AT);
  assert.deepEqual(document.data, {
    diary,
    diary_comments: diaryComments,
  });
  assert.equal("audit" in document, false);
});

test("ExportService preserves C exactly in Todo exports", async () => {
  const document = await new ExportService(
    createRepository(),
    () => new Date(EXPORTED_AT),
  ).createExport(USER_ID, "todo", false);

  assert.deepEqual(document.data, { todo });
  assert.equal(document.data.todo?.[0]?.author, "C");
});

test("ExportService reads only the selected active-module scope", async () => {
  for (const [scope, key] of [
    ["diary", "diary"],
    ["todo", "todo"],
  ] as const) {
    const calls: string[] = [];
    const document = await new ExportService(
      createRepository(calls),
      () => new Date(EXPORTED_AT),
    ).createExport(USER_ID, scope, false);

    assert.deepEqual(
      Object.keys(document.data),
      scope === "diary"
        ? ["diary", "diary_comments"]
        : [key],
    );
    assert.deepEqual(
      calls,
      scope === "diary"
        ? [
            "snapshot",
            `diary:${USER_ID}`,
            `diary_comments:${USER_ID}`,
          ]
        : [
            "snapshot",
            `${key}:${USER_ID}`,
          ],
    );
  }
});

test("ExportService reads the full portable v4 scope", async () => {
  const calls: string[] = [];
  const document = await new ExportService(
    createRepository(calls),
    () => new Date(EXPORTED_AT),
  ).createExport(USER_ID, "all", false);

  assert.deepEqual(
    Object.keys(document.data),
    [
      "diary",
      "diary_comments",
      "todo",
      "workspaces",
      "mind",
      "mind_continuity",
      "conversations",
      "universe",
    ],
  );
  assert.deepEqual(calls, [
    "snapshot",
    `diary:${USER_ID}`,
    `diary_comments:${USER_ID}`,
    `todo:${USER_ID}`,
    `turn_quiescence:${USER_ID}`,
    `mind_quiescence:${USER_ID}`,
    `workspaces:${USER_ID}`,
    `mind:${USER_ID}`,
    `mind_continuity:${USER_ID}`,
    `conversations:${USER_ID}`,
    `universe:${USER_ID}`,
  ]);
});

test("ExportService does not block a portable snapshot on semantic grouping work", async () => {
  const repository = createRepository();
  repository.hasIncompleteMindSemanticGrouping = async () => {
    throw new Error("semantic grouping quiescence must not be consulted");
  };

  const document = await new ExportService(repository).createExport(
    USER_ID,
    "all",
    false,
  );
  assert.equal(document.schema_version, 4);
});

test("ExportService does not block a portable snapshot on background model work", async () => {
  const repository = createRepository();
  repository.hasIncompleteBackgroundModelJobs = async () => {
    throw new Error("background model quiescence must not be consulted");
  };

  const document = await new ExportService(repository).createExport(
    USER_ID,
    "all",
    false,
  );
  assert.equal(document.schema_version, 4);
});

test("ExportService rejects all export while a native turn is prepared", async () => {
  const repository = createRepository();
  repository.hasIncompleteTurnPreparations =
    async () => true;

  await assert.rejects(
    new ExportService(repository).createExport(
      USER_ID,
      "all",
      false,
    ),
    (error: unknown) =>
      error instanceof Error
      && "code" in error
      && error.code === "EXPORT_IN_PROGRESS"
      && "reason" in error
      && error.reason === "prepared_turn",
  );
});

test("ExportService rejects all export while Mind follow-up is incomplete", async () => {
  const repository = createRepository();
  repository.hasIncompleteMindFollowUps = async () => true;

  await assert.rejects(
    new ExportService(repository).createExport(
      USER_ID,
      "all",
      false,
    ),
    (error: unknown) =>
      error instanceof Error
      && "code" in error
      && error.code === "EXPORT_IN_PROGRESS"
      && "reason" in error
      && error.reason === "mind_followup",
  );
});

test("ExportService rejects an all export while a canonical turn is in progress", async () => {
  const repository = createRepository();
  repository.listConversations = async () => ({
    conversations: [],
    messages: [{
      id: "00000000-0000-4000-8000-000000000001",
      conversation_id:
        "00000000-0000-4000-8000-000000000002",
      parent_message_id: null,
      role: "assistant",
      status: "streaming",
      raw_role: null,
      model: null,
      is_current_path: true,
      current_path_index: 0,
      turn_index: 0,
      is_primary: true,
      display_text: "",
      created_at: EXPORTED_AT,
      completed_at: null,
      updated_at: EXPORTED_AT,
    }],
    content_blocks: [],
    attachments: [],
    provider_checkpoints: [],
  });

  await assert.rejects(
    new ExportService(repository).createExport(
      USER_ID,
      "all",
      false,
    ),
    (error: unknown) =>
      error instanceof Error
      && "code" in error
      && error.code === "EXPORT_IN_PROGRESS"
      && "reason" in error
      && error.reason === "canonical_message",
  );
});

test("ExportService includes audit only when requested", async () => {
  const calls: string[] = [];
  const document = await new ExportService(
    createRepository(calls),
    () => new Date(EXPORTED_AT),
  ).createExport(USER_ID, "all", true);

  assert.deepEqual(document.audit, {
    lifecycle,
    tool_activity: toolActivity,
  });
  assert.equal(calls.includes(`lifecycle:${USER_ID}`), true);
  assert.equal(calls.includes(`tool:${USER_ID}`), true);
});

test("ExportService owner fingerprint is deterministic and opaque", async () => {
  const first = await new ExportService(
    createRepository(),
    () => new Date(EXPORTED_AT),
  ).createExport(USER_ID, "diary", false);
  const second = await new ExportService(
    createRepository(),
    () => new Date(EXPORTED_AT),
  ).createExport(USER_ID, "diary", false);
  const other = await new ExportService(
    createRepository(),
    () => new Date(EXPORTED_AT),
  ).createExport("another-user", "diary", false);

  assert.equal(first.owner_fingerprint, second.owner_fingerprint);
  assert.notEqual(first.owner_fingerprint, other.owner_fingerprint);
  assert.match(first.owner_fingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(first).includes(USER_ID), false);
});

test("ExportService does not return a partial document after a repository failure", async () => {
  const repository = createRepository();
  repository.listDiary = async () => {
    throw new Error("database unavailable");
  };

  await assert.rejects(
    new ExportService(repository).createExport(
      USER_ID,
      "all",
      false,
    ),
    /database unavailable/u,
  );
});
