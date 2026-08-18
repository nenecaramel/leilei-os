import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createWebApiRouter } from "../src/web-api/router.js";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const body = JSON.stringify({ schema_version: 2, owner_fingerprint: createOwnerFingerprint(USER_ID), exported_at: "2026-08-14T00:00:00.000Z", data: { memory: [] } });

function dependencies(importService: { preview: (...args: never[]) => Promise<unknown>; execute: (...args: never[]) => Promise<unknown> }) {
  return {
    memory: { memoryService: {} as never }, diary: { diaryService: {} as never }, task: { taskService: {} as never },
    toy: { toyService: {} as never }, system: { systemService: {} as never },
    import: { importService },
  } as never;
}

async function withServer(importService: { preview: (...args: never[]) => Promise<unknown>; execute: (...args: never[]) => Promise<unknown> }, callback: (url: string) => Promise<void>) {
  const app = express();
  app.use((request, _response, next) => { if (request.header("x-test-user")) request.webUserId = USER_ID; next(); });
  app.use("/api/v1", createWebApiRouter(dependencies(importService)));
  const server = await new Promise<import("node:http").Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  const address = server.address() as AddressInfo;
  try { await callback(`http://127.0.0.1:${address.port}`); } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("import preview requires authentication and never accepts a client user id", async () => {
  let calls = 0;
  await withServer({ async preview() { calls += 1; throw new Error("must not call"); }, async execute() { throw new Error("must not call"); } }, async (url) => {
    const response = await fetch(`${url}/api/v1/system/import/preview?user_id=attacker`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body });
    assert.equal(response.status, 401);
  });
  assert.equal(calls, 0);
});
test("import preview uses server identity and raw bytes", async () => {
  const calls: unknown[] = [];
  await withServer({
    async preview(...args) { calls.push(args); return { package_sha256: "a".repeat(64), preview_fingerprint: "b".repeat(64), summary: { memory: { create: 1, duplicate: 0, conflict: 0, invalid: 0 } }, can_execute: true }; },
    async execute() { throw new Error("not called"); },
  }, async (url) => {
    const response = await fetch(`${url}/api/v1/system/import/preview?user_id=attacker`, { method: "POST", headers: { "x-test-user": "yes", "content-type": "application/octet-stream" }, body });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: { package_sha256: "a".repeat(64), preview_fingerprint: "b".repeat(64), summary: { memory: { create: 1, duplicate: 0, conflict: 0, invalid: 0 } }, can_execute: true } });
  });
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as unknown[])[1], USER_ID);
  assert.equal((calls[0] as unknown[])[0] instanceof Uint8Array, true);
});

test("execute validates expected fingerprint and maps stable conflict errors", async () => {
  let executeCalls = 0;
  await withServer({ async preview() { throw new Error("not called"); }, async execute() { executeCalls += 1; const error = new Error("stale"); Object.assign(error, { code: "IMPORT_PREVIEW_STALE" }); throw error; } }, async (url) => {
    const response = await fetch(`${url}/api/v1/system/import/execute?expected_preview_fingerprint=${"c".repeat(64)}`, { method: "POST", headers: { "x-test-user": "yes", "content-type": "application/octet-stream" }, body });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { success: false, error: { code: "IMPORT_PREVIEW_STALE", message: "Import preview is stale." } });
  });
  assert.equal(executeCalls, 1);
});

test("import rejects JSON content type and invalid query without service access", async () => {
  let calls = 0;
  await withServer({ async preview() { calls += 1; throw new Error("must not call"); }, async execute() { throw new Error("must not call"); } }, async (url) => {
    for (const [path, contentType] of [["preview", "application/json"], ["execute?expected_preview_fingerprint=bad", "application/octet-stream"]] as const) {
      const response = await fetch(`${url}/api/v1/system/import/${path}`, { method: "POST", headers: { "x-test-user": "yes", "content-type": contentType }, body });
      assert.equal(response.status, 400);
    }
  });
  assert.equal(calls, 0);
});
