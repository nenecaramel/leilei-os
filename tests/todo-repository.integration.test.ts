import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { todoEntries, todoPapers, users } from "../src/database/schema.js";
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

test(
  "Todo repository has one winner and one conflict for a concurrent revision-null create",
  { skip: !runIntegration },
  async () => {
    const setupClient = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false });
    const clientA = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 1 });
    const clientB = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 1 });
    const userId = randomUUID();
    const now = new Date("2026-08-12T00:00:00.000Z");
    try {
      const setup = drizzle(setupClient, { schema });
      await setup.insert(users).values({
        id: userId,
        email: `${userId}@example.invalid`,
        displayName: "Race",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const repoA = new DrizzleTodoRepository(drizzle(clientA, { schema }) as never);
      const repoB = new DrizzleTodoRepository(drizzle(clientB, { schema }) as never);
      const input = {
        userId,
        date: "2026-08-12",
        author: "L" as const,
        expectedRevision: null,
        entries: [{ id: "race-entry", kind: "pending" as const, text: "one winner" }],
      };
      const results = await Promise.all([repoA.replacePaper(input), repoB.replacePaper(input)]);
      assert.equal(results.filter((result) => result.outcome === "committed").length, 1);
      assert.equal(results.filter((result) => result.outcome === "conflict").length, 1);
      const read = await setup
        .select({ id: todoPapers.id, revision: todoPapers.revision })
        .from(todoPapers)
        .where(and(eq(todoPapers.userId, userId), eq(todoPapers.businessDate, input.date), eq(todoPapers.author, input.author)));
      assert.equal(read.length, 1);
      assert.equal(read[0]?.revision, 1);
      const rows = await setup
        .select({ id: todoEntries.id })
        .from(todoEntries)
        .where(eq(todoEntries.paperId, read[0]!.id));
      assert.equal(rows.length, 1);
    } finally {
      await setupClient`delete from todo_entries where paper_id in (select id from todo_papers where user_id = ${userId})`;
      await setupClient`delete from todo_papers where user_id = ${userId}`;
      await setupClient`delete from users where id = ${userId}`;
      await Promise.all([clientA.end(), clientB.end(), setupClient.end()]);
    }
  },
);

test(
  "Todo repository rolls back removed entries and revision when replacement insertion fails",
  { skip: !runIntegration },
  async () => {
    const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false });
    const database = drizzle(client, { schema });
    const repository = new DrizzleTodoRepository(database as never);
    const userId = randomUUID();
    const now = new Date("2026-08-12T00:00:00.000Z");
    try {
      await database.insert(users).values({
        id: userId,
        email: `${userId}@example.invalid`,
        displayName: "Rollback",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const original = await repository.replacePaper({
        userId,
        date: "2026-08-12",
        author: "G",
        expectedRevision: null,
        entries: [{ id: "old-entry", kind: "record", text: "preserve me" }],
      });
      assert.equal(original.outcome, "committed");
      await database.execute(sql.raw(`
        create or replace function todo_test_fail_insert() returns trigger language plpgsql as $$
        begin
          raise exception 'todo test forced replacement failure';
        end;
        $$;
        create trigger todo_test_fail_insert_trigger
        before insert on todo_entries
        for each row execute function todo_test_fail_insert();
      `));
      await assert.rejects(repository.replacePaper({
        userId,
        date: "2026-08-12",
        author: "G",
        expectedRevision: 1,
        entries: [{ id: "new-entry", kind: "completed", text: "must not persist" }],
      }));
      await database.execute(sql.raw("drop trigger todo_test_fail_insert_trigger on todo_entries; drop function todo_test_fail_insert();"));
      const after = await repository.readDay(userId, "2026-08-12");
      assert.deepEqual(after.G, {
        author: "G",
        date: "2026-08-12",
        revision: 1,
        entries: [{ id: "old-entry", kind: "record", text: "preserve me" }],
      });
    } finally {
      await client`delete from todo_entries where paper_id in (select id from todo_papers where user_id = ${userId})`;
      await client`delete from todo_papers where user_id = ${userId}`;
      await client`delete from users where id = ${userId}`;
      await client.end();
    }
  },
);
