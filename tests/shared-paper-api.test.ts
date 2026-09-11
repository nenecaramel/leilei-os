import assert from "node:assert/strict";
import test from "node:test";
import { createWebApiRouter } from "../src/web-api/router.js";

const user = "00000000-0000-4000-8000-000000000099";
test("Shared Paper API derives owner from authenticated session", async () => {
  const calls: unknown[] = [];
  const router = createWebApiRouter({ sharedPaper: { sharedPaperService: { listPapers: async (input: unknown) => { calls.push(input); return []; }, searchPapers: async () => [], getPaper: async () => null, listEdits: async () => [], createPaper: async () => { throw new Error("unused"); }, editPaper: async () => { throw new Error("unused"); }, archivePaper: async () => null, restorePaper: async () => null, deletePaper: async () => ({ paperId: "unused" }) } }, memory: { memoryService: {} as never }, diary: { diaryService: {} as never }, task: { taskService: {} as never }, toy: { toyService: {} as never }, system: { systemService: {} as never } });
  const layer = (router as any).stack.find((item: any) => item.handle?.stack?.some((child: any) => child.route?.path === "/:id/edits"));
  const route = layer.handle.stack.find((child: any) => child.route?.path === "/").route.stack[0].handle;
  let body: unknown;
  await route({ webUserId: user, query: {}, params: {}, body: {} }, { json(value: unknown) { body = value; }, status() { return this; } }, () => {});
  assert.deepEqual(body, { success: true, data: [] });
  assert.deepEqual(calls, [{ userId: user, limit: undefined, scope: "active" }]);
});

test("Shared Paper API forwards before_revision for edit history", async () => {
  const calls: unknown[] = [];
  const router = createWebApiRouter({ sharedPaper: { sharedPaperService: {
    listPapers: async () => [], searchPapers: async () => [], getPaper: async () => null,
    listEdits: async (input: unknown) => { calls.push(input); return []; },
    createPaper: async () => { throw new Error("unused"); }, editPaper: async () => { throw new Error("unused"); }, archivePaper: async () => null, restorePaper: async () => null, deletePaper: async () => ({ paperId: "unused" }),
  } }, memory: { memoryService: {} as never }, diary: { diaryService: {} as never }, task: { taskService: {} as never }, toy: { toyService: {} as never }, system: { systemService: {} as never } });
  const layer = (router as any).stack.find((item: any) => item.handle?.stack?.some((child: any) => child.route?.path === "/:id/edits"));
  const route = layer.handle.stack.find((child: any) => child.route?.path === "/:id/edits").route.stack[0].handle;
  let body: unknown;
  await route({ webUserId: user, query: { before_revision: "3", limit: "2" }, params: { id: "paper-1" }, body: {} }, { json(value: unknown) { body = value; }, status() { return this; } }, () => {});
  assert.deepEqual(body, { success: true, data: [] });
  assert.deepEqual(calls, [{ userId: user, paperId: "paper-1", limit: 2, beforeRevision: 3 }]);
});


test("Shared Paper API accepts archived discovery scope and exposes lifecycle mutations", async () => {
  const calls: Array<{ name: string; input: unknown }> = [];
  const service = {
    listPapers: async () => [],
    searchPapers: async (input: unknown) => { calls.push({ name: "search", input }); return []; },
    getPaper: async () => null,
    listEdits: async () => [],
    createPaper: async () => null,
    editPaper: async () => null,
    archivePaper: async (input: unknown) => { calls.push({ name: "archive", input }); return { archivedAt: new Date() }; },
    restorePaper: async (input: unknown) => { calls.push({ name: "restore", input }); return { archivedAt: null }; },
    deletePaper: async (input: unknown) => { calls.push({ name: "delete", input }); return { paperId: "paper-1" }; },
  };
  const router = createWebApiRouter({ sharedPaper: { sharedPaperService: service }, memory: { memoryService: {} as never }, diary: { diaryService: {} as never }, task: { taskService: {} as never }, toy: { toyService: {} as never }, system: { systemService: {} as never } });
  const layer = (router as any).stack.find((item: any) => item.handle?.stack?.some((child: any) => child.route?.path === "/:id/archive"));
  const stack = layer.handle.stack;
  const response = { json() {}, status() { return this; } };

  const searchRoute = stack.find((child: any) => child.route?.path === "/search").route.stack[0].handle;
  await searchRoute({ webUserId: user, query: { query: "x", scope: "archived" }, params: {}, body: {} }, response, () => {});
  const archiveRoute = stack.find((child: any) => child.route?.path === "/:id/archive").route.stack[0].handle;
  await archiveRoute({ webUserId: user, query: {}, params: { id: "paper-1" }, body: {} }, response, () => {});
  const restoreRoute = stack.find((child: any) => child.route?.path === "/:id/restore").route.stack[0].handle;
  await restoreRoute({ webUserId: user, query: {}, params: { id: "paper-1" }, body: {} }, response, () => {});
  const deleteRoute = stack.find((child: any) => child.route?.path === "/:id/permanent").route.stack[0].handle;
  await deleteRoute({ webUserId: user, query: {}, params: { id: "paper-1" }, body: {} }, response, () => {});

  assert.deepEqual(calls, [
    { name: "search", input: { userId: user, query: "x", limit: undefined, scope: "archived" } },
    { name: "archive", input: { userId: user, paperId: "paper-1" } },
    { name: "restore", input: { userId: user, paperId: "paper-1" } },
    { name: "delete", input: { userId: user, paperId: "paper-1" } },
  ]);
});
