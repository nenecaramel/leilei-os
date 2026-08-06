import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTodoPaperDate,
  formatTodoStorageDate,
  normalizeTodoPaperEntries,
  readTodoPaperEntries,
  todoPaperStorageKey,
  writeTodoPaperEntries,
} from "../web/src/pages/todo-paper-storage.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test("Todo paper dates use local YYYY-MM-DD keys and YYYY.MM.DD labels", () => {
  const date = new Date(2026, 7, 7, 12, 0, 0);
  assert.equal(formatTodoStorageDate(date), "2026-08-07");
  assert.equal(formatTodoPaperDate(date), "2026.08.07");
});

test("Todo paper keys isolate date and author", () => {
  assert.equal(
    todoPaperStorageKey("L", "2026-08-07"),
    "leilei.home.todo-paper.v1:2026-08-07:L",
  );
  assert.notEqual(
    todoPaperStorageKey("L", "2026-08-07"),
    todoPaperStorageKey("G", "2026-08-07"),
  );
});

test("Missing or malformed storage falls back to a cloned fixture seed", () => {
  const storage = new MemoryStorage();
  const seed = [
    { id: "l-1", author: "L" as const, kind: "pending" as const, text: " seed " },
  ];

  assert.deepEqual(
    readTodoPaperEntries(storage, "L", "2026-08-07", seed),
    seed,
  );

  storage.setItem(todoPaperStorageKey("L", "2026-08-07"), "{bad json");

  assert.deepEqual(
    readTodoPaperEntries(storage, "L", "2026-08-07", seed),
    seed,
  );
});

test("Writing trims text, drops empty rows, and saved data overrides fixtures", () => {
  const storage = new MemoryStorage();

  writeTodoPaperEntries(storage, "G", "2026-08-07", [
    { id: "g-1", author: "G", kind: "record", text: " kept " },
    { id: "g-empty", author: "G", kind: "pending", text: "   " },
  ]);

  assert.deepEqual(
    readTodoPaperEntries(storage, "G", "2026-08-07", []),
    [{ id: "g-1", author: "G", kind: "record", text: "kept" }],
  );
});

test("Normalization preserves order and existing ids", () => {
  assert.deepEqual(
    normalizeTodoPaperEntries([
      { id: "2", author: "L", kind: "record", text: " second " },
      { id: "1", author: "L", kind: "completed", text: " first " },
    ]),
    [
      { id: "2", author: "L", kind: "record", text: "second" },
      { id: "1", author: "L", kind: "completed", text: "first" },
    ],
  );
});
