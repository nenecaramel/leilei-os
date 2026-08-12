import assert from "node:assert/strict";
import test from "node:test";
import type { TodoRepository, ReplaceTodoPaperInput, TodoDayPapers, ReplaceTodoPaperResult } from "../src/domains/todo/todo-types.js";
import { TodoService, TodoServiceError } from "../src/domains/todo/todo-service.js";

class FakeTodoRepository implements TodoRepository {
  public replacements: ReplaceTodoPaperInput[] = [];
  public result: ReplaceTodoPaperResult = { outcome: "committed", paper: { author: "L", date: "2026-08-12", revision: 1, entries: [] } };
  readDay(_userId: string, _date: string): Promise<TodoDayPapers> { return Promise.resolve({ L: null, G: null }); }
  listContentDates(_userId: string): Promise<string[]> { return Promise.resolve([]); }
  replacePaper(input: ReplaceTodoPaperInput): Promise<ReplaceTodoPaperResult> { this.replacements.push(input); return Promise.resolve(this.result); }
}

test("TodoService validates real calendar dates before reading", async () => {
  const repository = new FakeTodoRepository();
  const service = new TodoService(repository);
  await assert.rejects(
    () => service.readDay("u", "2026-02-30"),
    (error: unknown) => error instanceof TodoServiceError && error.code === "TODO_DATE_INVALID",
  );
});

test("TodoService rejects invalid input without repository mutation", async () => {
  const repository = new FakeTodoRepository();
  const service = new TodoService(repository);
  for (const input of [
    { author: "X", revision: null, entries: [] },
    { author: "L", revision: -1, entries: [] },
    { author: "L", revision: null, entries: [{ id: "a", kind: "bad", text: "x" }] },
    { author: "L", revision: null, entries: [{ id: "a", kind: "record", text: "x" }, { id: "a", kind: "record", text: "y" }] },
  ]) {
    await assert.rejects(() => service.replacePaper({ userId: "u", date: "2026-08-12", ...input }), TodoServiceError);
  }
  assert.equal(repository.replacements.length, 0);
});

test("TodoService trims and drops blank rows while preserving order", async () => {
  const repository = new FakeTodoRepository();
  const service = new TodoService(repository);
  await service.replacePaper({
    userId: "u", date: "2024-02-29", author: "G", revision: null,
    entries: [
      { id: "a", kind: "pending", text: "  first  " },
      { id: "blank", kind: "record", text: "  " },
      { id: "b", kind: "completed", text: "second" },
    ],
  });
  assert.deepEqual(repository.replacements[0]?.entries, [
    { id: "a", kind: "pending", text: "first" },
    { id: "b", kind: "completed", text: "second" },
  ]);
});

test("TodoService maps repository conflict to stable error", async () => {
  const repository = new FakeTodoRepository();
  repository.result = { outcome: "conflict" };
  const service = new TodoService(repository);
  await assert.rejects(
    () => service.replacePaper({ userId: "u", date: "2026-08-12", author: "L", revision: 1, entries: [] }),
    (error: unknown) => error instanceof TodoServiceError && error.code === "TODO_PAPER_CONFLICT",
  );
});
