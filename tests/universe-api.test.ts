import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createWebApiRouter } from "../src/web-api/router.js";
import { UniverseServiceError } from "../src/domains/universe/universe-service.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const snapshot = {
  schemaVersion: 2,
  meta: { name: "My Universe", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" },
  galaxies: [], nodes: [], relations: [], revisions: [],
};

type Service = Record<string, (...args: never[]) => unknown>;

function dependencies(universeService: Service) {
  return {
    memory: { memoryService: {} as never }, diary: { diaryService: {} as never }, task: { taskService: {} as never },
    toy: { toyService: {} as never }, system: { systemService: {} as never },
    universe: { universeService },
  } as never;
}

async function withServer(universeService: Service, callback: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => { if (request.header("x-test-user")) request.webUserId = USER_ID; next(); });
  app.use("/api/v1", createWebApiRouter(dependencies(universeService)));
  const server = await new Promise<import("node:http").Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  const address = server.address() as AddressInfo;
  try { await callback(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("Universe GET is authenticated, server-scoped, and private no-store", async () => {
  let calls = 0;
  await withServer({
    async loadUniverse(userId: string) { calls += 1; assert.equal(userId, USER_ID); return { snapshot, version: 3 }; },
  }, async (baseUrl) => {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/universe`);
    assert.equal(unauthenticated.status, 401);
    const response = await fetch(`${baseUrl}/api/v1/universe?user_id=attacker`, { headers: { "x-test-user": "yes" } });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const ok = await fetch(`${baseUrl}/api/v1/universe`, { headers: { "x-test-user": "yes" } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { success: true, data: { snapshot, version: 3 } });
  });
  assert.equal(calls, 1);
});

test("Universe command APIs pass expected version and reject client identity", async () => {
  const calls: unknown[][] = [];
  await withServer({
    async createNode(...args: never[]) { calls.push(args); return { snapshot, version: 4 }; },
  }, async (baseUrl) => {
    const rejected = await fetch(`${baseUrl}/api/v1/universe/nodes`, {
      method: "POST", headers: { "content-type": "application/json", "x-test-user": "yes" },
      body: JSON.stringify({ expected_version: 3, userId: "attacker", title: "wrong" }),
    });
    assert.equal(rejected.status, 400);
    const response = await fetch(`${baseUrl}/api/v1/universe/nodes`, {
      method: "POST", headers: { "content-type": "application/json", "x-test-user": "yes" },
      body: JSON.stringify({ expected_version: 3, node: { title: "n" } }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.[0], USER_ID);
    assert.equal(calls[0]?.[2], 3);
  });
});

test("Universe Web API exposes sibling source summaries and atomic source-aware commands", async () => {
  const calls: unknown[][] = [];
  const sources = [{ nodeId: "node-1", diaryId: "00000000-0000-4000-8000-000000000001", title: "Diary", date: "2026-08-21", status: "archived" }];
  await withServer({
    async loadUniverseWeb() { return { snapshot, version: 3, sources }; },
    async createNodeWeb(...args: never[]) { calls.push(args); return { snapshot, version: 4, sources }; },
    async updateNodeWeb(...args: never[]) { calls.push(args); return { snapshot, version: 5, sources }; },
    async searchDiarySourceOptions(...args: never[]) { calls.push(args); return [{ id: sources[0]!.diaryId, title: "Diary", date: "2026-08-21", status: "archived" }]; },
  }, async (baseUrl) => {
    const headers = { "content-type": "application/json", "x-test-user": "yes" };
    const loaded = await fetch(`${baseUrl}/api/v1/universe`, { headers });
    assert.deepEqual((await loaded.json()).data.sources, sources);
    const omitted = await fetch(`${baseUrl}/api/v1/universe/nodes`, {
      method: "POST", headers,
      body: JSON.stringify({ expected_version: 3, node: { title: "without sources" } }),
    });
    assert.equal(omitted.status, 200);
    const created = await fetch(`${baseUrl}/api/v1/universe/nodes`, {
      method: "POST", headers,
      body: JSON.stringify({ expected_version: 3, node: { title: "node" }, source_diary_ids: [sources[0]!.diaryId] }),
    });
    assert.equal(created.status, 200);
    const updated = await fetch(`${baseUrl}/api/v1/universe/nodes/node-1`, {
      method: "PATCH", headers,
      body: JSON.stringify({ expected_version: 4, patch: { title: "updated" }, source_diary_ids: [] }),
    });
    assert.equal(updated.status, 200);
    const options = await fetch(`${baseUrl}/api/v1/universe/diary-source-options?q=Diary`, { headers });
    assert.equal(options.status, 200);
    assert.deepEqual((await options.json()).data, [{ id: sources[0]!.diaryId, title: "Diary", date: "2026-08-21", status: "archived" }]);
  });
  assert.deepEqual(calls[0]?.[2], []);
  assert.deepEqual(calls[1]?.[2], [sources[0]!.diaryId]);
  assert.deepEqual(calls[2]?.[3], []);
  assert.deepEqual(calls[3], [USER_ID, "Diary"]);
});

test("Universe API forwards weighted membership payloads without normalization", async () => {
  const calls: unknown[][] = [];
  const memberships = [{ id: "galaxy-a", weight: 0.125 }, { id: "galaxy-b", weight: 0.875 }];
  await withServer({
    async createNode(...args: never[]) { calls.push(args); return { snapshot, version: 4 }; },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/universe/nodes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "yes" },
      body: JSON.stringify({ expected_version: 3, node: { title: "weighted", galaxies: memberships } }),
    });
    assert.equal(response.status, 200);
  });
  assert.deepEqual(calls[0]?.[1], { title: "weighted", galaxies: memberships });
});

test("Universe whole-snapshot PUT forwards version zero and weighted payload", async () => {
  const calls: unknown[][] = [];
  const importedSnapshot = {
    ...snapshot,
    nodes: [{ id: "node-1", galaxies: [{ id: "galaxy-a", weight: 0.125 }] }],
  };
  await withServer({
    async saveUniverse(...args: never[]) { calls.push(args); return { snapshot: importedSnapshot, version: 1 }; },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/universe`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-user": "yes" },
      body: JSON.stringify({ snapshot: importedSnapshot, expected_version: 0 }),
    });
    assert.equal(response.status, 200);
  });
  assert.equal(calls[0]?.[0], USER_ID);
  assert.deepEqual(calls[0]?.[1], importedSnapshot);
  assert.equal(calls[0]?.[2], 0);
});

test("Universe API maps version, invalid, missing, and unavailable errors safely", async () => {
  const errors: Array<[string, number, string]> = [
    ["VERSION_CONFLICT", 409, "VERSION_CONFLICT"],
    ["INVALID_UNIVERSE", 400, "INVALID_UNIVERSE"],
    ["NODE_NOT_FOUND", 404, "NODE_NOT_FOUND"],
    ["USER_DISABLED", 403, "UNIVERSE_UNAVAILABLE"],
  ];
  for (const [code, status, publicCode] of errors) {
    await withServer({
      async loadUniverse() { throw new UniverseServiceError(code as never, "private detail"); },
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/universe`, { headers: { "x-test-user": "yes" } });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { success: false, error: { code: publicCode, message: status === 403 ? "Universe is unavailable." : status === 409 ? "Universe changed on another device." : status === 404 ? "Universe resource was not found." : "Universe request is invalid." } });
    });
  }
});

test("Universe exposes command-shaped revision and backup routes", async () => {
  const calls: string[] = [];
  await withServer({
    async latestRevision() { calls.push("revision"); return { id: "r" }; },
    async restoreLatestRevision() { calls.push("restore-revision"); return { snapshot, version: 2 }; },
    async createBackup() { calls.push("backup"); return { id: "b" }; },
    async latestBackup() { calls.push("latest-backup"); return { id: "b" }; },
    async ensureDailyBackup() { calls.push("daily"); return null; },
    async restoreBackup() { calls.push("restore-backup"); return { snapshot, version: 3 }; },
  }, async (baseUrl) => {
    const headers = { "content-type": "application/json", "x-test-user": "yes" };
    for (const [path, method, body] of [
      ["/nodes/n/revisions/latest", "GET", undefined],
      ["/nodes/n/revisions/restore", "POST", { expected_version: 1 }],
      ["/backups", "POST", {}],
      ["/backups/latest", "GET", undefined],
      ["/backups/daily", "POST", {}],
      ["/backups/b/restore", "POST", { expected_version: 2 }],
    ] as const) {
      const response = await fetch(`${baseUrl}/api/v1/universe${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      assert.equal(response.status, 200);
    }
  });
  assert.deepEqual(calls, ["revision", "restore-revision", "backup", "latest-backup", "daily", "restore-backup"]);
});
