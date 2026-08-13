import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleDiaryRepository } from "../src/domains/diary/diary-repository.js";
import { DiaryDomainError, DiaryService } from "../src/domains/diary/diary-service.js";
import { DrizzleTaskRepository } from "../src/domains/task/task-repository.js";
import { TaskDomainError, TaskService } from "../src/domains/task/task-service.js";
import { DrizzleToyCommandRepository } from "../src/domains/toy/toy-command-repository.js";
import { ToyCommandService, ToyDomainError } from "../src/domains/toy/toy-command-service.js";
import { hashMcpWriteRequest } from "../src/domains/mcp-write/mcp-write-idempotency.js";
import { DrizzleMemoryRepository } from "../src/domains/memory/memory-repository.js";
import { MemoryDomainError, MemoryService } from "../src/domains/memory/memory-service.js";
import { DrizzleTodoRepository } from "../src/domains/todo/todo-repository.js";
import { TodoService, TodoServiceError } from "../src/domains/todo/todo-service.js";

const databaseUrl = process.env.DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
const localTarget = parsed?.hostname === "127.0.0.1" || parsed?.hostname === "localhost";
const RUN = process.env.RUN_MCP_WRITE_IDEMPOTENCY_DATABASE_TEST === "1" && Boolean(databaseUrl) && localTarget;

function connection() {
  const client = postgres(databaseUrl!, { max: 1, prepare: false, ssl: false });
  return { client, db: drizzle(client, { schema }) };
}

async function withService<T>(operation: (services: {
  task: TaskService;
  diary: DiaryService;
  toy: ToyCommandService;
  memory: MemoryService;
  todo: TodoService;
}) => Promise<T>, userId: string): Promise<T> {
  const { client, db } = connection();
  try {
    return await operation({
      task: new TaskService(new DrizzleTaskRepository(db as never), () => new Date("2026-08-01T00:00:00Z")),
      diary: new DiaryService(new DrizzleDiaryRepository(db as never)),
      toy: new ToyCommandService(new DrizzleToyCommandRepository(db as never), userId),
      memory: new MemoryService(new DrizzleMemoryRepository(db as never)),
      todo: new TodoService(new DrizzleTodoRepository(db as never)),
    });
  } finally {
    await client.end();
  }
}

const taskInput = (suffix: string) => ({ title: `Task ${suffix}`, description: `private-task-${suffix}`, priority: "normal", dueTime: null, timezone: "Asia/Shanghai", tags: ["mcp"], author: "L" as const });
const diaryInput = (key: string, suffix: string) => ({ title: `Diary ${suffix}`, content: `private-diary-${suffix}`, date: "2026-08-01", tags: ["mcp"], mood: null, author: "L" as const, idempotencyKey: key });
const memoryInput = (suffix: string) => ({ category: "goal" as const, key: ` memory_${suffix} `, content: ` private-memory-${suffix} `, tags: [" mcp ", "mcp", "Cafe\u0301"], author: "L" as const });

test("real PostgreSQL makes all MCP writes concurrent, durable, isolated, and atomic", { skip: !RUN }, async () => {
  const admin = connection();
  await admin.client.unsafe("drop trigger if exists fail_mcp_idempotency_test on mcp_write_idempotency; drop function if exists fail_mcp_idempotency_test()");
  const users = [randomUUID(), randomUUID()];
  await admin.db.insert(schema.users).values(users.map((id, index) => ({ id, email: `mcp-idem-${id}@example.invalid`, displayName: `MCP ${index}`, status: "active" as const })));
  await admin.db.insert(schema.userSettings).values(users.map((userId) => ({ userId, timezone: "Asia/Shanghai" })));
  const owner = users[0]!;
  const other = users[1]!;
  const [lifecycleBeforeMemoryWrite] = await admin.db.select({ value: count() }).from(schema.resourceLifecycleEvents);
  const [toolCallsBeforeMemoryWrite] = await admin.db.select({ value: count() }).from(schema.toolCalls);
  let createdMemoryId = "";

  const cases = [
    {
      tool: "write_memory" as const, key: "integration-memory-key-0001", table: schema.coreMemories,
      call: (userId = owner, suffix = "same") => withService(({ memory }) => memory.createMcpMemory({ userId }, memoryInput(suffix), "integration-memory-key-0001"), userId).then((result) => result.memory.id),
      conflict: () => withService(({ memory }) => memory.createMcpMemory({ userId: owner }, { ...memoryInput("same"), content: "different" }, "integration-memory-key-0001"), owner),
    },
    {
      tool: "create_task" as const, key: "integration-task-key-0001", table: schema.tasks,
      call: (userId = owner, suffix = "same") => withService(({ task }) => task.createTaskIdempotently({ userId }, taskInput(suffix), "integration-task-key-0001"), userId).then((result) => result.task.id),
      conflict: () => withService(({ task }) => task.createTaskIdempotently({ userId: owner }, taskInput("different"), "integration-task-key-0001"), owner),
    },
    {
      tool: "write_diary" as const, key: "integration-diary-key-0001", table: schema.diaryEntries,
      call: (userId = owner, suffix = "same") => withService(({ diary }) => diary.createMcpDiary({ userId }, diaryInput("integration-diary-key-0001", suffix)), userId).then((result) => result.diary.id),
      conflict: () => withService(({ diary }) => diary.createMcpDiary({ userId: owner }, diaryInput("integration-diary-key-0001", "different")), owner),
    },
    {
      tool: "toy_set" as const, key: "integration-toy-set-0001", table: schema.toyCommands,
      call: (userId = owner, suffix = "20") => withService(({ toy }) => toy.createIdempotently(userId, { action: "set", percent: Number(suffix) }, "integration-toy-set-0001"), userId).then((result) => result.id),
      conflict: () => withService(({ toy }) => toy.createIdempotently(owner, { action: "set", percent: 21 }, "integration-toy-set-0001"), owner),
    },
    {
      tool: "toy_stop" as const, key: "integration-toy-stop-0001", table: schema.toyCommands,
      call: (userId = owner) => withService(({ toy }) => toy.createIdempotently(userId, { action: "stop" }, "integration-toy-stop-0001"), userId).then((result) => result.id),
      conflict: async () => {
        const { client, db } = connection();
        try {
          const result = await new DrizzleToyCommandRepository(db as never).createIdempotently(owner, {
            action: "set",
            percent: 10,
            toolName: "toy_stop",
            idempotencyKey: "integration-toy-stop-0001",
            requestHash: hashMcpWriteRequest({ action: "set", percent: 10 }),
          });
          if (result.outcome === "conflict") {
            throw new ToyDomainError("IDEMPOTENCY_CONFLICT", "conflict");
          }
          return result.command;
        } finally {
          await client.end();
        }
      },
    },
  ];

  for (const item of cases) {
    const tableName = item.tool === "create_task" ? "tasks" : item.tool === "write_diary" ? "diary_entries" : item.tool === "write_memory" ? "core_memories" : "toy_commands";
    const beforeRows = await admin.client.unsafe(`select count(*)::int as count from ${tableName} where user_id = $1::uuid`, [owner]);
    const ids = await Promise.all(Array.from({ length: 6 }, () => item.call()));
    assert.equal(new Set(ids).size, 1, `${item.tool} callers must receive one identity`);
    const afterRows = await admin.client.unsafe(`select count(*)::int as count from ${tableName} where user_id = $1::uuid`, [owner]);
    assert.equal(afterRows[0]?.count, Number(beforeRows[0]?.count) + 1, `${item.tool} must create exactly one business row`);
    const [idempotencyCount] = await admin.db.select({ value: count() }).from(schema.mcpWriteIdempotency).where(and(eq(schema.mcpWriteIdempotency.userId, owner), eq(schema.mcpWriteIdempotency.toolName, item.tool), eq(schema.mcpWriteIdempotency.idempotencyKey, item.key)));
    assert.equal(idempotencyCount?.value, 1);
    assert.equal(await item.call(), ids[0]);
    if (item.tool === "write_memory") {
      createdMemoryId = ids[0]!;
      const readback = await withService(({ memory }) => memory.readMemoryDetail({ userId: owner, id: createdMemoryId }), owner);
      assert.deepEqual(readback, {
        id: createdMemoryId,
        category: "goal",
        key: "memory_same",
        content: "private-memory-same",
        tags: ["mcp", "Café"],
        source: "mcp",
        author: "L",
        updated_at: readback.updated_at,
      });
      const [lifecycleAfterWrite] = await admin.db.select({ value: count() }).from(schema.resourceLifecycleEvents);
      const [toolCallsAfterWrite] = await admin.db.select({ value: count() }).from(schema.toolCalls);
      assert.equal(lifecycleAfterWrite?.value, lifecycleBeforeMemoryWrite?.value);
      assert.equal(toolCallsAfterWrite?.value, toolCallsBeforeMemoryWrite?.value);
    }
    await assert.rejects(item.conflict(), (error: unknown) =>
      (error instanceof TaskDomainError || error instanceof DiaryDomainError || error instanceof MemoryDomainError || error instanceof ToyDomainError) && error.code === "IDEMPOTENCY_CONFLICT");
    const afterConflictRows = await admin.client.unsafe(`select count(*)::int as count from ${tableName} where user_id = $1::uuid`, [owner]);
    assert.equal(afterConflictRows[0]?.count, afterRows[0]?.count, `${item.tool} conflict must create nothing`);
  }

  const todoKey = "integration-todo-paper-0001";
  const todoInput = {
    userId: owner,
    date: "2026-08-13",
    author: "L" as const,
    revision: null,
    entries: [{ id: "todo-integration", kind: "pending" as const, text: "private-todo-integration" }],
    idempotencyKey: todoKey,
  };
  const [toolCallsBeforeTodo] = await admin.db.select({ value: count() }).from(schema.toolCalls);
  const [lifecycleBeforeTodo] = await admin.db.select({ value: count() }).from(schema.resourceLifecycleEvents);
  const todoResults = await Promise.all(
    Array.from({ length: 6 }, () =>
      withService(({ todo }) => todo.replacePaperIdempotently(todoInput), owner)
    ),
  );
  assert.equal(todoResults.filter((result) => result.metadata.committed).length, 1);
  assert.equal(todoResults.filter((result) => result.metadata.idempotent_replay).length, 5);
  assert.equal(todoResults.every((result) => result.paper.revision === 1), true);
  const todoRows = await admin.db
    .select({ id: schema.todoPapers.id, revision: schema.todoPapers.revision })
    .from(schema.todoPapers)
    .where(and(
      eq(schema.todoPapers.userId, owner),
      eq(schema.todoPapers.businessDate, todoInput.date),
      eq(schema.todoPapers.author, todoInput.author),
    ));
  assert.equal(todoRows.length, 1);
  assert.equal(todoRows[0]?.revision, 1);
  const todoIdempotency = await admin.db
    .select({ value: count() })
    .from(schema.mcpWriteIdempotency)
    .where(and(
      eq(schema.mcpWriteIdempotency.userId, owner),
      eq(schema.mcpWriteIdempotency.toolName, "write_todo_paper"),
      eq(schema.mcpWriteIdempotency.idempotencyKey, todoKey),
    ));
  assert.equal(todoIdempotency[0]?.value, 1);
  await assert.rejects(
    withService(({ todo }) => todo.replacePaperIdempotently({
      ...todoInput,
      entries: [{ ...todoInput.entries[0]!, text: "different private Todo" }],
    }), owner),
    (error: unknown) => error instanceof TodoServiceError && error.code === "IDEMPOTENCY_CONFLICT",
  );
  const [toolCallsAfterTodo] = await admin.db.select({ value: count() }).from(schema.toolCalls);
  const [lifecycleAfterTodo] = await admin.db.select({ value: count() }).from(schema.resourceLifecycleEvents);
  assert.equal(toolCallsAfterTodo?.value, toolCallsBeforeTodo?.value);
  assert.equal(lifecycleAfterTodo?.value, lifecycleBeforeTodo?.value);

  const diaryAudit = await admin.db.select({ value: count() }).from(schema.toolCalls).where(and(eq(schema.toolCalls.userId, owner), eq(schema.toolCalls.idempotencyKey, "integration-diary-key-0001")));
  assert.equal(diaryAudit[0]?.value, 1, "Diary replay must not add audit rows");

  const isolatedOwnerId = await withService(({ task }) => task.createTaskIdempotently({ userId: owner }, taskInput("isolated-owner"), "shared-user-key-0001"), owner).then((x) => x.task.id);
  const isolatedOtherId = await withService(({ task }) => task.createTaskIdempotently({ userId: other }, taskInput("isolated-other"), "shared-user-key-0001"), other).then((x) => x.task.id);
  assert.notEqual(isolatedOwnerId, isolatedOtherId);
  const sharedToolKey = "shared-tool-key-0001";
  const taskId = await withService(({ task }) => task.createTaskIdempotently({ userId: owner }, taskInput("tool-isolation"), sharedToolKey), owner).then((x) => x.task.id);
  const diaryId = await withService(({ diary }) => diary.createMcpDiary({ userId: owner }, diaryInput(sharedToolKey, "tool-isolation")), owner).then((x) => x.diary.id);
  assert.notEqual(taskId, diaryId);

  const legacyKey = "legacy-diary-bridge-0001";
  const legacyPayload = { title: "Legacy Diary", content: "private-legacy-diary", date: "2026-08-01", tags: ["legacy"], mood: null };
  const legacyHash = createHash("sha256").update(JSON.stringify(legacyPayload), "utf8").digest("hex");
  const [legacy] = await admin.db.insert(schema.diaryEntries).values({ userId: owner, ...legacyPayload, source: "chatgpt_mcp", status: "active", idempotencyKey: legacyKey, requestHash: legacyHash }).returning({ id: schema.diaryEntries.id });
  await admin.db.insert(schema.toolCalls).values({ userId: owner, toolName: "write_diary", operation: "create", resourceType: "diary_entry", resourceId: legacy!.id, idempotencyKey: legacyKey, requestSummary: {}, resultSummary: {}, durationMs: 1, status: "success" });
  await assert.rejects(
    withService(({ diary }) => diary.createMcpDiary({ userId: owner }, { ...legacyPayload, author: "L", idempotencyKey: legacyKey }), owner),
    (error: unknown) => error instanceof DiaryDomainError && error.code === "IDEMPOTENCY_CONFLICT",
  );
  const bridgeAudit = await admin.db.select({ value: count() }).from(schema.toolCalls).where(and(eq(schema.toolCalls.userId, owner), eq(schema.toolCalls.idempotencyKey, legacyKey)));
  assert.equal(bridgeAudit[0]?.value, 1);

  const privateSnapshot = JSON.stringify(await admin.db.select().from(schema.mcpWriteIdempotency));
  assert.doesNotMatch(privateSnapshot, /private-task|private-diary|private-memory|private-todo|private-legacy|response_snapshot|payload/);

  const memoryReplay = await withService(({ memory }) => memory.createMcpMemory({ userId: owner }, memoryInput("same"), "integration-memory-key-0001"), owner);
  assert.equal(memoryReplay.memory.id, createdMemoryId);
  const memoryRowsBeforeArchive = await admin.db.select({ value: count() }).from(schema.coreMemories).where(eq(schema.coreMemories.id, createdMemoryId));
  const memoryIdempotencyBeforeArchive = await admin.db.select({ value: count() }).from(schema.mcpWriteIdempotency).where(and(eq(schema.mcpWriteIdempotency.userId, owner), eq(schema.mcpWriteIdempotency.toolName, "write_memory"), eq(schema.mcpWriteIdempotency.idempotencyKey, "integration-memory-key-0001")));
  const memoryToolCallsBeforeArchive = await admin.db.select({ value: count() }).from(schema.toolCalls).where(eq(schema.toolCalls.resourceId, createdMemoryId));
  const memoryLifecycleBeforeArchive = await admin.db.select({ value: count() }).from(schema.resourceLifecycleEvents).where(and(eq(schema.resourceLifecycleEvents.resourceType, "memory"), eq(schema.resourceLifecycleEvents.resourceId, createdMemoryId)));
  assert.equal(memoryLifecycleBeforeArchive[0]?.value, 0);
  await withService(({ memory }) => memory.archiveMemory({ userId: owner, id: memoryReplay.memory.id }), owner);
  const memoryLifecycleAfterArchive = await admin.db.select({ value: count() }).from(schema.resourceLifecycleEvents).where(and(eq(schema.resourceLifecycleEvents.resourceType, "memory"), eq(schema.resourceLifecycleEvents.resourceId, createdMemoryId)));
  assert.equal(memoryLifecycleAfterArchive[0]?.value, 1);
  const archivedReplay = await withService(({ memory }) => memory.createMcpMemory({ userId: owner }, memoryInput("same"), "integration-memory-key-0001"), owner);
  assert.equal(archivedReplay.memory.id, memoryReplay.memory.id);
  assert.equal(archivedReplay.memory.lifecycle_status, "archived");
  const memoryAudit = await admin.db.select({ value: count() }).from(schema.toolCalls).where(and(eq(schema.toolCalls.userId, owner), eq(schema.toolCalls.resourceId, memoryReplay.memory.id)));
  assert.equal(memoryAudit[0]?.value, 0, "MCP Memory creation must not create tool_calls rows");
  const memoryRowsAfterReplay = await admin.db.select({ value: count() }).from(schema.coreMemories).where(eq(schema.coreMemories.id, createdMemoryId));
  const memoryIdempotencyAfterReplay = await admin.db.select({ value: count() }).from(schema.mcpWriteIdempotency).where(and(eq(schema.mcpWriteIdempotency.userId, owner), eq(schema.mcpWriteIdempotency.toolName, "write_memory"), eq(schema.mcpWriteIdempotency.idempotencyKey, "integration-memory-key-0001")));
  const memoryLifecycleAfterReplay = await admin.db.select({ value: count() }).from(schema.resourceLifecycleEvents).where(and(eq(schema.resourceLifecycleEvents.resourceType, "memory"), eq(schema.resourceLifecycleEvents.resourceId, createdMemoryId)));
  assert.equal(memoryRowsAfterReplay[0]?.value, memoryRowsBeforeArchive[0]?.value);
  assert.equal(memoryIdempotencyAfterReplay[0]?.value, memoryIdempotencyBeforeArchive[0]?.value);
  assert.equal(memoryAudit[0]?.value, memoryToolCallsBeforeArchive[0]?.value);
  assert.equal(memoryLifecycleAfterReplay[0]?.value, memoryLifecycleAfterArchive[0]?.value);

  await assert.rejects(
    withService(({ memory }) => memory.createMcpMemory({ userId: owner }, memoryInput("same"), "different-memory-key-0001"), owner),
    (error) => error instanceof MemoryDomainError && error.code === "MEMORY_KEY_CONFLICT",
  );

  const rollbackCases = [
    { tool: "create_task", key: "rollback-task-key-0001", call: () => withService(({ task }) => task.createTaskIdempotently({ userId: owner }, taskInput("rollback"), "rollback-task-key-0001"), owner), table: "tasks", marker: "Task rollback" },
    { tool: "write_diary", key: "rollback-diary-key-0001", call: () => withService(({ diary }) => diary.createMcpDiary({ userId: owner }, diaryInput("rollback-diary-key-0001", "rollback")), owner), table: "diary_entries", marker: "Diary rollback" },
    { tool: "write_memory", key: "rollback-memory-key-0001", call: () => withService(({ memory }) => memory.createMcpMemory({ userId: owner }, memoryInput("rollback"), "rollback-memory-key-0001"), owner), table: "core_memories", marker: "Memory rollback" },
    { tool: "toy_set", key: "rollback-toy-set-0001", call: () => withService(({ toy }) => toy.createIdempotently(owner, { action: "set", percent: 22 }, "rollback-toy-set-0001"), owner), table: "toy_commands", marker: null },
    { tool: "toy_stop", key: "rollback-toy-stop-0001", call: () => withService(({ toy }) => toy.createIdempotently(owner, { action: "stop" }, "rollback-toy-stop-0001"), owner), table: "toy_commands", marker: null },
    {
      tool: "write_todo_paper",
      key: "rollback-todo-paper-0001",
      call: () => withService(({ todo }) => todo.replacePaperIdempotently({
        userId: owner,
        date: "2026-08-14",
        author: "G",
        revision: null,
        entries: [{ id: "todo-rollback", kind: "record", text: "private-todo-rollback" }],
        idempotencyKey: "rollback-todo-paper-0001",
      }), owner),
      table: "todo_papers",
      marker: null,
    },
  ];
  for (const item of rollbackCases) {
    const before = await admin.client.unsafe(`select count(*)::int as count from ${item.table}`);
    await admin.client.unsafe(`create or replace function fail_mcp_idempotency_test() returns trigger language plpgsql as $$ begin raise exception 'forced idempotency failure'; end $$; create trigger fail_mcp_idempotency_test before insert on mcp_write_idempotency for each row execute function fail_mcp_idempotency_test()`);
    try {
      await assert.rejects(item.call());
    } finally {
      await admin.client.unsafe("drop trigger if exists fail_mcp_idempotency_test on mcp_write_idempotency; drop function if exists fail_mcp_idempotency_test()");
    }
    const after = await admin.client.unsafe(`select count(*)::int as count from ${item.table}`);
    assert.equal(after[0]?.count, before[0]?.count, `${item.tool} business row must roll back`);
    const idempotency = await admin.db.select({ value: count() }).from(schema.mcpWriteIdempotency).where(and(eq(schema.mcpWriteIdempotency.userId, owner), eq(schema.mcpWriteIdempotency.toolName, item.tool as never), eq(schema.mcpWriteIdempotency.idempotencyKey, item.key)));
    assert.equal(idempotency[0]?.value, 0);
    if (item.tool === "write_diary") {
      const audit = await admin.db.select({ value: count() }).from(schema.toolCalls).where(and(eq(schema.toolCalls.userId, owner), eq(schema.toolCalls.idempotencyKey, item.key)));
      assert.equal(audit[0]?.value, 0);
    }
    await item.call();
  }
  await admin.client.end();
});
