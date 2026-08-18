import assert from "node:assert/strict";
import test from "node:test";
import { listTodoDates, loadTodoDay, saveTodoPaper } from "../web/src/pages/todo-api.js";

test("Todo Web helpers use the authenticated API contract", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const api = { request: async <T>(path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path.endsWith("/dates")) return { success: true, data: { dates: ["2026-08-12"] } } as T;
    if (init?.method === "PUT") return { success: true, data: { author: "G", date: "2026-08-12", revision: 3, entries: [] } } as T;
    return { success: true, data: { date: "2026-08-12", papers: { L: null, G: null } } } as T;
  } };
  assert.deepEqual(await loadTodoDay(api, "2026-08-12"), { date: "2026-08-12", papers: { L: null, G: null } });
  assert.deepEqual(await listTodoDates(api), ["2026-08-12"]);
  await saveTodoPaper(api, { date: "2026-08-12", author: "G", revision: 2, entries: [{ id: "g-1", kind: "record", text: "x" }] });
  assert.equal(calls[0]?.path, "/todo/2026-08-12");
  assert.equal(calls[1]?.path, "/todo/dates");
  assert.equal(calls[2]?.path, "/todo/2026-08-12/G");
  assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), { revision: 2, entries: [{ id: "g-1", kind: "record", text: "x" }] });
});
