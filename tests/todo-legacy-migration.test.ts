import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyTodoMigrationMarkerKey,
  legacyTodoPaperKey,
  listLegacyTodoPaperCandidates,
  migrateLegacyTodoPapers,
  parseLegacyTodoPaper,
} from "../web/src/pages/todo-legacy-migration.js";

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
    if (!init) return { success: true, data: { date: "2026-08-12", papers: { L: null, G: null } } };
    return { success: true, data: {} };
  } } });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(String((calls[1] as { init: RequestInit }).init.body)), { revision: null, entries: [{ id: "l-1", kind: "pending", text: "hello" }, { id: "l-2", kind: "completed", text: "done" }] });
  assert.deepEqual(JSON.parse(storage.getItem(legacyTodoMigrationMarkerKey("L", "2026-08-12"))!), { state: "migrated" });
});

test("server wins and invalid legacy data never uploads", async () => {
  const storage = new MemoryStorage();
  storage.setItem(legacyTodoPaperKey("L", "2026-08-12"), legacy);
  storage.setItem(legacyTodoPaperKey("G", "2026-08-13"), "{broken");
  let puts = 0;
  await migrateLegacyTodoPapers({ storage, api: { request: async (path: string, init?: RequestInit) => {
    if (init) puts += 1;
    return { success: true, data: { date: path.includes("2026-08-12") ? "2026-08-12" : "2026-08-13", papers: { L: { author: "L", date: "2026-08-12", revision: 1, entries: [] }, G: null } } };
  } } });
  assert.equal(puts, 0);
  assert.deepEqual(JSON.parse(storage.getItem(legacyTodoMigrationMarkerKey("L", "2026-08-12"))!), { state: "server-wins" });
  assert.deepEqual(JSON.parse(storage.getItem(legacyTodoMigrationMarkerKey("G", "2026-08-13"))!), { state: "invalid" });
});

test("legacy discovery and parser enforce exact namespace and authorship", () => {
  const storage = new MemoryStorage();
  storage.setItem(legacyTodoPaperKey("L", "2026-08-12"), legacy);
  storage.setItem("leilei.home.todo-paper.v1:2026-08-12:X", legacy);
  assert.deepEqual(listLegacyTodoPaperCandidates(storage), [{ author: "L", date: "2026-08-12", key: legacyTodoPaperKey("L", "2026-08-12") }]);
  assert.deepEqual(parseLegacyTodoPaper(legacy, "L"), { author: "L", entries: [{ id: "l-1", kind: "pending", text: "hello" }, { id: "l-2", kind: "completed", text: "done" }] });
  assert.equal(parseLegacyTodoPaper(legacy, "G"), null);
});
