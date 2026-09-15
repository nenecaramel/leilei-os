import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createWebApiRouter } from "../src/web-api/router.js";
import type { ExportDocumentV2, ExportScope } from "../src/domains/export/export-types.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

function documentFor(scope: ExportScope, includeAudit: boolean): ExportDocumentV2 {
  return {
    schema_version: 2,
    owner_fingerprint: "a".repeat(64),
    exported_at: "2026-08-13T05:42:00.000Z",
    data: scope === "all" ? { memory: [] } : { [scope]: [] },
    ...(includeAudit ? { audit: { lifecycle: [], tool_activity: [] } } : {}),
  } as ExportDocumentV2;
}

function dependencies(exportService: { createExport: (userId: string, scope: ExportScope, includeAudit: boolean) => Promise<ExportDocumentV2> }) {
  return {
    memory: { memoryService: {} as never },
    diary: { diaryService: {} as never },
    task: { taskService: {} as never },
    toy: { toyService: {} as never },
    system: { systemService: {} as never },
    export: { exportService },
  } as never;
}

async function withServer(
  exportService: { createExport: (userId: string, scope: ExportScope, includeAudit: boolean) => Promise<ExportDocumentV2> },
  callback: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use((request, _response, next) => {
    if (request.header("x-test-user")) request.webUserId = USER_ID;
    next();
  });
  app.use("/api/v1", createWebApiRouter(dependencies(exportService)));
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

test("export requires authentication before service access", async () => {
  let calls = 0;
  await withServer({
    async createExport() {
      calls += 1;
      throw new Error("must not be called");
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/export?scope=all`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Web API authentication is required." },
    });
  });
  assert.equal(calls, 0);
});

test("export uses server identity, validates scopes and returns an attachment document", async () => {
  const calls: Array<{ userId: string; scope: ExportScope; includeAudit: boolean }> = [];
  await withServer({
    async createExport(userId, scope, includeAudit) {
      calls.push({ userId, scope, includeAudit });
      return documentFor(scope, includeAudit);
    },
  }, async (baseUrl) => {
    for (const scope of ["all", "memory", "diary", "task", "todo", "shared_paper"] as const) {
      const query = scope === "all" ? "scope=all&include_audit=true&user_id=attacker" : `scope=${scope}`;
      const response = await fetch(`${baseUrl}/api/v1/system/export?${query}`, {
        headers: { "x-test-user": "authenticated" },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json; charset=utf-8/u);
      assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="leileios-export-20260813T054200Z\.json"$/u);
      assert.deepEqual(await response.json(), documentFor(scope, scope === "all"));
    }
  });
  assert.deepEqual(calls, [
    { userId: USER_ID, scope: "all", includeAudit: true },
    { userId: USER_ID, scope: "memory", includeAudit: false },
    { userId: USER_ID, scope: "diary", includeAudit: false },
    { userId: USER_ID, scope: "task", includeAudit: false },
    { userId: USER_ID, scope: "todo", includeAudit: false },
    { userId: USER_ID, scope: "shared_paper", includeAudit: false },
  ]);
});

test("export rejects missing, repeated and unknown query values", async () => {
  await withServer({
    async createExport() {
      throw new Error("must not be called");
    },
  }, async (baseUrl) => {
    for (const query of ["", "scope=unknown", "scope=memory&scope=task", "scope=memory&include_audit=1", "scope=memory&include_audit=false&include_audit=true"]) {
      const response = await fetch(`${baseUrl}/api/v1/system/export${query ? `?${query}` : ""}`, {
        headers: { "x-test-user": "authenticated" },
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        success: false,
        error: { code: "INVALID_EXPORT_REQUEST", message: "Export request is invalid." },
      });
    }
  });
});

test("export maps service failures without exposing attachment headers", async () => {
  await withServer({
    async createExport() {
      throw new Error("database failure");
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/system/export?scope=all`, {
      headers: { "x-test-user": "authenticated" },
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("content-disposition"), null);
    assert.deepEqual(await response.json(), {
      success: false,
      error: { code: "EXPORT_UNAVAILABLE", message: "Export data is temporarily unavailable." },
    });
  });
});
