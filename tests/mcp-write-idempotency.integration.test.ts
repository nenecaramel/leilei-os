import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import {
  DrizzleDiaryRepository,
} from "../src/domains/diary/diary-repository.js";
import {
  DiaryDomainError,
  DiaryService,
} from "../src/domains/diary/diary-service.js";
import {
  DrizzleToyCommandRepository,
} from "../src/domains/toy/toy-command-repository.js";
import {
  ToyCommandService,
  ToyDomainError,
} from "../src/domains/toy/toy-command-service.js";
import {
  hashMcpWriteRequest,
} from "../src/domains/mcp-write/mcp-write-idempotency.js";
import {
  DrizzleTodoRepository,
} from "../src/domains/todo/todo-repository.js";
import {
  TodoService,
  TodoServiceError,
} from "../src/domains/todo/todo-service.js";

const databaseUrl = process.env.DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
const localTarget =
  parsed?.hostname === "127.0.0.1" || parsed?.hostname === "localhost";
const RUN =
  process.env.RUN_MCP_WRITE_IDEMPOTENCY_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && localTarget;

function connection() {
  const client = postgres(databaseUrl!, {
    max: 1,
    prepare: false,
    ssl: false,
  });
  return { client, db: drizzle(client, { schema }) };
}

async function withService<T>(
  operation: (services: {
    diary: DiaryService;
    toy: ToyCommandService;
    todo: TodoService;
  }) => Promise<T>,
  userId: string,
): Promise<T> {
  const { client, db } = connection();
  try {
    return await operation({
      diary: new DiaryService(new DrizzleDiaryRepository(db as never)),
      toy: new ToyCommandService(
        new DrizzleToyCommandRepository(db as never),
        userId,
      ),
      todo: new TodoService(new DrizzleTodoRepository(db as never)),
    });
  } finally {
    await client.end();
  }
}

const diaryInput = (key: string, suffix: string) => ({
  title: `Diary ${suffix}`,
  content: `private-diary-${suffix}`,
  date: "2026-08-01",
  tags: ["mcp"],
  mood: null,
  author: "L" as const,
  idempotencyKey: key,
});

test(
  "real PostgreSQL keeps current shared MCP idempotency writes concurrent, durable, isolated, and atomic",
  { skip: !RUN },
  async () => {
    const admin = connection();
    await admin.client.unsafe(
      "drop trigger if exists fail_mcp_idempotency_test on mcp_write_idempotency; "
      + "drop function if exists fail_mcp_idempotency_test()",
    );

    const owner = randomUUID();
    const other = randomUUID();
    await admin.db.insert(schema.users).values([
      {
        id: owner,
        email: `mcp-idem-${owner}@example.invalid`,
        displayName: "MCP owner",
        status: "active",
      },
      {
        id: other,
        email: `mcp-idem-${other}@example.invalid`,
        displayName: "MCP other",
        status: "active",
      },
    ]);

    const cases = [
      {
        tool: "write_diary" as const,
        key: "integration-diary-key-0001",
        tableName: "diary_entries",
        call: (userId = owner, suffix = "same") =>
          withService(
            ({ diary }) =>
              diary.createMcpDiary(
                { userId },
                diaryInput("integration-diary-key-0001", suffix),
              ),
            userId,
          ).then((result) => result.diary.id),
        conflict: () =>
          withService(
            ({ diary }) =>
              diary.createMcpDiary(
                { userId: owner },
                diaryInput("integration-diary-key-0001", "different"),
              ),
            owner,
          ),
      },
      {
        tool: "toy_set" as const,
        key: "integration-toy-set-0001",
        tableName: "toy_commands",
        call: (userId = owner, suffix = "20") =>
          withService(
            ({ toy }) =>
              toy.createIdempotently(
                userId,
                { action: "set", percent: Number(suffix) },
                "integration-toy-set-0001",
              ),
            userId,
          ).then((result) => result.id),
        conflict: () =>
          withService(
            ({ toy }) =>
              toy.createIdempotently(
                owner,
                { action: "set", percent: 21 },
                "integration-toy-set-0001",
              ),
            owner,
          ),
      },
      {
        tool: "toy_stop" as const,
        key: "integration-toy-stop-0001",
        tableName: "toy_commands",
        call: (userId = owner) =>
          withService(
            ({ toy }) =>
              toy.createIdempotently(
                userId,
                { action: "stop" },
                "integration-toy-stop-0001",
              ),
            userId,
          ).then((result) => result.id),
        conflict: async () => {
          const { client, db } = connection();
          try {
            const result =
              await new DrizzleToyCommandRepository(db as never)
                .createIdempotently(owner, {
                  action: "set",
                  percent: 10,
                  toolName: "toy_stop",
                  idempotencyKey: "integration-toy-stop-0001",
                  requestHash: hashMcpWriteRequest({
                    action: "set",
                    percent: 10,
                  }),
                });
            if (result.outcome === "conflict") {
              throw new ToyDomainError(
                "IDEMPOTENCY_CONFLICT",
                "conflict",
              );
            }
            return result.command;
          } finally {
            await client.end();
          }
        },
      },
    ];

    for (const item of cases) {
      const beforeRows = await admin.client.unsafe(
        `select count(*)::int as count from ${item.tableName} where user_id = $1::uuid`,
        [owner],
      );
      const ids = await Promise.all(
        Array.from({ length: 6 }, () => item.call()),
      );
      assert.equal(
        new Set(ids).size,
        1,
        `${item.tool} callers must receive one identity`,
      );
      const afterRows = await admin.client.unsafe(
        `select count(*)::int as count from ${item.tableName} where user_id = $1::uuid`,
        [owner],
      );
      assert.equal(
        afterRows[0]?.count,
        Number(beforeRows[0]?.count) + 1,
        `${item.tool} must create exactly one business row`,
      );

      const [idempotencyCount] = await admin.db
        .select({ value: count() })
        .from(schema.mcpWriteIdempotency)
        .where(and(
          eq(schema.mcpWriteIdempotency.userId, owner),
          eq(schema.mcpWriteIdempotency.toolName, item.tool),
          eq(schema.mcpWriteIdempotency.idempotencyKey, item.key),
        ));
      assert.equal(idempotencyCount?.value, 1);
      assert.equal(await item.call(), ids[0]);

      await assert.rejects(
        item.conflict(),
        (error: unknown) =>
          (
            error instanceof DiaryDomainError
            || error instanceof ToyDomainError
          )
          && error.code === "IDEMPOTENCY_CONFLICT",
      );
      const afterConflictRows = await admin.client.unsafe(
        `select count(*)::int as count from ${item.tableName} where user_id = $1::uuid`,
        [owner],
      );
      assert.equal(
        afterConflictRows[0]?.count,
        afterRows[0]?.count,
        `${item.tool} conflict must create nothing`,
      );
    }

    const todoKey = "integration-todo-paper-0001";
    const todoInput = {
      userId: owner,
      date: "2026-08-13",
      author: "L" as const,
      revision: null,
      entries: [
        {
          id: "todo-integration",
          kind: "pending" as const,
          text: "private-todo-integration",
        },
      ],
      idempotencyKey: todoKey,
    };
    const todoResults = await Promise.all(
      Array.from({ length: 6 }, () =>
        withService(
          ({ todo }) => todo.replacePaperIdempotently(todoInput),
          owner,
        ),
      ),
    );
    assert.equal(
      todoResults.filter((result) => result.metadata.committed).length,
      1,
    );
    assert.equal(
      todoResults.filter(
        (result) => result.metadata.idempotent_replay,
      ).length,
      5,
    );
    assert.equal(
      todoResults.every((result) => result.paper.revision === 1),
      true,
    );
    const todoRows = await admin.db
      .select({
        id: schema.todoPapers.id,
        revision: schema.todoPapers.revision,
      })
      .from(schema.todoPapers)
      .where(and(
        eq(schema.todoPapers.userId, owner),
        eq(schema.todoPapers.businessDate, todoInput.date),
        eq(schema.todoPapers.author, todoInput.author),
      ));
    assert.equal(todoRows.length, 1);
    assert.equal(todoRows[0]?.revision, 1);

    await assert.rejects(
      withService(
        ({ todo }) =>
          todo.replacePaperIdempotently({
            ...todoInput,
            entries: [
              {
                ...todoInput.entries[0]!,
                text: "different private Todo",
              },
            ],
          }),
        owner,
      ),
      (error: unknown) =>
        error instanceof TodoServiceError
        && error.code === "IDEMPOTENCY_CONFLICT",
    );

    const sharedUserKey = "shared-user-diary-key-0001";
    const ownerDiaryId = await withService(
      ({ diary }) =>
        diary.createMcpDiary(
          { userId: owner },
          diaryInput(sharedUserKey, "isolated-owner"),
        ),
      owner,
    ).then((result) => result.diary.id);
    const otherDiaryId = await withService(
      ({ diary }) =>
        diary.createMcpDiary(
          { userId: other },
          diaryInput(sharedUserKey, "isolated-other"),
        ),
      other,
    ).then((result) => result.diary.id);
    assert.notEqual(ownerDiaryId, otherDiaryId);

    const sharedToolKey = "shared-tool-key-0001";
    const diaryId = await withService(
      ({ diary }) =>
        diary.createMcpDiary(
          { userId: owner },
          diaryInput(sharedToolKey, "tool-isolation"),
        ),
      owner,
    ).then((result) => result.diary.id);
    const toyId = await withService(
      ({ toy }) =>
        toy.createIdempotently(
          owner,
          { action: "set", percent: 31 },
          sharedToolKey,
        ),
      owner,
    ).then((result) => result.id);
    assert.notEqual(diaryId, toyId);

    const legacyKey = "legacy-diary-bridge-0001";
    const legacyPayload = {
      title: "Legacy Diary",
      content: "private-legacy-diary",
      date: "2026-08-01",
      tags: ["legacy"],
      mood: null,
    };
    const legacyHash = createHash("sha256")
      .update(JSON.stringify(legacyPayload), "utf8")
      .digest("hex");
    const [legacy] = await admin.db
      .insert(schema.diaryEntries)
      .values({
        userId: owner,
        ...legacyPayload,
        source: "chatgpt_mcp",
        status: "active",
        idempotencyKey: legacyKey,
        requestHash: legacyHash,
      })
      .returning({ id: schema.diaryEntries.id });
    await admin.db.insert(schema.toolCalls).values({
      userId: owner,
      toolName: "write_diary",
      operation: "create",
      resourceType: "diary_entry",
      resourceId: legacy!.id,
      idempotencyKey: legacyKey,
      requestSummary: {},
      resultSummary: {},
      durationMs: 1,
      status: "success",
    });
    await assert.rejects(
      withService(
        ({ diary }) =>
          diary.createMcpDiary(
            { userId: owner },
            {
              ...legacyPayload,
              author: "L",
              idempotencyKey: legacyKey,
            },
          ),
        owner,
      ),
      (error: unknown) =>
        error instanceof DiaryDomainError
        && error.code === "IDEMPOTENCY_CONFLICT",
    );

    const privateSnapshot = JSON.stringify(
      await admin.db.select().from(schema.mcpWriteIdempotency),
    );
    assert.doesNotMatch(
      privateSnapshot,
      /private-diary|private-todo|private-legacy|response_snapshot|payload/,
    );

    const rollbackCases = [
      {
        tool: "write_diary" as const,
        key: "rollback-diary-key-0001",
        table: "diary_entries",
        call: () =>
          withService(
            ({ diary }) =>
              diary.createMcpDiary(
                { userId: owner },
                diaryInput("rollback-diary-key-0001", "rollback"),
              ),
            owner,
          ),
      },
      {
        tool: "toy_set" as const,
        key: "rollback-toy-set-0001",
        table: "toy_commands",
        call: () =>
          withService(
            ({ toy }) =>
              toy.createIdempotently(
                owner,
                { action: "set", percent: 22 },
                "rollback-toy-set-0001",
              ),
            owner,
          ),
      },
      {
        tool: "toy_stop" as const,
        key: "rollback-toy-stop-0001",
        table: "toy_commands",
        call: () =>
          withService(
            ({ toy }) =>
              toy.createIdempotently(
                owner,
                { action: "stop" },
                "rollback-toy-stop-0001",
              ),
            owner,
          ),
      },
      {
        tool: "write_todo_paper" as const,
        key: "rollback-todo-paper-0001",
        table: "todo_papers",
        call: () =>
          withService(
            ({ todo }) =>
              todo.replacePaperIdempotently({
                userId: owner,
                date: "2026-08-14",
                author: "G",
                revision: null,
                entries: [
                  {
                    id: "todo-rollback",
                    kind: "record",
                    text: "private-todo-rollback",
                  },
                ],
                idempotencyKey: "rollback-todo-paper-0001",
              }),
            owner,
          ),
      },
    ];

    for (const item of rollbackCases) {
      const before = await admin.client.unsafe(
        `select count(*)::int as count from ${item.table}`,
      );
      await admin.client.unsafe(
        "create or replace function fail_mcp_idempotency_test() "
        + "returns trigger language plpgsql as $$ "
        + "begin raise exception 'forced idempotency failure'; end $$; "
        + "create trigger fail_mcp_idempotency_test "
        + "before insert on mcp_write_idempotency "
        + "for each row execute function fail_mcp_idempotency_test()",
      );
      try {
        await assert.rejects(item.call());
      } finally {
        await admin.client.unsafe(
          "drop trigger if exists fail_mcp_idempotency_test "
          + "on mcp_write_idempotency; "
          + "drop function if exists fail_mcp_idempotency_test()",
        );
      }
      const after = await admin.client.unsafe(
        `select count(*)::int as count from ${item.table}`,
      );
      assert.equal(
        after[0]?.count,
        before[0]?.count,
        `${item.tool} business row must roll back`,
      );
      const [idempotency] = await admin.db
        .select({ value: count() })
        .from(schema.mcpWriteIdempotency)
        .where(and(
          eq(schema.mcpWriteIdempotency.userId, owner),
          eq(schema.mcpWriteIdempotency.toolName, item.tool),
          eq(schema.mcpWriteIdempotency.idempotencyKey, item.key),
        ));
      assert.equal(idempotency?.value, 0);
      await item.call();
    }

    await admin.client.end();
  },
);
