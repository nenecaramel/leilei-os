import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { createWebApiRouter } from "../src/web-api/router.js";
import { TodoServiceError } from "../src/domains/todo/todo-service.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

async function withServer(todoService: Record<string, unknown>, callback: (url: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => { if (request.header("x-test-user")) request.webUserId = USER_ID; next(); });
  app.use("/api/v1", createWebApiRouter({ todo: { todoService }, memory: { memoryService: {} as never }, diary: { diaryService: {} as never }, task: { taskService: {} as never }, toy: { toyService: {} as never }, system: { systemService: {} as never } }));
  const server = await new Promise<import("node:http").Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  try { const address = server.address() as { port: number }; await callback(`http://127.0.0.1:${address.port}`); } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("Todo API routes dates before the date parameter and uses server identity", async () => {
  const calls: string[] = [];
  await withServer({
    listDates(userId: string) { calls.push(`dates:${userId}`); return Promise.resolve(["2026-08-12"]); },
    readDay(userId: string, date: string) { calls.push(`day:${userId}:${date}`); return Promise.resolve({ date, papers: { L: null, G: null } }); },
    replacePaper(input: Record<string, unknown>) { calls.push(`put:${input.userId}:${input.date}:${input.author}:${String(input.revision)}`); return Promise.resolve({ author: input.author, date: input.date, revision: 1, entries: [] }); },
  }, async (url) => {
    const headers = { "x-test-user": "yes", "content-type": "application/json" };
    assert.equal((await fetch(`${url}/api/v1/todo/dates`, { headers })).status, 200);
    assert.equal((await fetch(`${url}/api/v1/todo/2026-08-12`, { headers })).status, 200);
    const put = await fetch(`${url}/api/v1/todo/2026-08-12/G`, { method: "PUT", headers: { ...headers, "x-extra": "ignored" }, body: JSON.stringify({ userId: "attacker", revision: null, entries: [] }) });
    assert.equal(put.status, 200);
  });
  assert.deepEqual(calls, [`dates:${USER_ID}`, `day:${USER_ID}:2026-08-12`, `put:${USER_ID}:2026-08-12:G:null`]);
});

test("Todo API maps conflicts and validation errors to stable safe envelopes", async () => {
  await withServer({ replacePaper: async () => { throw new TodoServiceError("TODO_PAPER_CONFLICT", "Todo paper changed on another device."); } }, async (url) => {
    const response = await fetch(`${url}/api/v1/todo/2026-08-12/L`, { method: "PUT", headers: { "x-test-user": "yes", "content-type": "application/json" }, body: JSON.stringify({ revision: 1, entries: [] }) });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { success: false, error: { code: "TODO_PAPER_CONFLICT", message: "Todo paper changed on another device." } });
  });
  await withServer({ replacePaper: async () => { throw new TodoServiceError("TODO_ENTRY_INVALID", "private details"); } }, async (url) => {
    const response = await fetch(`${url}/api/v1/todo/2026-08-12/L`, { method: "PUT", headers: { "x-test-user": "yes", "content-type": "application/json" }, body: JSON.stringify({ revision: null, entries: [] }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { success: false, error: { code: "TODO_ENTRY_INVALID", message: "Todo request is invalid." } });
  });
});
