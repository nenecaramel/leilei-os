import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  AuthenticatedDiaryContext,
  CreateDiaryInput,
  CreateDiaryResult,
} from "../src/domains/diary/diary-service.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import {
  WriteDiaryAuthenticationError,
  type WriteDiaryToolDependencies,
} from "../src/mcp/tools/write-diary/register.js";

const AUTHENTICATED_USER_ID = "00000000-0000-4000-8000-000000000099";

class MockDiaryToolService {
  calls: Array<{
    context: AuthenticatedDiaryContext;
    input: CreateDiaryInput;
  }> = [];

  async createMcpDiary(
    context: AuthenticatedDiaryContext,
    input: CreateDiaryInput,
  ): Promise<CreateDiaryResult> {
    this.calls.push({ context, input });

    return {
      diary: {
        id: "00000000-0000-4000-8000-000000000001",
        title: input.title,
        date: input.date,
        tags: [...input.tags],
        mood: input.mood ?? null,
        author: input.author ?? null,
        created_at: "2026-07-22T08:00:00.000Z",
      },
      metadata: {
        created: true,
        idempotent_replay: false,
      },
    };
  }
}

function createTestDependencies(
  diaryService: MockDiaryToolService,
  getAuthenticatedUserId: () => string = () => AUTHENTICATED_USER_ID,
) {
  return {
    readMemory: {
      memoryService: {
        readMemory: async () => ({
          user: { display_name: "Leilei" },
          memories: [],
          metadata: { count: 0 },
        }),
      },
      getAuthenticatedUserId: () => AUTHENTICATED_USER_ID,
    },
    writeDiary: {
      diaryService,
      getAuthenticatedUserId,
    } satisfies WriteDiaryToolDependencies,
  };
}

async function connectTestClient(dependencies: ReturnType<typeof createTestDependencies>) {
  const server = createMcpServer(dependencies);
  const client = new Client(
    { name: "write-diary-test-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

test("tools/list includes all registered Phase 4 tools plus later read additions", async (t) => {
  const diaryService = new MockDiaryToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(diaryService),
  );
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.listTools();
  assert.deepEqual(
    response.tools.map((tool) => tool.name).sort(),
    [
      "add_universe_diary_source",
      "create_task",
      "create_universe_node",
      "create_universe_relation",
      "delete_universe_diary_source",
      "delete_universe_relation",
      "get_diary",
      "get_local_context",
      "get_memory",
      "get_notion_connection",
      "get_task",
      "get_universe_diary_sources",
      "get_universe_node",
      "get_universe_relations",
      "get_weather_context",
      "global_search",
      "hello",
      "list_tasks",
      "list_todo_dates",
      "list_universe_nodes",
      "query_notion_data_source",
      "read_memory",
      "read_notion_data_source",
      "read_notion_database",
      "read_notion_page",
      "read_todo_day",
      "search_diary",
      "search_memory",
      "search_notion",
      "search_universe",
      "toy_set",
      "toy_stop",
      "transition_task",
      "update_diary",
      "update_memory",
      "update_task",
      "update_universe_node",
      "write_diary",
      "write_memory",
      "write_todo_paper",
    ],
  );

  const writeDiary = response.tools.find((tool) => tool.name === "write_diary");
  assert.equal(writeDiary?.annotations?.readOnlyHint, false);
  assert.equal(writeDiary?.annotations?.idempotentHint, true);
  assert.equal("user_id" in (writeDiary?.inputSchema.properties ?? {}), false);
  assert.equal("source" in (writeDiary?.inputSchema.properties ?? {}), false);
});

test("write_diary calls the mock service with authenticated context", async (t) => {
  const diaryService = new MockDiaryToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(diaryService),
  );
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "write_diary",
    arguments: {
      title: "测试日记",
      content: "这是来自 MCP Tool 测试的内容。",
      date: "2026-07-22",
      tags: ["MCP", "测试"],
      mood: "开心",
      author: "G",
      idempotency_key: "diary-20260722-test-0001",
    },
  });

  assert.equal(response.isError, undefined);
  assert.equal(diaryService.calls.length, 1);
  assert.deepEqual(diaryService.calls[0], {
    context: { userId: AUTHENTICATED_USER_ID },
    input: {
      title: "测试日记",
      content: "这是来自 MCP Tool 测试的内容。",
      date: "2026-07-22",
      tags: ["MCP", "测试"],
      mood: "开心",
      idempotencyKey: "diary-20260722-test-0001",
      author: "G",
    },
  });
  assert.deepEqual(response.structuredContent, {
    success: true,
    data: {
      diary: {
        id: "00000000-0000-4000-8000-000000000001",
        title: "测试日记",
        date: "2026-07-22",
        tags: ["MCP", "测试"],
        mood: "开心",
        author: "G",
        created_at: "2026-07-22T08:00:00.000Z",
      },
      metadata: { created: true, idempotent_replay: false },
    },
  });
});

test("write_diary rejects invalid input before calling the service", async (t) => {
  const diaryService = new MockDiaryToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(diaryService),
  );
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "write_diary",
    arguments: {
      title: "测试日记",
      content: "内容",
      date: "明天",
      tags: [],
      idempotency_key: "diary-20260722-test-0002",
      author: "L",
      user_id: "00000000-0000-4000-8000-000000000123",
    },
  });

  assert.equal(response.isError, true);
  assert.equal(diaryService.calls.length, 0);
});

test("write_diary fails safely when authenticated context is unavailable", async (t) => {
  const diaryService = new MockDiaryToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(diaryService, () => {
      throw new WriteDiaryAuthenticationError();
    }),
  );
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "write_diary",
    arguments: {
      title: "测试日记",
      content: "内容",
      date: "2026-07-22",
      tags: [],
      idempotency_key: "diary-20260722-test-0003",
      author: "L",
    },
  });

  assert.equal(response.isError, true);
  assert.match(
    String(response.content[0] && "text" in response.content[0]
      ? response.content[0].text
      : ""),
    /Authentication is required/,
  );
  assert.equal(diaryService.calls.length, 0);
});
