import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import {
  createMcpToolError,
  mcpToolErrorStructuredContentSchema,
} from "../src/mcp/tools/error-contract.js";
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

test("shared MCP tool error helper emits the strict machine-readable envelope", () => {
  const result = createMcpToolError(
    "INTERNAL_ERROR",
    "Tool is temporarily unavailable.",
  );

  assert.equal(result.isError, true);
  assert.deepEqual(result.content, [
    { type: "text", text: "Tool is temporarily unavailable." },
  ]);
  assert.deepEqual(
    mcpToolErrorStructuredContentSchema.parse(result.structuredContent),
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Tool is temporarily unavailable.",
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
