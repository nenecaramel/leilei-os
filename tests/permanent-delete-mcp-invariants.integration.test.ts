import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import * as schema from "../src/database/schema.js";
import { users, coreMemories, diaryEntries, tasks, mcpWriteIdempotency } from "../src/database/schema.js";
import { DrizzleMemoryRepository } from "../src/domains/memory/memory-repository.js";
import { MemoryService } from "../src/domains/memory/memory-service.js";
import { DrizzleDiaryRepository } from "../src/domains/diary/diary-repository.js";
import { DiaryService } from "../src/domains/diary/diary-service.js";
import { DrizzleTaskRepository } from "../src/domains/task/task-repository.js";
import { TaskService } from "../src/domains/task/task-service.js";
import { DrizzleExportRepository } from "../src/domains/export/export-repository.js";
import { ExportService } from "../src/domains/export/export-service.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
const RUN = process.env.RUN_PERMANENT_DELETE_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (parsedDatabaseUrl?.hostname === "localhost" || parsedDatabaseUrl?.hostname === "127.0.0.1");

class RollbackInvariantTest extends Error {}

test(
  "permanent deletion is absent from MCP reads, cannot replay old writes, and exports content-free tombstones",
  { skip: !RUN },
  async () => {
    const client = postgres(databaseUrl!, { max: 4, prepare: false, ssl: false });
    const database = drizzle(client, { schema });
    try {
      await assert.rejects(
        database.transaction(async (transaction) => {
          const userId = randomUUID();
          const memoryId = randomUUID();
          const diaryId = randomUUID();
          const taskId = randomUUID();
          const now = new Date("2026-08-20T00:00:00.000Z");
          await transaction.insert(users).values({
            id: userId,
            email: `mcp-delete-${userId}@example.invalid`,
            displayName: "MCP delete owner",
            status: "active",
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(coreMemories).values({
            id: memoryId,
            userId,
            category: "goal",
            key: `mcp-deleted-memory-${memoryId}`,
            content: "mcp deleted memory secret",
            tags: ["private"],
            visibility: "assistant",
            source: "mcp",
            status: "archived",
            author: "L",
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(diaryEntries).values({
            id: diaryId,
            userId,
            title: "MCP deleted diary title",
            content: "mcp deleted diary secret",
            date: "2026-08-20",
            tags: ["private"],
            mood: null,
            source: "chatgpt_mcp",
            status: "archived",
            author: "L",
            idempotencyKey: `mcp-delete-diary-${diaryId}`,
            requestHash: createHash("sha256").update(diaryId).digest("hex"),
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(tasks).values({
            id: taskId,
            userId,
            title: "MCP deleted task title",
            description: "mcp deleted task secret",
            status: "pending",
            resumeStatus: null,
            lifecycleStatus: "archived",
            author: "L",
            priority: "normal",
            dueTime: null,
            timezone: "Asia/Shanghai",
            tags: [],
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          });
          await transaction.insert(mcpWriteIdempotency).values([
            {
              userId,
              toolName: "write_memory",
              idempotencyKey: "mcp-delete-memory-key",
              requestHash: "a".repeat(64),
              resourceType: "memory",
              resourceId: memoryId,
              createdAt: now,
            },
            {
              userId,
              toolName: "write_diary",
              idempotencyKey: "mcp-delete-diary-key",
              requestHash: "b".repeat(64),
              resourceType: "diary_entry",
              resourceId: diaryId,
              createdAt: now,
            },
            {
              userId,
              toolName: "create_task",
              idempotencyKey: "mcp-delete-task-key",
              requestHash: "c".repeat(64),
              resourceType: "task",
              resourceId: taskId,
              createdAt: now,
            },
          ]);

          const memoryRepository = new DrizzleMemoryRepository(transaction as never);
          const diaryRepository = new DrizzleDiaryRepository(transaction as never);
          const taskRepository = new DrizzleTaskRepository(transaction as never);
          assert.equal(await memoryRepository.permanentlyDeleteMemory!({ userId, id: memoryId, actorType: "user", channel: "web" }), true);
          assert.equal(await diaryRepository.permanentlyDeleteDiary!({ userId, id: diaryId, actorType: "user", channel: "web" }), true);
          assert.equal(await taskRepository.permanentlyDeleteTask!({ userId, id: taskId, actorType: "user", channel: "web" }), true);

          const memoryService = new MemoryService(memoryRepository);
          const diaryService = new DiaryService(diaryRepository);
          const taskService = new TaskService(taskRepository);
          const server = createMcpServer({
            memoryReads: { memoryService, getAuthenticatedUserId: () => userId },
            writeMemory: { memoryService, getAuthenticatedUserId: () => userId },
            diaryTools: { diaryService, getAuthenticatedUserId: () => userId },
            taskTools: { taskService, getAuthenticatedUserId: () => userId },
          });
          const mcpClient = new Client({ name: "permanent-delete-invariant-test", version: "1" }, { capabilities: {} });
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          await server.connect(serverTransport);
          await mcpClient.connect(clientTransport);
          try {
            const memoryRead = await mcpClient.callTool({ name: "read_memory", arguments: {} });
            assert.equal(memoryRead.isError, undefined);
            assert.equal((memoryRead.structuredContent as { data: { metadata: { count: number } } }).data.metadata.count, 0);
            const memoryDetail = await mcpClient.callTool({ name: "get_memory", arguments: { id: memoryId, scope: "archived" } });
            assert.equal(memoryDetail.isError, true);

            const diaryRead = await mcpClient.callTool({ name: "search_diary", arguments: { query: "MCP deleted" } });
            assert.equal(diaryRead.isError, undefined);
            assert.equal((diaryRead.structuredContent as { data: { metadata: { count: number } } }).data.metadata.count, 0);
            const diaryDetail = await mcpClient.callTool({ name: "get_diary", arguments: { id: diaryId, scope: "archived" } });
            assert.equal(diaryDetail.isError, true);

            const taskRead = await mcpClient.callTool({ name: "list_tasks", arguments: { query: "MCP deleted" } });
            assert.equal(taskRead.isError, undefined);
            assert.equal((taskRead.structuredContent as { data: { metadata: { count: number } } }).data.metadata.count, 0);
            const taskDetail = await mcpClient.callTool({ name: "get_task", arguments: { id: taskId, scope: "archived" } });
            assert.equal(taskDetail.isError, true);

            const replayMemory = await mcpClient.callTool({ name: "write_memory", arguments: {
              category: "goal", key: `mcp-deleted-memory-${memoryId}`, content: "mcp deleted memory secret", tags: ["private"], author: "L", idempotency_key: "mcp-delete-memory-key",
            } });
            const replayDiary = await mcpClient.callTool({ name: "write_diary", arguments: {
              title: "MCP deleted diary title", content: "mcp deleted diary secret", date: "2026-08-20", tags: ["private"], author: "L", idempotency_key: "mcp-delete-diary-key",
            } });
            const replayTask = await mcpClient.callTool({ name: "create_task", arguments: {
              title: "MCP deleted task title", description: "mcp deleted task secret", priority: "normal", tags: [], author: "L", idempotency_key: "mcp-delete-task-key",
            } });
            assert.equal(replayMemory.isError, true);
            assert.equal(replayDiary.isError, true);
            assert.equal(replayTask.isError, true);
            assert.equal((await transaction.select().from(coreMemories).where(eq(coreMemories.id, memoryId))).length, 0);
            assert.equal((await transaction.select().from(diaryEntries).where(eq(diaryEntries.id, diaryId))).length, 0);
            assert.equal((await transaction.select().from(tasks).where(eq(tasks.id, taskId))).length, 0);

            const exporter = new ExportService(new DrizzleExportRepository(transaction as never), () => now);
            const exported = await exporter.createExport(userId, "all", true);
            const lifecycle = exported.audit?.lifecycle ?? [];
            assert.equal(lifecycle.length, 3);
            assert.equal(lifecycle.every((event) => event.action === "permanent_delete" && JSON.stringify(event.metadata ?? {}) === "{}"), true);
            assert.equal(JSON.stringify(lifecycle).includes("deleted memory secret"), false);
            assert.equal(JSON.stringify(lifecycle).includes("deleted diary secret"), false);
            assert.equal(JSON.stringify(lifecycle).includes("deleted task secret"), false);
          } finally {
            await mcpClient.close();
            await server.close();
          }
          throw new RollbackInvariantTest();
        }),
        RollbackInvariantTest,
      );
    } finally {
      await client.end();
    }
  },
);
