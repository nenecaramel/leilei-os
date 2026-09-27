import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Request } from "express";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";
import { ExportService, ExportServiceError, type ExportRepository } from "../src/domains/export/export-service.js";
import { ImportAuthorizationError, ImportService } from "../src/domains/import/import-service.js";
import type { ImportRepository } from "../src/domains/import/import-repository.js";
import { SystemService, SystemServiceError, type SystemRepository } from "../src/domains/system/system-service.js";
import { TodoService, TodoServiceError } from "../src/domains/todo/todo-service.js";
import type { TodoRepository } from "../src/domains/todo/todo-types.js";
import { createWebApiRouter } from "../src/web-api/router.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const ACTIVE = { status: "active" as const };
const DISABLED = { status: "disabled" as const };
const packageBytes = new TextEncoder().encode(JSON.stringify({
  schema_version: 2,
  owner_fingerprint: createOwnerFingerprint(USER_ID),
  exported_at: "2026-08-14T00:00:00.000Z",
  data: { memory: [] },
}));

function assertUserRejection(error: unknown, code: "USER_DISABLED" | "USER_NOT_FOUND"): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

test("TodoService rejects disabled and missing users before read or write repository work", async () => {
  for (const user of [DISABLED, null]) {
    let reads = 0;
    let writes = 0;
    const repository = {
      findUserById: async () => user,
      readDay: async () => { reads += 1; return { L: null, G: null, C: null }; },
      listContentDates: async () => { reads += 1; return []; },
      replacePaper: async () => { writes += 1; return { outcome: "committed", paper: { author: "L", date: "2026-08-14", revision: 1, entries: [] } }; },
    } as unknown as TodoRepository;
    const service = new TodoService(repository);
    const code = user ? "USER_DISABLED" : "USER_NOT_FOUND";
    await assert.rejects(() => service.readDay(USER_ID, "2026-08-14"), (error: unknown) => assertUserRejection(error, code));
    await assert.rejects(() => service.replacePaper({ userId: USER_ID, date: "2026-08-14", author: "L", revision: null, entries: [] }), (error: unknown) => assertUserRejection(error, code));
    assert.equal(reads, 0);
    assert.equal(writes, 0);
  }
});

test("TodoService preserves active-user behavior", async () => {
  let calls = 0;
  const repository = {
    findUserById: async () => ACTIVE,
    readDay: async () => { calls += 1; return { L: null, G: null, C: null }; },
    listContentDates: async () => [],
    replacePaper: async () => { calls += 1; return { outcome: "committed", paper: { author: "L", date: "2026-08-14", revision: 1, entries: [] } }; },
  } as unknown as TodoRepository;
  const service = new TodoService(repository);
  assert.deepEqual(await service.readDay(USER_ID, "2026-08-14"), { date: "2026-08-14", papers: { L: null, G: null, C: null } });
  await service.replacePaper({ userId: USER_ID, date: "2026-08-14", author: "L", revision: null, entries: [] });
  assert.equal(calls, 2);
});

test("TodoService rechecks durable status for an already-established caller", async () => {
  let status: "active" | "disabled" = "active";
  let reads = 0;
  const repository = {
    findUserById: async () => ({ status }),
    readDay: async () => { reads += 1; return { L: null, G: null, C: null }; },
    listContentDates: async () => [],
    replacePaper: async () => ({ outcome: "committed", paper: { author: "L", date: "2026-08-14", revision: 1, entries: [] } }),
  } as unknown as TodoRepository;
  const service = new TodoService(repository);
  await service.readDay(USER_ID, "2026-08-14");
  status = "disabled";
  await assert.rejects(() => service.readDay(USER_ID, "2026-08-14"), (error: unknown) => assertUserRejection(error, "USER_DISABLED"));
  assert.equal(reads, 1);
});

test("SystemService rejects disabled and missing users before summary or activity reads", async () => {
  for (const user of [DISABLED, null]) {
    let reads = 0;
    const repository = {
      findUserById: async () => user,
      readDataSummary: async () => { reads += 1; return { memory: { active: 0, archived: 0 }, diary: { active: 0, archived: 0 }, task: { active: 0, archived: 0 }, shared_paper: { active: 0, archived: 0 }, todo: { active: 0 } }; },
      listLifecycleActivity: async () => { reads += 1; return []; },
      listToolActivity: async () => { reads += 1; return []; },
    } as unknown as SystemRepository;
    const service = new SystemService(repository);
    const code = user ? "USER_DISABLED" : "USER_NOT_FOUND";
    await assert.rejects(() => service.readDataSummary(USER_ID), (error: unknown) => assertUserRejection(error, code));
    await assert.rejects(() => service.readActivity(USER_ID), (error: unknown) => assertUserRejection(error, code));
    assert.equal(reads, 0);
  }
});

function createExportRepository(user: { status: "active" | "disabled" } | null, calls: string[]): ExportRepository {
  const repository = {
    async withConsistentSnapshot(
      work: (snapshot: ExportRepository) => Promise<unknown>,
    ) {
      return work(repository as unknown as ExportRepository);
    },
    findUserById: async () => user,
    async listDiary() { calls.push("diary"); return []; },
    async listDiaryComments() { calls.push("diary_comments"); return []; },
    async listTodo() { calls.push("todo"); return []; },
    async listProjects() {
      calls.push("projects");
      return {
        workspaces: [],
        projects: [],
        resources: [],
        conversations: [],
      };
    },
    async listMind() { calls.push("mind"); return []; },
    async listMindContinuity() {
      calls.push("mind_continuity");
      return {
        drive_satisfaction_events: [],
        curiosity_resolution_events: [],
        distillation_watermarks: [],
        semantic_grouping_results: [],
      };
    },
    async hasIncompleteMindFollowUps() { return false; },
    async hasIncompleteTurnPreparations() { return false; },
    async hasIncompleteMindSemanticGrouping() { return false; },
    async hasIncompleteBackgroundModelJobs() { return false; },
    async listConversations() {
      calls.push("conversations");
      return {
        conversations: [],
        messages: [],
        content_blocks: [],
        attachments: [],
        provider_checkpoints: [],
      };
    },
    async listUniverse() { calls.push("universe"); return null; },
    async listLifecycleAudit() { calls.push("lifecycle"); return []; },
    async listToolActivity() { calls.push("tool"); return []; },
  };
  return repository as unknown as ExportRepository;
}

test("ExportService rejects disabled and missing users before export reads", async () => {
  for (const user of [DISABLED, null]) {
    const calls: string[] = [];
    const service = new ExportService(createExportRepository(user, calls));
    const code = user ? "USER_DISABLED" : "USER_NOT_FOUND";
    await assert.rejects(() => service.createExport(USER_ID, "all", true), (error: unknown) => assertUserRejection(error, code));
    assert.deepEqual(calls, []);
  }
});

test("ImportService rejects disabled and missing users before preview or execute reads", async () => {
  for (const user of [DISABLED, null]) {
    let reads = 0;
    const repository = {
      findUserById: async () => user,
      readCurrentState: async () => { reads += 1; return { memory: [], diary: [], task: [], todo: [], foreign_memory_ids: new Set(), foreign_diary_ids: new Set(), foreign_task_ids: new Set() }; },
      withTransaction: async (work: (repository: ImportRepository) => Promise<unknown>) => work(repository as unknown as ImportRepository),
    } as unknown as ImportRepository;
    const service = new ImportService(repository);
    const code = user ? "USER_DISABLED" : "USER_NOT_FOUND";
    await assert.rejects(() => service.preview(packageBytes, USER_ID), (error: unknown) => assertUserRejection(error, code));
    await assert.rejects(() => service.execute(packageBytes, USER_ID, "a".repeat(64)), (error: unknown) => assertUserRejection(error, code));
    assert.equal(reads, 0);
  }
});

async function withApiServer(dependencies: Record<string, unknown>, callback: (url: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request: Request, _response, next) => {
    if (request.header("x-test-user")) request.webUserId = USER_ID;
    next();
  });
  app.use("/api/v1", createWebApiRouter(dependencies as never));
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  try { await callback(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("affected Web routes map durable user rejection to generic 403 envelopes", async () => {
  await withApiServer({
    todo: { todoService: { readDay: async () => { throw new TodoServiceError("USER_DISABLED" as never, "private disabled detail"); }, listDates: async () => [], replacePaper: async () => ({}) } },
    system: { systemService: { readConnections: async () => ({}), readDataSummary: async () => { throw new SystemServiceError("USER_DISABLED"); }, readActivity: async () => [] } },
    export: { exportService: { createExport: async () => { throw new ExportServiceError("USER_NOT_FOUND"); } } },
    import: { importService: { preview: async () => { throw new ImportAuthorizationError("USER_DISABLED"); }, execute: async () => { throw new ImportAuthorizationError("USER_DISABLED"); } } },
  }, async (url) => {
    const headers = { "x-test-user": "yes", "content-type": "application/octet-stream" };
    const cases = [
      fetch(`${url}/api/v1/todo/2026-08-14`, { headers: { "x-test-user": "yes" } }),
      fetch(`${url}/api/v1/system/data`, { headers: { "x-test-user": "yes" } }),
      fetch(`${url}/api/v1/system/export?scope=all`, { headers: { "x-test-user": "yes" } }),
      fetch(`${url}/api/v1/system/import/preview`, { method: "POST", headers, body: packageBytes }),
    ];
    const responses = await Promise.all(cases);
    for (const response of responses) {
      assert.equal(response.status, 403);
      const body = await response.json() as { error?: { message?: string } };
      assert.equal(body.error?.message?.includes("disabled"), false);
      assert.equal(body.error?.message?.includes("not found"), false);
    }
  });
});
