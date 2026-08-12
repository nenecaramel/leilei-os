import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { users } from "../src/database/schema.js";
import { DrizzleTodoRepository } from "../src/domains/todo/todo-repository.js";

const runIntegration =
  process.env.RUN_TODO_DATABASE_TEST === "1" && Boolean(process.env.DATABASE_URL);

class RollbackTodoTest extends Error {}

test(
  "Todo repository scopes papers, revisions, empty papers and dates transactionally",
  { skip: !runIntegration },
  async () => {
    const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false });
    const database = { db: drizzle(client, { schema }), close: () => client.end() };
    const userA = randomUUID();
    const userB = randomUUID();
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const now = new Date("2026-08-12T00:00:00.000Z");
          await transaction.insert(users).values([
            { id: userA, email: `${userA}@example.invalid`, displayName: "A", status: "active", createdAt: now, updatedAt: now },
            { id: userB, email: `${userB}@example.invalid`, displayName: "B", status: "active", createdAt: now, updatedAt: now },
          ]);
          const repository = new DrizzleTodoRepository(transaction as never);
          assert.deepEqual(await repository.readDay(userA, "2026-08-12"), { L: null, G: null });
          assert.deepEqual(await repository.listContentDates(userA), []);

          const first = await repository.replacePaper({
            userId: userA, date: "2026-08-12", author: "L", expectedRevision: null,
            entries: [
              { id: "l-1", kind: "pending", text: "one" },
              { id: "l-2", kind: "record", text: "two" },
            ],
          });
          assert.equal(first.outcome, "committed");
          if (first.outcome !== "committed") return;
          assert.equal(first.paper.revision, 1);
          assert.deepEqual(first.paper.entries.map(({ id, kind, text }) => ({ id, kind, text })), [
            { id: "l-1", kind: "pending", text: "one" },
            { id: "l-2", kind: "record", text: "two" },
          ]);
          assert.deepEqual(await repository.listContentDates(userA), ["2026-08-12"]);
          assert.equal((await repository.readDay(userA, "2026-08-12")).G, null);

          const second = await repository.replacePaper({
            userId: userA, date: "2026-08-12", author: "L", expectedRevision: 1,
            entries: [{ id: "l-3", kind: "completed", text: "three" }],
          });
          assert.equal(second.outcome, "committed");
          if (second.outcome !== "committed") return;
          assert.equal(second.paper.revision, 2);
          const stale = await repository.replacePaper({
            userId: userA, date: "2026-08-12", author: "L", expectedRevision: 1,
            entries: [{ id: "stale", kind: "record", text: "stale" }],
          });
          assert.deepEqual(stale, { outcome: "conflict" });
          assert.equal((await repository.readDay(userA, "2026-08-12")).L?.revision, 2);

          const empty = await repository.replacePaper({
            userId: userA, date: "2026-08-12", author: "G", expectedRevision: null, entries: [],
          });
          assert.equal(empty.outcome, "committed");
          assert.deepEqual((await repository.readDay(userA, "2026-08-12")).G?.entries, []);
          assert.deepEqual(await repository.listContentDates(userA), ["2026-08-12"]);
          const lEmpty = await repository.replacePaper({
            userId: userA, date: "2026-08-12", author: "L", expectedRevision: 2, entries: [],
          });
          assert.equal(lEmpty.outcome, "committed");
          assert.deepEqual(await repository.listContentDates(userA), []);
          assert.deepEqual((await repository.readDay(userA, "2026-08-12")).L?.entries, []);

          const other = await repository.replacePaper({
            userId: userB, date: "2026-08-12", author: "L", expectedRevision: null,
            entries: [{ id: "b-1", kind: "pending", text: "other" }],
          });
          assert.equal(other.outcome, "committed");
          assert.equal((await repository.readDay(userA, "2026-08-12")).L?.entries.length, 0);
          throw new RollbackTodoTest();
        }),
        RollbackTodoTest,
      );
    } finally {
      await database.close();
    }
  },
);
