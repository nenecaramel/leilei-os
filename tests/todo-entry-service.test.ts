import assert from "node:assert/strict";
import test from "node:test";
import { TodoService, TodoServiceError } from "../src/domains/todo/todo-service.js";
import type { TodoRepository } from "../src/domains/todo/todo-types.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

function repository(overrides: Partial<TodoRepository>): TodoRepository {
  return {
    async findUserById() { return { status: "active" }; },
    async readDay() { return { L: null, G: null, C: null }; },
    async listContentDates() { return []; },
    async replacePaper() { return { outcome: "conflict" }; },
    ...overrides,
  };
}

test("Todo append normalizes one entry and does not require a paper revision", async () => {
  let captured: unknown;
  const service = new TodoService(repository({
    async appendEntryIdempotently(input) {
      captured = input;
      return {
        outcome: "committed",
        entry: { id: "generated", kind: "pending", text: "hello", revision: 1 },
        paperRevision: 3,
      };
    },
  }));

  const result = await service.appendEntryIdempotently({
    userId: USER_ID,
    date: "2026-09-14",
    author: "L",
    kind: "pending",
    text: "  hello  ",
    idempotencyKey: "todo-entry-service-append-1",
  });

  assert.equal(result.entry.text, "hello");
  assert.equal(result.entry.revision, 1);
  assert.equal(result.paperRevision, 3);
  assert.deepEqual(result.metadata, { committed: true, idempotent_replay: false });
  assert.deepEqual(
    Object.keys(captured as Record<string, unknown>).sort(),
    ["author", "date", "idempotencyKey", "kind", "requestHash", "text", "userId"].sort(),
  );
  assert.equal((captured as Record<string, unknown>).text, "hello");
});

test("Todo update uses entry revision CAS and partial fields", async () => {
  let captured: unknown;
  const service = new TodoService(repository({
    async updateEntryIdempotently(input) {
      captured = input;
      return {
        outcome: "committed",
        entry: { id: "todo-a", kind: "completed", text: "same text", revision: 5 },
        paperRevision: 9,
      };
    },
  }));

  const result = await service.updateEntryIdempotently({
    userId: USER_ID,
    date: "2026-09-14",
    author: "G",
    entryId: " todo-a ",
    expectedRevision: 4,
    kind: "completed",
    idempotencyKey: "todo-entry-service-update-1",
  });

  assert.deepEqual(result.entry, { id: "todo-a", kind: "completed", text: "same text", revision: 5 });
  assert.equal((captured as Record<string, unknown>).entryId, "todo-a");
  assert.equal((captured as Record<string, unknown>).expectedRevision, 4);
  assert.equal((captured as Record<string, unknown>).kind, "completed");
  assert.equal((captured as Record<string, unknown>).text, undefined);
});

test("Todo entry stale revision maps to entry conflict without touching other entries", async () => {
  const service = new TodoService(repository({
    async updateEntryIdempotently() {
      return { outcome: "entry_revision_conflict" };
    },
  }));
  await assert.rejects(
    service.updateEntryIdempotently({
      userId: USER_ID,
      date: "2026-09-14",
      author: "L",
      entryId: "todo-a",
      expectedRevision: 1,
      text: "changed",
      idempotencyKey: "todo-entry-service-stale-01",
    }),
    (error: unknown) => error instanceof TodoServiceError && error.code === "TODO_ENTRY_CONFLICT",
  );
});

test("Todo entry update requires at least one mutation field", async () => {
  let calls = 0;
  const service = new TodoService(repository({
    async updateEntryIdempotently() {
      calls += 1;
      return { outcome: "entry_not_found" };
    },
  }));
  await assert.rejects(
    service.updateEntryIdempotently({
      userId: USER_ID,
      date: "2026-09-14",
      author: "L",
      entryId: "todo-a",
      expectedRevision: 1,
      idempotencyKey: "todo-entry-service-empty-upd",
    }),
    (error: unknown) => error instanceof TodoServiceError && error.code === "TODO_ENTRY_INVALID",
  );
  assert.equal(calls, 0);
});

test("Todo delete maps idempotent replay without recreating an entry", async () => {
  const service = new TodoService(repository({
    async deleteEntryIdempotently() {
      return { outcome: "replayed", entryId: "todo-a", paperRevision: 11 };
    },
  }));
  const result = await service.deleteEntryIdempotently({
    userId: USER_ID,
    date: "2026-09-14",
    author: "C",
    entryId: "todo-a",
    expectedRevision: 2,
    idempotencyKey: "todo-entry-service-delete-1",
  });
  assert.deepEqual(result, {
    entryId: "todo-a",
    paperRevision: 11,
    metadata: { committed: false, idempotent_replay: true },
  });
});

test("Todo entry writes recheck active user before repository mutation", async () => {
  let writes = 0;
  const service = new TodoService(repository({
    async findUserById() { return { status: "disabled" }; },
    async appendEntryIdempotently() {
      writes += 1;
      return { outcome: "entry_limit" };
    },
  }));
  await assert.rejects(
    service.appendEntryIdempotently({
      userId: USER_ID,
      date: "2026-09-14",
      author: "L",
      kind: "pending",
      text: "x",
      idempotencyKey: "todo-entry-service-disabled",
    }),
    (error: unknown) => error instanceof TodoServiceError && error.code === "USER_DISABLED",
  );
  assert.equal(writes, 0);
});
