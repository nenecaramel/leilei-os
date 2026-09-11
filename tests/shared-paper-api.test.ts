import assert from "node:assert/strict";
import test from "node:test";
import { createWebApiRouter } from "../src/web-api/router.js";

const user = "00000000-0000-4000-8000-000000000099";
test("Shared Paper API derives owner from authenticated session", async () => {
  const calls: unknown[] = [];
  const router = createWebApiRouter({ sharedPaper: { sharedPaperService: { listPapers: async (input: unknown) => { calls.push(input); return []; }, searchPapers: async () => [], getPaper: async () => null, listEdits: async () => [], createPaperIdempotently: async () => { throw new Error("unused"); }, editPaper: async () => { throw new Error("unused"); } } }, memory: { memoryService: {} as never }, diary: { diaryService: {} as never }, task: { taskService: {} as never }, toy: { toyService: {} as never }, system: { systemService: {} as never } });
  const layer = (router as any).stack.find((item: any) => item.handle?.stack?.some((child: any) => child.route?.path === "/:id/edits"));
  const route = layer.handle.stack.find((child: any) => child.route?.path === "/").route.stack[0].handle;
  let body: unknown;
  await route({ webUserId: user, query: {}, params: {}, body: {} }, { json(value: unknown) { body = value; }, status() { return this; } }, () => {});
  assert.deepEqual(body, { success: true, data: [] });
  assert.deepEqual(calls, [{ userId: user, limit: undefined }]);
});
