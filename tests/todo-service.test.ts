import assert from "node:assert/strict";
import test from "node:test";
import type {
  TodoRepository,
  ReplaceTodoPaperInput,
  ReplaceTodoPaperIdempotentlyInput,
  ReplaceTodoPaperIdempotentlyResult,
  TodoDayPapers,
  ReplaceTodoPaperResult,
} from "../src/domains/todo/todo-types.js";
import { hashMcpWriteRequest } from "../src/domains/mcp-write/mcp-write-idempotency.js";
import { TodoService, TodoServiceError } from "../src/domains/todo/todo-service.js";

class FakeTodoRepository implements TodoRepository {
  public replacements: ReplaceTodoPaperInput[] = [];
  public idempotentReplacements: ReplaceTodoPaperIdempotentlyInput[] = [];
  public result: ReplaceTodoPaperResult = { outcome: "committed", paper: { author: "L", date: "2026-08-12", revision: 1, entries: [] } };
  public idempotentResult: ReplaceTodoPaperIdempotentlyResult = {
    outcome: "committed",
    paper: { author: "L", date: "2026-08-12", revision: 1, entries: [] },
  };
  findUserById() { return Promise.resolve({ status: "active" as const }); }
  readDay(_userId: string, _date: string): Promise<TodoDayPapers> { return Promise.resolve({ L: null, G: null, C: null }); }
  listContentDates(_userId: string): Promise<string[]> { return Promise.resolve([]); }
  replacePaper(input: ReplaceTodoPaperInput): Promise<ReplaceTodoPaperResult> { this.replacements.push(input); return Promise.resolve(this.result); }
  replacePaperIdempotently(input: ReplaceTodoPaperIdempotentlyInput): Promise<ReplaceTodoPaperIdempotentlyResult> {
    this.idempotentReplacements.push(input);
    return Promise.resolve(this.idempotentResult);
  }
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
    { author: "Claude", revision: null, entries: [] },
    { author: "L", revision: -1, entries: [] },
    { author: "L", revision: null, entries: [{ id: "a", kind: "bad", text: "x" }] },
    { author: "L", revision: null, entries: [{ id: "a", kind: "record", text: "x" }, { id: "a", kind: "record", text: "y" }] },
  ]) {
    await assert.rejects(() => service.replacePaper({ userId: "u", date: "2026-08-12", ...input }), TodoServiceError);
  }
  assert.equal(repository.replacements.length, 0);
});

test("TodoService enforces the canonical durable entry limits for Web and MCP writes", async () => {
  const repository = new FakeTodoRepository();
  const service = new TodoService(repository);
  const validEntries = Array.from({ length: 200 }, (_, index) => ({
    id: `entry-${index}`,
    kind: "record" as const,
    text: "x".repeat(4_000),
  }));

  await service.replacePaper({ userId: "u", date: "2026-08-12", author: "L", revision: null, entries: validEntries });
  await service.replacePaperIdempotently({
    userId: "u", date: "2026-08-13", author: "G", revision: null, entries: validEntries,
    idempotencyKey: "todo.paper:limits-0001",
  });
  const writes = repository.replacements.length + repository.idempotentReplacements.length;

  for (const entries of [
    Array.from({ length: 201 }, (_, index) => ({ id: String(index), kind: "record", text: "x" })),
    [{ id: "x".repeat(129), kind: "record", text: "x" }],
    [{ id: "x", kind: "record", text: "x".repeat(4_001) }],
  ]) {
    await assert.rejects(
      service.replacePaper({ userId: "u", date: "2026-08-12", author: "L", revision: null, entries }),
      (error: unknown) => error instanceof TodoServiceError && error.code === "TODO_ENTRY_INVALID",
    );
    await assert.rejects(
      service.replacePaperIdempotently({ userId: "u", date: "2026-08-13", author: "G", revision: null, entries, idempotencyKey: `todo.paper:limits-${writes + 2}` }),
      (error: unknown) => error instanceof TodoServiceError && error.code === "TODO_ENTRY_INVALID",
    );
  }
  assert.equal(repository.replacements.length + repository.idempotentReplacements.length, writes);
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

test("TodoService accepts C papers while rejecting the Claude display name without mutation", async () => {
  const repository = new FakeTodoRepository();
  const service = new TodoService(repository);

  await service.replacePaper({
    userId: "u", date: "2026-09-05", author: "C", revision: null,
    entries: [{ id: "c-1", kind: "pending", text: "Claude item" }],
  });
  await assert.rejects(
    () => service.replacePaper({
      userId: "u", date: "2026-09-05", author: "Claude", revision: null, entries: [],
    }),
    (error: unknown) => error instanceof TodoServiceError && error.code === "TODO_AUTHOR_INVALID",
  );

  assert.deepEqual(repository.replacements, [{
    userId: "u",
    date: "2026-09-05",
    author: "C",
    expectedRevision: null,
    entries: [{ id: "c-1", kind: "pending", text: "Claude item" }],
  }]);
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

test("TodoService idempotent write reuses normalized whole-paper values and fingerprint", async () => {
  const repository = new FakeTodoRepository();
  const service = new TodoService(repository);

  await service.replacePaperIdempotently({
    userId: "u",
    date: "2026-08-13",
    author: "G",
    revision: 3,
    entries: [
      { id: " a ", kind: "pending", text: " First " },
      { id: "blank", kind: "record", text: "   " },
      { id: "b", kind: "completed", text: "Second" },
    ],
    idempotencyKey: "  todo.paper:request-0001  ",
  });

  assert.deepEqual(repository.idempotentReplacements, [{
    userId: "u",
    date: "2026-08-13",
    author: "G",
    expectedRevision: 3,
    entries: [
      { id: "a", kind: "pending", text: "First" },
      { id: "b", kind: "completed", text: "Second" },
    ],
    idempotencyKey: "todo.paper:request-0001",
    requestHash: hashMcpWriteRequest({
      date: "2026-08-13",
      author: "G",
      revision: 3,
      entries: [
        { id: "a", kind: "pending", text: "First" },
        { id: "b", kind: "completed", text: "Second" },
      ],
    }),
  }]);
});

test("TodoService idempotent fingerprint includes author and ordered normalized entries", async () => {
  const repository = new FakeTodoRepository();
  const service = new TodoService(repository);
  const entries = [
    { id: "a", kind: "pending", text: "First" },
    { id: "b", kind: "record", text: "Second" },
  ];

  for (const input of [
    { author: "L", revision: 2, entries },
    { author: "G", revision: 2, entries },
    { author: "C", revision: 2, entries },
    { author: "L", revision: 3, entries },
    { author: "L", revision: 2, entries: [...entries].reverse() },
  ] as const) {
    await service.replacePaperIdempotently({
      userId: "u",
      date: "2026-08-13",
      ...input,
      idempotencyKey: `todo.paper:request-000${repository.idempotentReplacements.length + 1}`,
    });
  }

  assert.equal(new Set(repository.idempotentReplacements.map((input) => input.requestHash)).size, 5);
});

test("TodoService rejects an invalid idempotency key before repository mutation", async () => {
  const repository = new FakeTodoRepository();
  const service = new TodoService(repository);

  await assert.rejects(
    () => service.replacePaperIdempotently({
      userId: "u",
      date: "2026-08-13",
      author: "L",
      revision: null,
      entries: [],
      idempotencyKey: "short",
    }),
    (error: unknown) => error instanceof TodoServiceError && error.code === "INVALID_IDEMPOTENCY_KEY",
  );
  assert.equal(repository.idempotentReplacements.length, 0);
});

test("TodoService maps idempotent repository outcomes to stable errors and metadata", async () => {
  const repository = new FakeTodoRepository();
  const service = new TodoService(repository);
  const input = {
    userId: "u",
    date: "2026-08-13",
    author: "L" as const,
    revision: 0,
    entries: [],
    idempotencyKey: "todo.paper:outcome-0001",
  };

  repository.idempotentResult = { outcome: "idempotency_conflict" };
  await assert.rejects(
    () => service.replacePaperIdempotently(input),
    (error: unknown) => error instanceof TodoServiceError && error.code === "IDEMPOTENCY_CONFLICT",
  );

  repository.idempotentResult = { outcome: "revision_conflict" };
  await assert.rejects(
    () => service.replacePaperIdempotently(input),
    (error: unknown) => error instanceof TodoServiceError && error.code === "TODO_PAPER_CONFLICT",
  );

  for (const outcome of ["committed", "replayed"] as const) {
    const paper = { author: "L" as const, date: "2026-08-13", revision: 4, entries: [] };
    repository.idempotentResult = { outcome, paper };
    assert.deepEqual(await service.replacePaperIdempotently(input), {
      paper,
      metadata: {
        committed: outcome === "committed",
        idempotent_replay: outcome === "replayed",
      },
    });
  }
});
