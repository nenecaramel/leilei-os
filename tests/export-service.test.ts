import assert from "node:assert/strict";
import test from "node:test";
import {
  ExportService,
  type ExportRepository,
} from "../src/domains/export/export-service.js";
import type {
  ExportDiaryRecord,
  ExportLifecycleEvent,
  ExportMemoryRecord,
  ExportTaskRecord,
  ExportToolActivity,
  ExportTodoPaper,
} from "../src/domains/export/export-types.js";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";

const USER_ID = "user-export-service";
const EXPORTED_AT = "2026-08-13T05:42:00.000Z";

const memory: ExportMemoryRecord[] = [{
  id: "memory-1",
  category: "profile",
  key: "name",
  content: "Leilei",
  tags: [],
  visibility: "assistant",
  source: "web",
  author: "L",
  status: "active",
  sort_order: 1,
  created_at: EXPORTED_AT,
  updated_at: EXPORTED_AT,
}];
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
const task: ExportTaskRecord[] = [{
  id: "task-1",
  title: "Read",
  description: "Read the spec",
  status: "pending",
  resume_status: null,
  lifecycle_status: "active",
  author: null,
  priority: "normal",
  due_time: null,
  timezone: "Asia/Shanghai",
  tags: [],
  created_at: EXPORTED_AT,
  updated_at: EXPORTED_AT,
  completed_at: null,
}];
const todo: ExportTodoPaper[] = [{
  date: "2026-08-13",
  author: "L",
  revision: 1,
  created_at: EXPORTED_AT,
  updated_at: EXPORTED_AT,
  entries: [],
}];
const lifecycle: ExportLifecycleEvent[] = [{
  id: "lifecycle-1",
  resource_type: "memory",
  resource_id: "memory-1",
  action: "archive",
  actor_type: "user",
  channel: "web",
  created_at: EXPORTED_AT,
}];
const toolActivity: ExportToolActivity[] = [{
  id: "tool-1",
  tool_name: "write_memory",
  operation: "create",
  resource_type: "memory",
  resource_id: "memory-1",
  status: "success",
  error_code: null,
  created_at: EXPORTED_AT,
}];

function createRepository(calls: string[] = []): ExportRepository {
  return {
    async findUserById() { return { status: "active" }; },
    async listMemory(userId) { calls.push(`memory:${userId}`); return memory; },
    async listDiary(userId) { calls.push(`diary:${userId}`); return diary; },
    async listTasks(userId) { calls.push(`task:${userId}`); return task; },
    async listTodo(userId) { calls.push(`todo:${userId}`); return todo; },
    async listLifecycleAudit(userId) { calls.push(`lifecycle:${userId}`); return lifecycle; },
    async listToolActivity(userId) { calls.push(`tool:${userId}`); return toolActivity; },
  };
}

test("ExportService emits the v2 owner-bound contract with a fixed UTC timestamp", async () => {
  const document = await new ExportService(
    createRepository(),
    () => new Date(EXPORTED_AT),
  ).createExport(USER_ID, "memory", false);

  assert.deepEqual(Object.keys(document), ["schema_version", "owner_fingerprint", "exported_at", "data"]);
  assert.equal(document.schema_version, 2);
  assert.equal(document.owner_fingerprint, createOwnerFingerprint(USER_ID));
  assert.equal(document.exported_at, EXPORTED_AT);
  assert.deepEqual(document.data, { memory });
  assert.equal("audit" in document, false);
});

test("ExportService preserves C exactly for every author-bearing business record", async () => {
  const cMemory: ExportMemoryRecord = { ...memory[0]!, author: "C" };
  const cDiary: ExportDiaryRecord = { ...diary[0]!, author: "C" };
  const cTask: ExportTaskRecord = { ...task[0]!, author: "C" };
  const cTodo: ExportTodoPaper = { ...todo[0]!, author: "C" };
  const repository = createRepository();
  repository.listMemory = async () => [cMemory];
  repository.listDiary = async () => [cDiary];
  repository.listTasks = async () => [cTask];
  repository.listTodo = async () => [cTodo];

  const document = await new ExportService(repository, () => new Date(EXPORTED_AT))
    .createExport(USER_ID, "all", false);

  assert.deepEqual(document.data, {
    memory: [cMemory],
    diary: [cDiary],
    task: [cTask],
    todo: [cTodo],
  });
});

test("ExportService owner fingerprint is deterministic and does not expose the user id", async () => {
  const first = await new ExportService(createRepository(), () => new Date(EXPORTED_AT))
    .createExport(USER_ID, "memory", false);
  const second = await new ExportService(createRepository(), () => new Date(EXPORTED_AT))
    .createExport(USER_ID, "memory", false);
  const other = await new ExportService(createRepository(), () => new Date(EXPORTED_AT))
    .createExport("another-user", "memory", false);

  assert.equal(first.owner_fingerprint, second.owner_fingerprint);
  assert.notEqual(first.owner_fingerprint, other.owner_fingerprint);
  assert.match(first.owner_fingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(first).includes(USER_ID), false);
});

test("ExportService reads only the selected single-module scope", async () => {
  for (const [scope, key] of [
    ["memory", "memory"],
    ["diary", "diary"],
    ["task", "task"],
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

test("ExportService reads all business modules for all scope", async () => {
  const calls: string[] = [];
  const document = await new ExportService(
    createRepository(calls),
    () => new Date(EXPORTED_AT),
  ).createExport(USER_ID, "all", false);

  assert.deepEqual(Object.keys(document.data), ["memory", "diary", "task", "todo"]);
  assert.deepEqual(calls, [
    `memory:${USER_ID}`,
    `diary:${USER_ID}`,
    `task:${USER_ID}`,
    `todo:${USER_ID}`,
  ]);
});

test("ExportService omits audit reads by default and includes only requested audit sections", async () => {
  const calls: string[] = [];
  const document = await new ExportService(
    createRepository(calls),
    () => new Date(EXPORTED_AT),
  ).createExport(USER_ID, "all", true);

  assert.deepEqual(Object.keys(document.audit ?? {}), ["lifecycle", "tool_activity"]);
  assert.deepEqual(document.audit, { lifecycle, tool_activity: toolActivity });
  assert.equal(calls.includes(`lifecycle:${USER_ID}`), true);
  assert.equal(calls.includes(`tool:${USER_ID}`), true);
});

test("ExportService does not return a partial document when a repository read fails", async () => {
  const repository = createRepository();
  repository.listDiary = async () => { throw new Error("database unavailable"); };
  await assert.rejects(
    new ExportService(repository).createExport(USER_ID, "all", false),
    /database unavailable/u,
  );
});
