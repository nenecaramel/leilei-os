import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ActiveUserAuthorizationError,
} from "../src/domains/require-active-user.js";
import {
  registerNotionExplicitWriteTools,
  type NotionExplicitWriteServiceContract,
} from "../src/mcp/server/register-notion-explicit-writes.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import type {
  ToyAckInput,
  ToyCommandRecord,
  ToyCreateInput,
} from "../src/domains/toy/toy-command-types.js";
import type {
  ToyAckRepositoryResult,
  ToyCommandRepository,
  ToyIdempotentCreateResult,
} from "../src/domains/toy/toy-command-repository.js";
import { ToyCommandService } from "../src/domains/toy/toy-command-service.js";
import { createToyUserRouter } from "../src/web-api/toy-router.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const PAGE_ID = "11111111-1111-4111-8111-111111111111";
const DATABASE_ID = "22222222-2222-4222-8222-222222222222";

function disabledAuthorizer(): () => Promise<string> {
  return async () => {
    throw new ActiveUserAuthorizationError("USER_DISABLED");
  };
}

function activeAuthorizer(): () => Promise<string> {
  return async () => USER_ID;
}

function notionFixture() {
  let providerCalls = 0;
  const notion = {
    async searchPages() {
      providerCalls += 1;
      return {
        results: [{ id: PAGE_ID, title: "Page", url: "https://notion.so/page", last_edited_time: "2026-08-01T00:00:00.000Z" }],
        metadata: { count: 1, has_more: false, next_cursor: null },
      };
    },
    async readPage(pageId: string) {
      providerCalls += 1;
      return {
        page: { id: pageId, title: "Page", url: "https://notion.so/page", last_edited_time: "2026-08-01T00:00:00.000Z" },
        content: "content",
        block_count: 1,
        truncated: false,
      };
    },
    async getConnection() {
      providerCalls += 1;
      return {
        provider: "notion" as const,
        connection: { id: "connection", name: "Bot", type: "bot" as const },
        workspace: { id: "workspace", name: "Workspace" },
        capabilities: [],
      };
    },
    async readDatabase(databaseId: string) {
      providerCalls += 1;
      return { id: databaseId, url: null, title: "Database", created_time: null, last_edited_time: null, data_sources: [], schema: [] };
    },
    async readDataSource() {
      providerCalls += 1;
      return { id: "source", url: null, title: "Source", created_time: null, last_edited_time: null, parent_database_id: null, schema: [] };
    },
    async queryDataSource() {
      providerCalls += 1;
      return { data_source_id: "source", results: [], metadata: { count: 0, has_more: false, next_cursor: null } };
    },
  };
  return { notion, get providerCalls() { return providerCalls; } };
}

async function connect(server: McpServer) {
  const client = new Client({ name: "active-user-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("registered Notion reads fail closed before provider calls for a disabled user", async (t) => {
  const fixture = notionFixture();
  const server = createMcpServer({
    activeUserAuthorization: disabledAuthorizer(),
    notionTools: {
      notionService: fixture.notion,
      getAuthenticatedUserId: () => USER_ID,
    },
    notionRead: {
      notionIntegration: fixture.notion,
      getAuthenticatedUserId: () => USER_ID,
    },
  } as never, USER_ID);
  const connection = await connect(server);
  t.after(async () => { await connection.client.close(); await connection.server.close(); });

  for (const [name, args] of [
    ["search_notion", { query: "Page" }],
    ["read_notion_page", { page_id: PAGE_ID }],
    ["get_notion_connection", {}],
    ["read_notion_database", { database_id: DATABASE_ID }],
  ] as const) {
    const result = await connection.client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, name);
  }
  assert.equal(fixture.providerCalls, 0);
});

test("explicit Notion writes authorize the active user before provider mutation", async (t) => {
  let providerCalls = 0;
  const service: NotionExplicitWriteServiceContract = {
    async createPage() { providerCalls += 1; return { operation: "page.create", target_id: PAGE_ID, verified: true }; },
    async updatePage() { providerCalls += 1; return { operation: "page.update", target_id: PAGE_ID, verified: true }; },
    async updatePageContent() { providerCalls += 1; return { operation: "page.update_content", target_id: PAGE_ID, verified: true }; },
    async createComment() { providerCalls += 1; return { operation: "comment.create", target_id: PAGE_ID, verified: true }; },
    async replyComment() { providerCalls += 1; return { operation: "comment.reply", target_id: PAGE_ID, verified: true }; },
  };
  const server = new McpServer({ name: "active-user-write-test", version: "1.0.0" });
  registerNotionExplicitWriteTools(server, {
    notionService: service,
    getAuthenticatedUserId: () => USER_ID,
    requireActiveUser: disabledAuthorizer(),
  } as never);
  const connection = await connect(server);
  t.after(async () => { await connection.client.close(); await connection.server.close(); });

  const blocked = await connection.client.callTool({
    name: "write_notion_page",
    arguments: { action: "update", page_id: PAGE_ID, body: { properties: {} } },
  });
  assert.equal(blocked.isError, true);
  assert.equal(providerCalls, 0);
});

test("Notion provider reads fail closed for a missing durable user", async (t) => {
  const fixture = notionFixture();
  const server = createMcpServer({
    activeUserAuthorization: async () => {
      throw new ActiveUserAuthorizationError("USER_NOT_FOUND");
    },
    notionTools: {
      notionService: fixture.notion,
      getAuthenticatedUserId: () => USER_ID,
    },
  } as never, USER_ID);
  const connection = await connect(server);
  t.after(async () => { await connection.client.close(); await connection.server.close(); });

  const result = await connection.client.callTool({
    name: "read_notion_page",
    arguments: { page_id: PAGE_ID },
  });
  assert.equal(result.isError, true);
  assert.equal(fixture.providerCalls, 0);
});

class FakeToyRepository implements ToyCommandRepository {
  status: "active" | "disabled" | null = "disabled";
  creates = 0;
  idempotentCreates = 0;
  claims = 0;
  acks = 0;

  async findUserById() {
    return this.status ? { status: this.status } : null;
  }

  async create(userId: string, input: ToyCreateInput) {
    this.creates += 1;
    return toyRecord(userId, input);
  }

  async createIdempotently(userId: string, input: ToyCreateInput & { toolName: "toy_set" | "toy_stop"; idempotencyKey: string; requestHash: string }): Promise<ToyIdempotentCreateResult> {
    this.idempotentCreates += 1;
    return { outcome: "created", command: toyRecord(userId, input) };
  }

  async claim(userId: string) {
    this.claims += 1;
    return toyRecord(userId, { action: "stop" });
  }

  async ack(_userId: string, _id: string, _input: ToyAckInput): Promise<ToyAckRepositoryResult> {
    this.acks += 1;
    return { kind: "updated", command: toyRecord(USER_ID, { action: "stop" }) };
  }
}

function toyRecord(userId: string, input: ToyCreateInput): ToyCommandRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    userId,
    action: input.action,
    percent: input.action === "set" ? input.percent : null,
    durationSeconds: input.action === "set" ? input.durationSeconds ?? 60 : null,
    status: "pending",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: new Date("2026-08-01T00:00:10.000Z"),
    claimedAt: null,
    completedAt: null,
    expiredAt: null,
    error: null,
  };
}

test("Toy rejects disabled bound users before Web, MCP, claim, or ack mutations", async () => {
  const repository = new FakeToyRepository();
  const service = new ToyCommandService(repository, USER_ID);
  for (const operation of [
    () => service.create(USER_ID, { action: "stop" }),
    () => service.createIdempotently(USER_ID, { action: "stop" }, "toy-auth-test-0001"),
    () => service.claim(),
    () => service.ack("33333333-3333-4333-8333-333333333333", { status: "completed" }),
  ]) {
    await assert.rejects(operation, (error: unknown) => error instanceof ActiveUserAuthorizationError && error.code === "USER_DISABLED");
  }
  assert.equal(repository.creates, 0);
  assert.equal(repository.idempotentCreates, 0);
  assert.equal(repository.claims, 0);
  assert.equal(repository.acks, 0);
});

test("Toy Web create returns a safe unavailable response before mutating for a disabled user", async () => {
  const repository = new FakeToyRepository();
  const service = new ToyCommandService(repository, USER_ID);
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.webUserId = USER_ID;
    next();
  });
  app.use("/api/v1/toy", createToyUserRouter({ toyService: service }));

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/toy/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      success: false,
      error: { code: "TOY_UNAVAILABLE", message: "Toy command queue is unavailable." },
    });
    assert.equal(repository.creates, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("Toy rejects a missing bound user before any mutation", async () => {
  const repository = new FakeToyRepository();
  repository.status = null;
  const service = new ToyCommandService(repository, USER_ID);
  await assert.rejects(
    service.create(USER_ID, { action: "stop" }),
    (error: unknown) => error instanceof ActiveUserAuthorizationError && error.code === "USER_NOT_FOUND",
  );
  assert.equal(repository.creates, 0);
});

test("Toy keeps active Web and MCP operations working", async () => {
  const repository = new FakeToyRepository();
  repository.status = "active";
  const service = new ToyCommandService(repository, USER_ID);
  await service.create(USER_ID, { action: "stop" });
  await service.createIdempotently(USER_ID, { action: "stop" }, "toy-active-test-0001");
  assert.equal(repository.creates, 1);
  assert.equal(repository.idempotentCreates, 1);
  assert.equal((await service.claim())?.userId, USER_ID);
  await service.ack("33333333-3333-4333-8333-333333333333", { status: "completed" });
  assert.equal(repository.claims, 1);
  assert.equal(repository.acks, 1);
});
