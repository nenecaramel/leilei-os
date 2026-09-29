import assert from "node:assert/strict";
import test from "node:test";
import {
  SystemService,
  type SystemActivityItem,
  type SystemDataSummary,
  type SystemLifecycleActivityRecord,
  type SystemRepository,
  type SystemToolActivityRecord,
} from "../src/domains/system/system-service.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

function createRepository(overrides: Partial<SystemRepository> = {}): SystemRepository {
  return {
    async findUserById() {
      return { status: "active" as const };
    },
    async readDataSummary() {
      return {
        diary: { active: 3, archived: 2 },
        diary_comments: { count: 5 },
        todo: { active: 4, count: 4 },
        workspaces: { count: 2 },
        conversations: { active: 6, archived: 1 },
        mind: { count: 9 },
        universe: { nodes: 7 },
      } satisfies SystemDataSummary;
    },
    async listLifecycleActivity() {
      return [];
    },
    async listToolActivity() {
      return [];
    },
    ...overrides,
  };
}

test("connections expose only truthful safe channel statuses", async () => {
  const enabled = new SystemService(createRepository(), {
    internalMcpEnabled: true,
  });
  const disabled = new SystemService(createRepository(), {
    internalMcpEnabled: false,
  });

  assert.deepEqual(await enabled.readConnections(USER_ID), {
    web_api: "online",
    public_mcp: "available",
    internal_mcp: "available",
  });
  assert.deepEqual(await disabled.readConnections(USER_ID), {
    web_api: "online",
    public_mcp: "available",
    internal_mcp: "not_enabled",
  });
  assert.equal(JSON.stringify(await enabled.readConnections(USER_ID)).includes("token"), false);
});

test("data summary forwards the authenticated user id and preserves real counts", async () => {
  const calls: string[] = [];
  const service = new SystemService(createRepository({
    async readDataSummary(userId) {
      calls.push(userId);
      return {
        diary: { active: 3, archived: 4 },
        diary_comments: { count: 5 },
        todo: { active: 9, count: 9 },
        workspaces: { count: 2 },
        conversations: { active: 4, archived: 1 },
        mind: { count: 8 },
        universe: { nodes: 6 },
      };
    },
  }));

  assert.deepEqual(await service.readDataSummary(USER_ID), {
    diary: { active: 3, archived: 4 },
    diary_comments: { count: 5 },
    todo: { active: 9, count: 9 },
    workspaces: { count: 2 },
    conversations: { active: 4, archived: 1 },
    mind: { count: 8 },
    universe: { nodes: 6 },
  });
  assert.deepEqual(calls, [USER_ID]);
});

test("activity normalizes persisted lifecycle and meaningful tool evidence, filters noise, sorts and caps after merge", async () => {
  const lifecycle: SystemLifecycleActivityRecord[] = [
    {
      id: "life-web",
      resourceType: "diary",
      action: "archive",
      actorType: "user",
      channel: "web",
      createdAt: new Date("2026-08-09T00:03:00.000Z"),
    },
    {
      id: "life-noise",
      resourceType: "diary",
      action: "unknown",
      actorType: "user",
      channel: "web",
      createdAt: new Date("2026-08-09T00:04:00.000Z"),
    },
  ];
  const tools: SystemToolActivityRecord[] = [
    {
      id: "tool-failed",
      toolName: "write_diary",
      operation: "create",
      source: "mcp",
      status: "error",
      errorCode: "DIARY_INVALID",
      createdAt: new Date("2026-08-09T00:05:00.000Z"),
    },
    {
      id: "tool-ok",
      toolName: "write_diary",
      operation: "create",
      source: "mcp",
      status: "success",
      errorCode: null,
      createdAt: new Date("2026-08-09T00:02:00.000Z"),
    },
    {
      id: "tool-unclear",
      toolName: "unknown_tool",
      operation: "read",
      source: "unknown",
      status: "success",
      errorCode: null,
      createdAt: new Date("2026-08-09T00:06:00.000Z"),
    },
  ];
  const service = new SystemService(createRepository({
    async listLifecycleActivity(_userId, limit) {
      assert.equal(limit, 100);
      return lifecycle;
    },
    async listToolActivity(_userId, limit) {
      assert.equal(limit, 100);
      return tools;
    },
  }));

  const result = await service.readActivity(USER_ID);

  assert.deepEqual(result, [
    {
      id: "tool-failed",
      occurred_at: "2026-08-09T00:05:00.000Z",
      label: "Diary creation failed",
      source: "MCP",
      outcome: "failed",
    },
    {
      id: "life-web",
      occurred_at: "2026-08-09T00:03:00.000Z",
      label: "Diary archived",
      source: "Web",
      outcome: "success",
    },
    {
      id: "tool-ok",
      occurred_at: "2026-08-09T00:02:00.000Z",
      label: "Diary created",
      source: "MCP",
      outcome: "success",
    },
  ] satisfies SystemActivityItem[]);
});

test("activity returns only the final bounded list after merging sources", async () => {
  const service = new SystemService(createRepository({
    async listLifecycleActivity() {
      return Array.from({ length: 80 }, (_, index) => ({
        id: `life-${index}`,
        resourceType: "diary_entry" as const,
        action: "archive" as const,
        actorType: "user" as const,
        channel: "web" as const,
        createdAt: new Date(2026, 0, 1, 0, index),
      }));
    },
    async listToolActivity() {
      return Array.from({ length: 80 }, (_, index) => ({
        id: `tool-${index}`,
        toolName: "write_diary" as const,
        operation: "create",
        source: "mcp" as const,
        status: "success" as const,
        errorCode: null,
        createdAt: new Date(2026, 0, 1, 1, index),
      }));
    },
  }));

  const result = await service.readActivity(USER_ID);
  assert.equal(result.length, 50);
  assert.equal(result[0]?.id, "tool-79");
  assert.equal(result.at(-1)?.id, "tool-30");
});

test("activity retrieval errors are not converted to an empty success", async () => {
  const service = new SystemService(createRepository({
    async listLifecycleActivity() {
      throw new Error("database unavailable");
    },
  }));

  await assert.rejects(service.readActivity(USER_ID), /database unavailable/u);
});
