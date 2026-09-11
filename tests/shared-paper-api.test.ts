import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { createWebApiRouter } from "../src/web-api/router.js";

const user = "00000000-0000-4000-8000-000000000099";
async function withServer(sharedPaperService: Record<string, unknown>, run: (url: string) => Promise<void>) {
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.webUserId = user; next(); });
  app.use("/api/v1", createWebApiRouter({ sharedPaper: { sharedPaperService }, memory: { memoryService: {} as never }, diary: { diaryService: {} as never }, task: { taskService: {} as never }, toy: { toyService: {} as never }, system: { systemService: {} as never } }));
  const server = await new Promise<import("node:http").Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`); } finally { await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); }
}

test("Shared Paper API derives owner from authenticated session", async () => {
  const calls: unknown[] = [];
  await withServer({ listPapers: async (input: unknown) => { calls.push(input); return []; }, searchPapers: async () => [], getPaper: async () => null, listEdits: async () => [], createPaperIdempotently: async () => { throw new Error("unused"); }, editPaper: async () => { throw new Error("unused"); } }, async (url) => {
    const response = await fetch(`${url}/api/v1/shared-papers`);
    assert.equal(response.status, 200);
  });
  assert.deepEqual(calls, [{ userId: user }]);
});
