import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createWebApiRouter } from "../src/web-api/router.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

function dependencies(systemService: Record<string, unknown>) {
  return {
    memory: { memoryService: {} as never },
    diary: { diaryService: {} as never },
    task: { taskService: {} as never },
    toy: { toyService: {} as never },
    system: { systemService },
  } as never;
}

async function withServer(
  systemService: Record<string, unknown>,
  callback: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use((request, _response, next) => {
    if (request.header("x-test-user")) request.webUserId = USER_ID;
    next();
  });
  app.use("/api/v1", createWebApiRouter(dependencies(systemService)));
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("system routes require authentication before service access", async () => {
  let calls = 0;
  await withServer({
    readConnections() { calls += 1; return {}; },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/connections`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Web API authentication is required.",
      },
    });
  });
  assert.equal(calls, 0);
});

test("system connections and data routes use server-owned identity", async () => {
  const calls: Array<{ method: string; userId: string }> = [];
  await withServer({
    readConnections() {
      calls.push({ method: "connections", userId: USER_ID });
      return {
        web_api: "online",
        public_mcp: "available",
        internal_mcp: "not_enabled",
      };
    },
    async readDataSummary(userId: string) {
      calls.push({ method: "data", userId });
      return {
        memory: { active: 1, archived: 2 },
        diary: { active: 3, archived: 4 },
        task: { active: 5, archived: 6 },
        shared_paper: { active: 7, archived: 8 },
        todo: { active: 9 },
      };
    },
  }, async (baseUrl) => {
    const headers = { "x-test-user": "authenticated" };
    const connections = await fetch(`${baseUrl}/api/v1/system/connections`, { headers });
    assert.equal(connections.status, 200);
    assert.deepEqual(await connections.json(), {
      success: true,
      data: {
        web_api: "online",
        public_mcp: "available",
        internal_mcp: "not_enabled",
      },
    });
    const data = await fetch(`${baseUrl}/api/v1/system/data?userId=attacker`, { headers });
    assert.equal(data.status, 200);
    assert.deepEqual(await data.json(), {
      success: true,
      data: {
        memory: { active: 1, archived: 2 },
        diary: { active: 3, archived: 4 },
        task: { active: 5, archived: 6 },
        shared_paper: { active: 7, archived: 8 },
        todo: { active: 9 },
      },
    });
  });
  assert.deepEqual(calls, [
    { method: "connections", userId: USER_ID },
    { method: "data", userId: USER_ID },
  ]);
});

test("system activity returns bounded data and maps service failures safely", async () => {
  await withServer({
    async readActivity(userId: string) {
      assert.equal(userId, USER_ID);
      return [{
        id: "event-1",
        occurred_at: "2026-08-09T00:00:00.000Z",
        label: "Task archived",
        source: "Web",
        outcome: "success",
      }];
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/activity`, {
      headers: { "x-test-user": "authenticated" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: { events: [{
        id: "event-1",
        occurred_at: "2026-08-09T00:00:00.000Z",
        label: "Task archived",
        source: "Web",
        outcome: "success",
      }] },
    });
  });

  await withServer({
    async readActivity() {
      throw new Error("database unavailable");
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/activity`, {
      headers: { "x-test-user": "authenticated" },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      success: false,
      error: {
        code: "SYSTEM_UNAVAILABLE",
        message: "System data is temporarily unavailable.",
      },
    });
  });
});

test("retired settings route is not mounted", async () => {
  await withServer({ readConnections: () => ({}) }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/settings`, {
      headers: { "x-test-user": "authenticated" },
    });
    assert.equal(response.status, 404);
  });
});
