import assert from "node:assert/strict";
import test from "node:test";
import {
  SystemService,
  type SystemDataSummary,
  type SystemRepository,
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
