import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createWebApiRouter } from "../src/web-api/router.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

function createDependencies() {
  return {
    memory: { memoryService: {} as never },
    diary: { diaryService: {} as never },
    task: { taskService: {} as never },
    toy: { toyService: {} as never },
    system: { systemService: {} as never },
  } as never;
}

async function withServer(callback: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use((request, _response, next) => {
    if (request.header("x-test-user")) request.webUserId = USER_ID;
    next();
  });
  app.use("/api/v1", createWebApiRouter(createDependencies()));
  app.use((_request, response) => {
    response.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

test("retired Health API is absent while another Web API route still works", async () => {
  await withServer(async (baseUrl) => {
    const retired = await fetch(`${baseUrl}/api/v1/health`, {
      method: "POST",
      headers: { "x-test-user": "yes", "content-type": "application/json" },
      body: JSON.stringify({ date: "2026-08-14" }),
    });
    assert.equal(retired.status, 404);

    const session = await fetch(`${baseUrl}/api/v1/session`, {
      headers: { "x-test-user": "yes" },
    });
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), {
      success: true,
      data: { authenticated: true },
    });
  });
});
