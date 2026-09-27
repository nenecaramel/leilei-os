import assert from "node:assert/strict";
import test from "node:test";
import {
  ExportService,
  type ExportRepository,
} from "../src/domains/export/export-service.js";
import type {
  ExportDiaryRecord,
  ExportLifecycleEvent,
  ExportMindStateRecord,
  ExportProjectsBundle,
  ExportToolActivity,
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
  source: "web",
  author: "G",
  status: "archived",
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

const projects: ExportProjectsBundle = {
  workspaces: [],
  projects: [],
  resources: [],
  conversations: [],
};

const mind: ExportMindStateRecord[] = [];

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
  return {
    async findUserById() {
      return { status: "active" };
    },
    async listDiary(userId) {
      calls.push(`diary:${userId}`);
      return diary;
    },
    async listTodo(userId) {
      calls.push(`todo:${userId}`);
      return todo;
    },
    async listProjects(userId) {
      calls.push(`projects:${userId}`);
      return projects;
    },
    async listMind(userId) {
      calls.push(`mind:${userId}`);
      return mind;
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
}

test("ExportService emits the owner-bound v3 contract", async () => {
  const document = await new ExportService(
    createRepository(),
    () => new Date(EXPORTED_AT),
  ).createExport(USER_ID, "diary", false);

  assert.deepEqual(
    Object.keys(document),
    ["schema_version", "owner_fingerprint", "exported_at", "data"],
  );
  assert.equal(document.schema_version, 3);
  assert.equal(document.owner_fingerprint, createOwnerFingerprint(USER_ID));
  assert.equal(document.exported_at, EXPORTED_AT);
  assert.deepEqual(document.data, { diary });
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

    assert.deepEqual(Object.keys(document.data), [key]);
    assert.deepEqual(calls, [`${key}:${USER_ID}`]);
  }
});

test("ExportService reads Diary, Todo, and Projects for all scope", async () => {
  const calls: string[] = [];
  const document = await new ExportService(
    createRepository(calls),
    () => new Date(EXPORTED_AT),
  ).createExport(USER_ID, "all", false);

  assert.deepEqual(
    Object.keys(document.data),
    ["diary", "todo", "projects", "mind"],
  );
  assert.deepEqual(calls, [
    `diary:${USER_ID}`,
    `todo:${USER_ID}`,
    `projects:${USER_ID}`,
    `mind:${USER_ID}`,
  ]);
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
