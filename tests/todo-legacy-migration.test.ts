import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyTodoMigrationMarkerKey,
  legacyTodoPaperKey,
  listLegacyTodoPaperCandidates,
  migrateLegacyTodoPapers,
  parseLegacyTodoPaper,
} from "../web/src/pages/todo-legacy-migration.js";
import { WebApiError } from "../web/src/api/web-api-error.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const legacy = JSON.stringify([
  { id: "l-1", author: "L", kind: "pending", text: "  hello  " },
  { id: "blank", author: "L", kind: "record", text: " " },
  { id: "l-2", author: "L", kind: "completed", text: "done" },
]);

test("legacy migration uploads only when the server paper is absent", async () => {
  const storage = new MemoryStorage();
  storage.setItem(legacyTodoPaperKey("L", "2026-08-12"), legacy);
  const calls: unknown[] = [];
  await migrateLegacyTodoPapers({ storage, api: { request: async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (!init) return { success: true, data: { date: "2026-08-12", papers: { L: null, G: null, C: null } } };
    return { success: true, data: {} };
  } } });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(String((calls[1] as { init: RequestInit }).init.body)), { revision: null, entries: [{ id: "l-1", kind: "pending", text: "hello" }, { id: "l-2", kind: "completed", text: "done" }] });
  assert.deepEqual(JSON.parse(storage.getItem(legacyTodoMigrationMarkerKey("L", "2026-08-12"))!), { state: "migrated" });
  assert.equal(storage.getItem(legacyTodoPaperKey("L", "2026-08-12")), null);
});

test("server wins and invalid legacy data never uploads", async () => {
  const storage = new MemoryStorage();
  storage.setItem(legacyTodoPaperKey("L", "2026-08-12"), legacy);
  storage.setItem(legacyTodoPaperKey("G", "2026-08-13"), "{broken");
  let puts = 0;
  await migrateLegacyTodoPapers({ storage, api: { request: async (path: string, init?: RequestInit) => {
    if (init) puts += 1;
    return { success: true, data: { date: path.includes("2026-08-12") ? "2026-08-12" : "2026-08-13", papers: { L: { author: "L", date: "2026-08-12", revision: 1, entries: [] }, G: null, C: null } } };
  } } });
  assert.equal(puts, 0);
  assert.deepEqual(JSON.parse(storage.getItem(legacyTodoMigrationMarkerKey("L", "2026-08-12"))!), { state: "server-wins" });
  assert.deepEqual(JSON.parse(storage.getItem(legacyTodoMigrationMarkerKey("G", "2026-08-13"))!), { state: "invalid" });
  assert.equal(storage.getItem(legacyTodoPaperKey("L", "2026-08-12")), null);
  assert.equal(storage.getItem(legacyTodoPaperKey("G", "2026-08-13")), "{broken");
});

test("legacy migration keeps raw data on retryable failures and clears it on a 409 server win", async () => {
  const networkStorage = new MemoryStorage();
  networkStorage.setItem(legacyTodoPaperKey("L", "2026-08-12"), legacy);
  await migrateLegacyTodoPapers({ storage: networkStorage, api: { request: async (_path: string, init?: RequestInit) => {
    if (init) throw new Error("network unavailable");
    return { success: true, data: { date: "2026-08-12", papers: { L: null, G: null, C: null } } };
  } } });
  assert.equal(networkStorage.getItem(legacyTodoPaperKey("L", "2026-08-12")), legacy);
  assert.equal(networkStorage.getItem(legacyTodoMigrationMarkerKey("L", "2026-08-12")), null);

  const conflictStorage = new MemoryStorage();
  conflictStorage.setItem(legacyTodoPaperKey("L", "2026-08-12"), legacy);
  await migrateLegacyTodoPapers({ storage: conflictStorage, api: { request: async (_path: string, init?: RequestInit) => {
    if (init) throw new WebApiError(409, "TODO_PAPER_CONFLICT", "server won");
    return { success: true, data: { date: "2026-08-12", papers: { L: null, G: null, C: null } } };
  } } });
  assert.deepEqual(JSON.parse(conflictStorage.getItem(legacyTodoMigrationMarkerKey("L", "2026-08-12"))!), { state: "server-wins" });
  assert.equal(conflictStorage.getItem(legacyTodoPaperKey("L", "2026-08-12")), null);
});

test("legacy discovery and parser enforce exact namespace and authorship", () => {
  const storage = new MemoryStorage();
  storage.setItem(legacyTodoPaperKey("L", "2026-08-12"), legacy);
  storage.setItem("leilei.home.todo-paper.v1:2026-08-12:X", legacy);
  assert.deepEqual(listLegacyTodoPaperCandidates(storage), [{ author: "L", date: "2026-08-12", key: legacyTodoPaperKey("L", "2026-08-12") }]);
  assert.deepEqual(parseLegacyTodoPaper(legacy, "L"), { author: "L", entries: [{ id: "l-1", kind: "pending", text: "hello" }, { id: "l-2", kind: "completed", text: "done" }] });
  assert.equal(parseLegacyTodoPaper(legacy, "G"), null);
});


test("legacy prototype seed payloads stay ignored without the Home fixture module", () => {
  const lSeed = JSON.stringify([
    { id: "l-1", author: "L", kind: "pending", text: "整理今天的事情" },
    { id: "l-2", author: "L", kind: "completed", text: "项目视觉方向已经确认" },
    { id: "l-3", author: "L", kind: "record", text: "记录一个不强制完成的小念头" },
    { id: "l-4", author: "L", kind: "record", text: "留一点空白，晚些时候再决定" },
  ]);
  const gSeed = JSON.stringify([
    { id: "g-1", author: "G", kind: "pending", text: "项目下一步：确定侧边栏交互" },
    { id: "g-2", author: "G", kind: "record", text: "明天记得向蕾蕾推进进度展开方式" },
    { id: "g-3", author: "G", kind: "record", text: "准备提醒蕾蕾吃午饭啦" },
    { id: "g-4", author: "G", kind: "record", text: "下一轮继续调整首页细节" },
  ]);

  assert.equal(parseLegacyTodoPaper(lSeed, "L"), null);
  assert.equal(parseLegacyTodoPaper(gSeed, "G"), null);
});
