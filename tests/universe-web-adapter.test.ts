import assert from "node:assert/strict";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import {
  createLeileiOSUniverseAdapter,
  type UniverseReadResult,
} from "../web/src/pages/universe/universe-adapter.js";
import {
  createLeileiOSUniverseService,
} from "../web/src/pages/universe/universe-service.js";
import type {
  UniverseNode,
  UniverseRelation,
  UniverseSnapshot,
} from "../web/src/pages/universe/universe-types.js";

const snapshot: UniverseSnapshot = {
  schemaVersion: 2,
  meta: {
    name: "我的宇宙",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  galaxies: [],
  nodes: [],
  relations: [],
  revisions: [],
};

const readResult: UniverseReadResult = { snapshot, version: 4 };

function jsonBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

test("LeileiOSAdapter maps authenticated Universe commands without identity selectors", async () => {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      requests.push({ path, init });
      return { success: true, data: readResult } as T;
    },
  };
  const adapter = createLeileiOSUniverseAdapter(api);
  const node = {
    id: "node-1",
    title: "一颗星球",
    summary: "摘要",
    content: "正文",
    type: "concept",
    tags: [],
    galaxies: [],
    position: { x: 50, y: 50 },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } satisfies UniverseNode;
  const relation = {
    id: "relation-1",
    source: node.id,
    target: node.id,
    relationType: "related_to",
    strength: 0.5,
    createdAt: "2026-08-01T00:00:00.000Z",
  } satisfies UniverseRelation;

  assert.deepEqual(await adapter.loadUniverse(), readResult);
  assert.deepEqual(await adapter.saveUniverse(snapshot, 4), readResult);
  await adapter.createNode(node, 4);
  await adapter.updateNode(node.id, { title: "更新" }, "测试", 4);
  await adapter.deleteNode(node.id, 4);
  await adapter.createRelation(relation, 4);
  await adapter.deleteRelation(relation.id, 4);
  await adapter.latestRevision(node.id);
  await adapter.restoreLatestRevision(node.id, 4);
  await adapter.createBackup("测试备份");
  await adapter.latestBackup();
  await adapter.ensureDailyBackup();
  await adapter.restoreBackup("backup-1", 4);

  assert.deepEqual(requests.map(({ path }) => path), [
    "/universe",
    "/universe",
    "/universe/nodes",
    "/universe/nodes/node-1",
    "/universe/nodes/node-1",
    "/universe/relations",
    "/universe/relations/relation-1",
    "/universe/nodes/node-1/revisions/latest",
    "/universe/nodes/node-1/revisions/restore",
    "/universe/backups",
    "/universe/backups/latest",
    "/universe/backups/daily",
    "/universe/backups/backup-1/restore",
  ]);
  const mutationBodies = requests
    .filter(({ path }) => path !== "/universe" && !path.endsWith("/latest"))
    .map(({ init }) => jsonBody(init));
  assert.ok(mutationBodies.every((body) => !Object.hasOwn(body, "user_id") && !Object.hasOwn(body, "userId")));
  assert.equal(jsonBody(requests[1]?.init).expected_version, 4);
  assert.deepEqual(jsonBody(requests[2]?.init), { node, expected_version: 4 });
  assert.deepEqual(jsonBody(requests[5]?.init), { relation, expected_version: 4 });
});

test("LeileiOSUniverseService replaces canonical version after each mutation and surfaces conflicts", async () => {
  let current = readResult;
  const calls: Array<{ expectedVersion: number; kind: string }> = [];
  const adapter = {
    async loadUniverse() { return current; },
    async saveUniverse(_value: UniverseSnapshot, expectedVersion: number) {
      calls.push({ expectedVersion, kind: "save" });
      current = { snapshot, version: expectedVersion + 1 };
      return current;
    },
    async createNode(_value: UniverseNode, expectedVersion: number) {
      calls.push({ expectedVersion, kind: "createNode" });
      current = { snapshot: { ...snapshot, nodes: [{ ..._value }] }, version: expectedVersion + 1 };
      return current;
    },
    async updateNode() { return current; },
    async deleteNode() { return current; },
    async createRelation() { return current; },
    async deleteRelation() { return current; },
    async latestRevision() { return null; },
    async restoreLatestRevision() { return current; },
    async createBackup() { return { id: "backup-1", createdAt: "now", reason: "test", data: snapshot }; },
    async latestBackup() { return null; },
    async ensureDailyBackup() { return null; },
    async restoreBackup() { return current; },
  };
  const service = createLeileiOSUniverseService({ adapter });
  await service.load();
  const node = { id: "node-1", title: "一颗星球", summary: "", content: "", type: "concept", tags: [], galaxies: [], position: { x: 50, y: 50 }, createdAt: "2026-08-01", updatedAt: "2026-08-01" } satisfies UniverseNode;
  await service.createNode(node);
  assert.equal(service.getState().version, 5);
  assert.equal(calls[0]?.expectedVersion, 4);

  const conflict = Object.assign(new Error("Universe changed on another device."), {
    status: 409,
    code: "VERSION_CONFLICT",
  });
  adapter.createNode = async () => { throw conflict; };
  await assert.rejects(() => service.createNode(node), (error: unknown) => error === conflict);
  assert.equal(service.getState().version, 5);
});
