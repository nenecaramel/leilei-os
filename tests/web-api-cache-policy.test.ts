import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createWebApiRouter } from "../src/web-api/router.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

async function withServer(callback: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    if (request.header("x-test-user")) request.webUserId = USER_ID;
    next();
  });
  app.get("/health", (_request, response) => response.json({ success: true }));
  app.use("/api/v1", createWebApiRouter({
    memory: {
      memoryService: {
        async readMemory() { return { user: { display_name: "Leilei" }, memories: [], metadata: { count: 0 } }; },
        async listAvailableCategories() { return []; },
        async listAvailableTags() { return []; },
      },
    },
    diary: { diaryService: {} as never },
    task: { taskService: {} as never },
    toy: {
      toyService: {
        async create() {
          return { id: "toy-1", action: "stop", percent: null, durationSeconds: null, status: "pending", createdAt: new Date("2026-08-14T00:00:00Z"), expiresAt: new Date("2026-08-14T00:05:00Z") };
        },
      },
    },
    system: {
      systemService: {
        async readDataSummary() { return { memory: { active: 0, archived: 0 }, diary: { active: 0, archived: 0 }, task: { active: 0, archived: 0 } }; },
      },
    },
    todo: { todoService: { async listDates() { return []; } } },
    export: { exportService: { async createExport() { return { schema_version: 2, exported_at: "2026-08-14T00:00:00.000Z", data: { memory: [] } }; } } },
    import: { importService: { async preview() { return { package_sha256: "a".repeat(64), preview_fingerprint: "b".repeat(64), summary: {}, can_execute: false }; } } },
  } as never));
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

test("authenticated Web API responses are private and uncached without affecting root health", async () => {
  await withServer(async (baseUrl) => {
    const headers = { "x-test-user": "yes", "content-type": "application/json" };
    const requests: Array<{ path: string; init?: RequestInit }> = [
      { path: "/api/v1/session", init: { headers } },
      { path: "/api/v1/memory", init: { headers } },
      { path: "/api/v1/todo/dates", init: { headers } },
      { path: "/api/v1/system/data", init: { headers } },
      { path: "/api/v1/system/export?scope=memory", init: { headers } },
      { path: "/api/v1/system/import/preview", init: { method: "POST", headers: { ...headers, "content-type": "application/octet-stream" }, body: new Uint8Array([123]) } },
      { path: "/api/v1/toy/commands", init: { method: "POST", headers, body: JSON.stringify({ action: "stop" }) } },
    ];
    for (const request of requests) {
      const response = await fetch(`${baseUrl}${request.path}`, request.init);
      assert.equal(response.headers.get("cache-control"), "private, no-store", request.path);
    }
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), null);
  });
});
