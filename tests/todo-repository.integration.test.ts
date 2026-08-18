import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, count, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { todoEntries, todoPapers, users } from "../src/database/schema.js";
import { DrizzleTodoRepository } from "../src/domains/todo/todo-repository.js";
import { hashMcpWriteRequest } from "../src/domains/mcp-write/mcp-write-idempotency.js";

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
  "Todo MCP repository is concurrent, isolated, private, and atomic",
  { skip: !runIntegration },
  async () => {
    const adminClient = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false });
    const admin = drizzle(adminClient, { schema });
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const now = new Date("2026-08-13T00:00:00.000Z");
    const clients = Array.from({ length: 6 }, () =>
      postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false, max: 1 })
    );
    const repositories = clients.map((client) =>
      new DrizzleTodoRepository(drizzle(client, { schema }) as never)
    );
    const entries = [{
      id: "mcp-private-entry",
      kind: "pending" as const,
      text: "private Todo text must not enter idempotency",
    }];
    const requestHash = hashMcpWriteRequest({
      date: "2026-08-13",
      author: "L",
      revision: null,
      entries,
    });
    const input = {
      userId,
      date: "2026-08-13",
      author: "L" as const,
      expectedRevision: null,
      entries,
      idempotencyKey: "todo.repository.same-key-0001",
      requestHash,
    };

    try {
      await admin.insert(users).values([
        {
          id: userId,
          email: `${userId}@example.invalid`,
          displayName: "Todo MCP owner",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: otherUserId,
          email: `${otherUserId}@example.invalid`,
          displayName: "Todo MCP other",
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ]);
      const [toolCallsBefore] = await admin.select({ value: count() }).from(schema.toolCalls);
      const [lifecycleBefore] = await admin.select({ value: count() }).from(schema.resourceLifecycleEvents);

      const concurrent = await Promise.all(
        repositories.map((repository) => repository.replacePaperIdempotently!(input)),
      );
      assert.equal(concurrent.filter((result) => result.outcome === "committed").length, 1);
      assert.equal(concurrent.filter((result) => result.outcome === "replayed").length, 5);
      assert.equal(concurrent.filter((result) => "paper" in result && result.paper.revision === 1).length, 6);

      const [paperRow] = await admin
        .select({ id: todoPapers.id, revision: todoPapers.revision })
        .from(todoPapers)
        .where(and(
          eq(todoPapers.userId, userId),
          eq(todoPapers.businessDate, input.date),
          eq(todoPapers.author, input.author),
        ));
      assert.ok(paperRow);
      assert.equal(paperRow.revision, 1);
      const durableEntries = await admin
        .select({ id: todoEntries.entryId, text: todoEntries.text })
        .from(todoEntries)
        .where(eq(todoEntries.paperId, paperRow.id));
      assert.deepEqual(durableEntries, [{
        id: "mcp-private-entry",
        text: "private Todo text must not enter idempotency",
      }]);

      const idempotencyRows = await admin
        .select()
        .from(schema.mcpWriteIdempotency)
        .where(and(
          eq(schema.mcpWriteIdempotency.userId, userId),
          eq(schema.mcpWriteIdempotency.toolName, "write_todo_paper"),
          eq(schema.mcpWriteIdempotency.idempotencyKey, input.idempotencyKey),
        ));
      assert.equal(idempotencyRows.length, 1);
      assert.equal(idempotencyRows[0]?.resourceType, "todo_paper");
      assert.equal(idempotencyRows[0]?.resourceId, paperRow.id);
      assert.equal(idempotencyRows[0]?.requestHash, requestHash);
      assert.doesNotMatch(
        JSON.stringify(idempotencyRows),
        /private Todo text|mcp-private-entry|response_snapshot|payload/,
      );

      const differentRequest = await repositories[0]!.replacePaperIdempotently!({
        ...input,
        entries: [{ ...entries[0]!, text: "different private text" }],
        requestHash: hashMcpWriteRequest({
          date: input.date,
          author: input.author,
          revision: null,
          entries: [{ ...entries[0]!, text: "different private text" }],
        }),
      });
      assert.deepEqual(differentRequest, { outcome: "idempotency_conflict" });
      assert.equal((await repositories[0]!.readDay(userId, input.date)).L?.revision, 1);

      const otherResult = await repositories[0]!.replacePaperIdempotently!({
        ...input,
        userId: otherUserId,
      });
      assert.equal(otherResult.outcome, "committed");

      const later = await repositories[0]!.replacePaper({
        userId,
        date: input.date,
        author: input.author,
        expectedRevision: 1,
        entries: [{ id: "later", kind: "record", text: "current persisted state" }],
      });
      assert.equal(later.outcome, "committed");
      const replay = await repositories[1]!.replacePaperIdempotently!(input);
      assert.equal(replay.outcome, "replayed");
      assert.deepEqual("paper" in replay ? replay.paper : null, {
        author: "L",
        date: input.date,
        revision: 2,
        entries: [{ id: "later", kind: "record", text: "current persisted state" }],
      });

      const raceInputs = ["a", "b"].map((suffix) => ({
        userId,
        date: input.date,
        author: input.author,
        expectedRevision: 2,
        entries: [{ id: `race-${suffix}`, kind: "completed" as const, text: `race ${suffix}` }],
        idempotencyKey: `todo.repository.revision-race-${suffix}-0001`,
        requestHash: hashMcpWriteRequest({
          date: input.date,
          author: input.author,
          revision: 2,
          entries: [{ id: `race-${suffix}`, kind: "completed", text: `race ${suffix}` }],
        }),
      }));
      const race = await Promise.all([
        repositories[0]!.replacePaperIdempotently!(raceInputs[0]!),
        repositories[1]!.replacePaperIdempotently!(raceInputs[1]!),
      ]);
      assert.equal(race.filter((result) => result.outcome === "committed").length, 1);
      assert.equal(race.filter((result) => result.outcome === "revision_conflict").length, 1);
      assert.equal((await repositories[0]!.readDay(userId, input.date)).L?.revision, 3);
      const raceIdempotency = await admin
        .select({ value: count() })
        .from(schema.mcpWriteIdempotency)
        .where(and(
          eq(schema.mcpWriteIdempotency.userId, userId),
          eq(schema.mcpWriteIdempotency.toolName, "write_todo_paper"),
          sql`${schema.mcpWriteIdempotency.idempotencyKey} like 'todo.repository.revision-race-%'`,
        ));
      assert.equal(raceIdempotency[0]?.value, 1);

      await admin.execute(sql.raw(`
        create or replace function todo_mcp_fail_idempotency() returns trigger language plpgsql as $$
        begin raise exception 'forced Todo MCP idempotency failure'; end; $$;
        create trigger todo_mcp_fail_idempotency_trigger
        before insert on mcp_write_idempotency
        for each row execute function todo_mcp_fail_idempotency();
      `));
      const rollbackInput = {
        ...input,
        date: "2026-08-14",
        author: "G" as const,
        idempotencyKey: "todo.repository.rollback-idempotency-0001",
        requestHash: hashMcpWriteRequest({
          date: "2026-08-14",
          author: "G",
          revision: null,
          entries,
        }),
      };
      try {
        await assert.rejects(repositories[0]!.replacePaperIdempotently!(rollbackInput));
      } finally {
        await admin.execute(sql.raw(
          "drop trigger todo_mcp_fail_idempotency_trigger on mcp_write_idempotency; drop function todo_mcp_fail_idempotency();",
        ));
      }
      assert.equal((await repositories[0]!.readDay(userId, rollbackInput.date)).G, null);

      await admin.execute(sql.raw(`
        create or replace function todo_mcp_fail_entry() returns trigger language plpgsql as $$
        begin raise exception 'forced Todo MCP entry failure'; end; $$;
        create trigger todo_mcp_fail_entry_trigger
        before insert on todo_entries
        for each row execute function todo_mcp_fail_entry();
      `));
      const entryRollbackInput = {
        ...input,
        date: "2026-08-15",
        author: "G" as const,
        idempotencyKey: "todo.repository.rollback-entry-0001",
        requestHash: hashMcpWriteRequest({
          date: "2026-08-15",
          author: "G",
          revision: null,
          entries,
        }),
      };
      try {
        await assert.rejects(repositories[0]!.replacePaperIdempotently!(entryRollbackInput));
      } finally {
        await admin.execute(sql.raw(
          "drop trigger todo_mcp_fail_entry_trigger on todo_entries; drop function todo_mcp_fail_entry();",
        ));
      }
      assert.equal((await repositories[0]!.readDay(userId, entryRollbackInput.date)).G, null);
      const rollbackIdempotency = await admin
        .select({ value: count() })
        .from(schema.mcpWriteIdempotency)
        .where(and(
          eq(schema.mcpWriteIdempotency.userId, userId),
          eq(schema.mcpWriteIdempotency.toolName, "write_todo_paper"),
          sql`${schema.mcpWriteIdempotency.idempotencyKey} like 'todo.repository.rollback-%'`,
        ));
      assert.equal(rollbackIdempotency[0]?.value, 0);

      const [toolCallsAfter] = await admin.select({ value: count() }).from(schema.toolCalls);
      const [lifecycleAfter] = await admin.select({ value: count() }).from(schema.resourceLifecycleEvents);
      assert.equal(toolCallsAfter?.value, toolCallsBefore?.value);
      assert.equal(lifecycleAfter?.value, lifecycleBefore?.value);
    } finally {
      await adminClient.unsafe("drop trigger if exists todo_mcp_fail_idempotency_trigger on mcp_write_idempotency");
      await adminClient.unsafe("drop function if exists todo_mcp_fail_idempotency()");
      await adminClient.unsafe("drop trigger if exists todo_mcp_fail_entry_trigger on todo_entries");
      await adminClient.unsafe("drop function if exists todo_mcp_fail_entry()");
      await adminClient`delete from mcp_write_idempotency where user_id in (${userId}, ${otherUserId})`;
      await adminClient`delete from todo_entries where paper_id in (select id from todo_papers where user_id in (${userId}, ${otherUserId}))`;
      await adminClient`delete from todo_papers where user_id in (${userId}, ${otherUserId})`;
      await adminClient`delete from users where id in (${userId}, ${otherUserId})`;
      await Promise.all([...clients.map((client) => client.end()), adminClient.end()]);
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
