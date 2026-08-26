import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemoryDomainError } from "../src/domains/memory/memory-service.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import {
  createMcpToolError,
  mcpToolErrorStructuredContentSchema,
} from "../src/mcp/tools/error-contract.js";
import {
  ReadMemoryAuthenticationError,
  registerReadMemoryTool,
} from "../src/mcp/tools/read-memory/register.js";
import { registerSearchMemoryTool } from "../src/mcp/tools/search-memory/register.js";
import { registerGetMemoryTool } from "../src/mcp/tools/get-memory/register.js";
import {
  WriteMemoryAuthenticationError,
  registerWriteMemoryTool,
} from "../src/mcp/tools/write-memory/register.js";
import {
  UpdateMemoryAuthenticationError,
  registerUpdateMemoryTool,
} from "../src/mcp/tools/update-memory/register.js";
import { NotionReadError } from "../src/domains/notion/notion-read-client.js";
import { NotionIntegrationError } from "../src/domains/notion/notion-read-integration.js";
import {
  NotionAdvancedAuthenticationError,
  registerGetNotionConnectionTool,
} from "../src/mcp/tools/get-notion-connection/register.js";
import { registerReadNotionDatabaseTool } from "../src/mcp/tools/read-notion-database/register.js";
import { registerSearchNotionTool } from "../src/mcp/tools/search-notion/register.js";
import { registerReadNotionPageTool } from "../src/mcp/tools/read-notion-page/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

type ProductionMcpErrorAuditKind = "structured" | "no-handler-error";

const EXPECTED_PRODUCTION_MCP_TOOL_NAMES = [
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
] as const;

// Filled by the production-surface audit in the next task step.
const PRODUCTION_MCP_TOOL_ERROR_AUDIT: Record<string, ProductionMcpErrorAuditKind> = {};

async function connectServer(server: McpServer, name: string) {
  const client = new Client({ name, version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function errorOf(result: Awaited<ReturnType<Client["callTool"]>>) {
  assert.equal(result.isError, true);
  const structured = result.structuredContent as {
    success?: boolean;
    error?: { code?: string; message?: string };
  } | undefined;
  assert.equal(structured?.success, false);
  assert.equal(typeof structured?.error?.code, "string");
  assert.equal(typeof structured?.error?.message, "string");
  return structured!.error!;
}

function assertSecretAbsent(
  result: Awaited<ReturnType<Client["callTool"]>>,
  secret: string,
) {
  assert.equal(JSON.stringify(result).includes(secret), false);
}

async function callReadMemoryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "read-memory-error-contract", version: "1.0.0" });
  registerReadMemoryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    memoryService: {
      async readMemory() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "read-memory-error-client");
  try {
    return await pair.client.callTool({ name: "read_memory", arguments: {} });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

async function callSearchMemoryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "search-memory-error-contract", version: "1.0.0" });
  registerSearchMemoryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    memoryService: {
      async readMemory() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "search-memory-error-client");
  try {
    return await pair.client.callTool({
      name: "search_memory",
      arguments: { query: "contract" },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

async function callGetMemoryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "get-memory-error-contract", version: "1.0.0" });
  registerGetMemoryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    memoryService: {
      async readMemoryDetail() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "get-memory-error-client");
  try {
    return await pair.client.callTool({
      name: "get_memory",
      arguments: { id: "memory-contract-id" },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

async function callWriteMemoryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "write-memory-error-contract", version: "1.0.0" });
  registerWriteMemoryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    memoryService: {
      async createMcpMemory() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "write-memory-error-client");
  try {
    return await pair.client.callTool({
      name: "write_memory",
      arguments: {
        category: "profile",
        key: "contract-key",
        content: "contract-content",
        author: "L",
        idempotency_key: "mcp-error-contract-memory-0001",
      },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

async function callUpdateMemoryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "update-memory-error-contract", version: "1.0.0" });
  registerUpdateMemoryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    memoryService: {
      async updateMcpMemory() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "update-memory-error-client");
  try {
    return await pair.client.callTool({
      name: "update_memory",
      arguments: { id: "memory-contract-id", tags: ["contract"] },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

test("shared MCP tool error helper emits the strict machine-readable envelope", () => {
  const result = createMcpToolError(
    "INTERNAL_ERROR",
    "Memory is temporarily unavailable.",
  );

  assert.equal(result.isError, true);
  assert.deepEqual(result.content, [
    { type: "text", text: "Memory is temporarily unavailable." },
  ]);
  assert.deepEqual(
    mcpToolErrorStructuredContentSchema.parse(result.structuredContent),
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Memory is temporarily unavailable.",
      },
    },
  );
  assert.throws(() =>
    mcpToolErrorStructuredContentSchema.parse({
      ...result.structuredContent,
      unexpected: true,
    }),
  );
});

test("read_memory preserves a stable domain error code in structuredContent", async () => {
  const result = await callReadMemoryFailure({
    error: new MemoryDomainError("USER_DISABLED", "SECRET_DOMAIN_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "USER_DISABLED");
  assert.equal(error.message, "Memory is unavailable for the authenticated user.");
  assertSecretAbsent(result, "SECRET_DOMAIN_DETAIL");
});

test("read_memory maps missing MCP auth context to AUTHENTICATION_REQUIRED", async () => {
  const result = await callReadMemoryFailure({
    getAuthenticatedUserId: () => {
      throw new ReadMemoryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to read memory.");
});

test("read_memory sanitizes an unknown exception as INTERNAL_ERROR", async () => {
  const result = await callReadMemoryFailure({
    error: new Error("SECRET_DATABASE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Memory is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_DATABASE_DETAIL");
});

test("search_memory preserves domain error codes without leaking detail", async () => {
  const result = await callSearchMemoryFailure({
    error: new MemoryDomainError("INVALID_MEMORY_QUERY", "SECRET_SEARCH_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INVALID_MEMORY_QUERY");
  assert.equal(error.message, "The Memory search is invalid.");
  assertSecretAbsent(result, "SECRET_SEARCH_DETAIL");
});

test("search_memory maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callSearchMemoryFailure({
    getAuthenticatedUserId: () => {
      throw new ReadMemoryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to search memory.");
});

test("search_memory sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callSearchMemoryFailure({
    error: new Error("SECRET_SEARCH_DATABASE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Memory is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_SEARCH_DATABASE_DETAIL");
});

test("get_memory preserves MEMORY_NOT_FOUND as a machine-readable code", async () => {
  const result = await callGetMemoryFailure({
    error: new MemoryDomainError("MEMORY_NOT_FOUND", "SECRET_GET_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "MEMORY_NOT_FOUND");
  assert.equal(error.message, "Memory was not found.");
  assertSecretAbsent(result, "SECRET_GET_DETAIL");
});

test("get_memory maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callGetMemoryFailure({
    getAuthenticatedUserId: () => {
      throw new ReadMemoryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to read memory.");
});

test("get_memory sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callGetMemoryFailure({
    error: new Error("SECRET_GET_DATABASE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Memory is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_GET_DATABASE_DETAIL");
});

test("write_memory preserves idempotency conflicts as machine-readable codes", async () => {
  const result = await callWriteMemoryFailure({
    error: new MemoryDomainError("IDEMPOTENCY_CONFLICT", "SECRET_WRITE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(
    error.message,
    "This idempotency key was already used for different Memory content.",
  );
  assertSecretAbsent(result, "SECRET_WRITE_DETAIL");
});

test("write_memory maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callWriteMemoryFailure({
    getAuthenticatedUserId: () => {
      throw new WriteMemoryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to write Memory.");
});

test("write_memory sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callWriteMemoryFailure({
    error: new Error("SECRET_WRITE_DATABASE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Memory writing is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_WRITE_DATABASE_DETAIL");
});

test("update_memory preserves MEMORY_NOT_FOUND as a machine-readable code", async () => {
  const result = await callUpdateMemoryFailure({
    error: new MemoryDomainError("MEMORY_NOT_FOUND", "SECRET_UPDATE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "MEMORY_NOT_FOUND");
  assert.equal(error.message, "Memory was not found.");
  assertSecretAbsent(result, "SECRET_UPDATE_DETAIL");
});

test("update_memory maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callUpdateMemoryFailure({
    getAuthenticatedUserId: () => {
      throw new UpdateMemoryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to update Memory.");
});

test("update_memory sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callUpdateMemoryFailure({
    error: new Error("SECRET_UPDATE_DATABASE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Memory updating is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_UPDATE_DATABASE_DETAIL");
});

test("search_notion preserves provider error codes in structuredContent", async (t) => {
  const server = new McpServer({ name: "search-notion-error-contract", version: "1.0.0" });
  registerSearchNotionTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    notionService: {
      async searchPages() {
        throw new NotionReadError("RATE_LIMITED", "PROVIDER_RATE_LIMIT_DETAIL");
      },
    },
  });
  const pair = await connectServer(server, "search-notion-error-client");
  t.after(async () => { await pair.client.close(); await pair.server.close(); });
  const result = await pair.client.callTool({ name: "search_notion", arguments: { query: "contract" } });
  const error = errorOf(result);
  assert.deepEqual(error, { code: "RATE_LIMITED", message: "Notion is temporarily rate limited." });
  assertSecretAbsent(result, "PROVIDER_RATE_LIMIT_DETAIL");
});

test("read_notion_page preserves NOT_FOUND in structuredContent", async (t) => {
  const server = new McpServer({ name: "read-notion-page-error-contract", version: "1.0.0" });
  registerReadNotionPageTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    notionService: {
      async readPage() {
        throw new NotionReadError("NOT_FOUND", "PRIVATE_PAGE_DETAIL");
      },
    },
  });
  const pair = await connectServer(server, "read-notion-page-error-client");
  t.after(async () => { await pair.client.close(); await pair.server.close(); });
  const result = await pair.client.callTool({
    name: "read_notion_page",
    arguments: { page_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  });
  const error = errorOf(result);
  assert.deepEqual(error, { code: "NOT_FOUND", message: "The Notion page was not found or is not accessible." });
  assertSecretAbsent(result, "PRIVATE_PAGE_DETAIL");
});

test("advanced Notion reads preserve integration error codes", async (t) => {
  const server = new McpServer({ name: "advanced-notion-error-contract", version: "1.0.0" });
  registerReadNotionDatabaseTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    notionIntegration: {
      async readDatabase() {
        throw new NotionIntegrationError("INVALID_INPUT", "PRIVATE_INTEGRATION_DETAIL");
      },
    },
  });
  const pair = await connectServer(server, "advanced-notion-error-client");
  t.after(async () => { await pair.client.close(); await pair.server.close(); });
  const result = await pair.client.callTool({
    name: "read_notion_database",
    arguments: { database_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  });
  const error = errorOf(result);
  assert.deepEqual(error, { code: "INVALID_INPUT", message: "The Notion read request is invalid." });
  assertSecretAbsent(result, "PRIVATE_INTEGRATION_DETAIL");
});

test("advanced Notion auth failure maps to AUTHENTICATION_REQUIRED before provider access", async (t) => {
  let calls = 0;
  const server = new McpServer({ name: "advanced-notion-auth-contract", version: "1.0.0" });
  registerGetNotionConnectionTool(server, {
    getAuthenticatedUserId: () => { throw new NotionAdvancedAuthenticationError(); },
    notionIntegration: {
      async getConnection() {
        calls += 1;
        throw new Error("provider should not run");
      },
    },
  });
  const pair = await connectServer(server, "advanced-notion-auth-client");
  t.after(async () => { await pair.client.close(); await pair.server.close(); });
  const result = await pair.client.callTool({ name: "get_notion_connection", arguments: {} });
  const error = errorOf(result);
  assert.deepEqual(error, { code: "AUTHENTICATION_REQUIRED", message: "Authentication is required to access Notion." });
  assert.equal(calls, 0);
});

test("advanced Notion unknown failures map to INTERNAL_ERROR without leaking details", async (t) => {
  const server = new McpServer({ name: "advanced-notion-unknown-contract", version: "1.0.0" });
  registerReadNotionDatabaseTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    notionIntegration: {
      async readDatabase() {
        throw new Error("PRIVATE_UNKNOWN_NOTION_DETAIL");
      },
    },
  });
  const pair = await connectServer(server, "advanced-notion-unknown-client");
  t.after(async () => { await pair.client.close(); await pair.server.close(); });
  const result = await pair.client.callTool({
    name: "read_notion_database",
    arguments: { database_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  });
  const error = errorOf(result);
  assert.deepEqual(error, { code: "INTERNAL_ERROR", message: "Notion is temporarily unavailable." });
  assertSecretAbsent(result, "PRIVATE_UNKNOWN_NOTION_DETAIL");
});

test("production registration keeps the six Notion reads and excludes dormant writes", async (t) => {
  const server = createMcpServer({} as never);
  const pair = await connectServer(server, "notion-registration-contract");
  t.after(async () => { await pair.client.close(); await pair.server.close(); });
  const names = new Set((await pair.client.listTools()).tools.map((tool) => tool.name));
  for (const name of [
    "search_notion",
    "read_notion_page",
    "get_notion_connection",
    "read_notion_database",
    "read_notion_data_source",
    "query_notion_data_source",
  ]) assert.equal(names.has(name), true, `${name} should remain registered`);
  for (const name of [
    "write_notion_page",
    "write_notion_block",
    "write_notion_comment",
    "write_notion_data_source",
    "write_notion_database",
    "write_notion_view",
    "create_notion_meeting_note",
    "upload_notion_file",
  ]) assert.equal(names.has(name), false, `${name} must remain dormant`);
});

test("production MCP error audit covers every registered tool", async (t) => {
  const server = createMcpServer({} as never);
  const pair = await connectServer(server, "production-mcp-error-audit-red");
  t.after(async () => { await pair.client.close(); await pair.server.close(); });

  const registered = (await pair.client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(registered, [...EXPECTED_PRODUCTION_MCP_TOOL_NAMES].sort());
  assert.deepEqual(Object.keys(PRODUCTION_MCP_TOOL_ERROR_AUDIT).sort(), registered);
});
