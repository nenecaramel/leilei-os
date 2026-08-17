import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { NotionIntegrationError } from "../src/domains/notion/notion-read-integration.js";
import { NotionAdvancedAuthenticationError } from "../src/mcp/tools/notion-advanced/shared.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const DATABASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DATA_SOURCE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

class AdvancedReads {
  calls: Array<{ method: string; input?: unknown }> = [];
  error: Error | undefined;

  async getConnection() {
    this.calls.push({ method: "getConnection" });
    if (this.error) throw this.error;
    return {
      provider: "notion" as const,
      connection: { id: "connection-id", name: "Leilei Bot", type: "bot" as const },
      workspace: { id: "workspace-id", name: "Leilei Workspace" },
      capabilities: ["page.read", "database.read", "data_source.read", "data_source.query"],
    };
  }

  async readDatabase(databaseId: string) {
    this.calls.push({ method: "readDatabase", input: databaseId });
    if (this.error) throw this.error;
    return {
      id: databaseId,
      url: "https://www.notion.so/database",
      title: "Projects",
      created_time: null,
      last_edited_time: null,
      data_sources: [],
      schema: [],
    };
  }

  async readDataSource(dataSourceId: string) {
    this.calls.push({ method: "readDataSource", input: dataSourceId });
    if (this.error) throw this.error;
    return {
      id: dataSourceId,
      url: null,
      title: "Projects source",
      created_time: null,
      last_edited_time: null,
      parent_database_id: DATABASE_ID,
      schema: [],
    };
  }

  async queryDataSource(input: unknown) {
    this.calls.push({ method: "queryDataSource", input });
    if (this.error) throw this.error;
    return {
      data_source_id: DATA_SOURCE_ID,
      results: [],
      metadata: { count: 0, has_more: false, next_cursor: null },
    };
  }
}

async function connect(options: { authenticated?: boolean; reads?: AdvancedReads } = {}) {
  const reads = options.reads ?? new AdvancedReads();
  let authCalls = 0;
  const server = createMcpServer({
    notionRead: {
      notionIntegration: reads,
      getAuthenticatedUserId: () => {
        authCalls += 1;
        if (options.authenticated === false) throw new NotionAdvancedAuthenticationError();
        return USER_ID;
      },
    },
  } as never);
  const client = new Client({ name: "notion-advanced-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, reads, get authCalls() { return authCalls; } };
}

test("advanced Notion read tools are read-only and do not accept identity or secret selectors", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  const listed = await fixture.client.listTools();
  for (const name of ["get_notion_connection", "read_notion_database", "read_notion_data_source", "query_notion_data_source"]) {
    const tool = listed.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be registered`);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
    const properties = tool.inputSchema.properties ?? {};
    assert.equal("user_id" in properties, false);
    assert.equal("userId" in properties, false);
    assert.equal("token" in properties, false);
  }
});

test("advanced Notion reads authenticate and preserve normalized IDs and pagination inputs", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  const connection = await fixture.client.callTool({ name: "get_notion_connection", arguments: {} });
  const database = await fixture.client.callTool({ name: "read_notion_database", arguments: { database_id: DATABASE_ID.replaceAll("-", "").toUpperCase() } });
  const source = await fixture.client.callTool({ name: "read_notion_data_source", arguments: { data_source_id: DATA_SOURCE_ID } });
  const query = await fixture.client.callTool({ name: "query_notion_data_source", arguments: {
    data_source_id: DATA_SOURCE_ID,
    limit: 20,
    cursor: "cursor-1",
    filter: { property: "Done", checkbox: { equals: true } },
    sorts: [{ property: "Name", direction: "ascending" }],
  } });
  assert.equal(connection.isError, undefined);
  assert.equal(database.isError, undefined);
  assert.equal(source.isError, undefined);
  assert.equal(query.isError, undefined);
  assert.equal((query.structuredContent as { data: { metadata: { next_cursor: string | null } } }).data.metadata.next_cursor, null);
  assert.equal(fixture.authCalls, 4);
  assert.deepEqual(fixture.reads.calls, [
    { method: "getConnection" },
    { method: "readDatabase", input: DATABASE_ID.replaceAll("-", "").toUpperCase() },
    { method: "readDataSource", input: DATA_SOURCE_ID },
    { method: "queryDataSource", input: {
      dataSourceId: DATA_SOURCE_ID,
      limit: 20,
      cursor: "cursor-1",
      filter: { property: "Done", checkbox: { equals: true } },
      sorts: [{ property: "Name", direction: "ascending" }],
    } },
  ]);
});

test("advanced Notion reads fail closed before service access without authentication", async (t) => {
  const fixture = await connect({ authenticated: false });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  const result = await fixture.client.callTool({ name: "get_notion_connection", arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(fixture.reads.calls.length, 0);
});

test("advanced Notion errors map without exposing upstream details", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  fixture.reads.error = new NotionIntegrationError("ACCESS_DENIED", "private provider response");
  const denied = await fixture.client.callTool({ name: "read_notion_database", arguments: { database_id: DATABASE_ID } });
  assert.equal(denied.isError, true);
  const text = JSON.stringify(denied);
  assert.equal(text.includes("private provider response"), false);
  assert.match(text, /access|permission|unavailable/i);
});
