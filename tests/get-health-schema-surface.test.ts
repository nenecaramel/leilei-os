import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetHealthTool } from "../src/mcp/tools/get-health/register.js";

const noopHealthService = {
  async readDay(): Promise<null> {
    return null;
  },
  async readRecent(): Promise<never[]> {
    return [];
  },
};

test("get_health exposes mutually exclusive query modes through tools/list", async (t) => {
  const server = new McpServer({ name: "get-health-schema-surface-test", version: "1.0.0" });
  registerGetHealthTool(server, {
    healthService: noopHealthService,
    getAuthenticatedUserId: () => "00000000-0000-4000-8000-000000000099",
  });

  const client = new Client(
    { name: "get-health-schema-surface-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const listed = await client.listTools();
  const tool = listed.tools.find((candidate) => candidate.name === "get_health");
  assert.ok(tool, "get_health should be registered");

  const inputSchema = tool.inputSchema as {
    properties?: Record<string, { description?: string }>;
    required?: string[];
  };
  const properties = inputSchema.properties ?? {};
  assert.ok("date" in properties, `get_health should expose date, got ${JSON.stringify(tool.inputSchema)}`);
  assert.ok("days" in properties, `get_health should expose days, got ${JSON.stringify(tool.inputSchema)}`);
  assert.deepEqual(inputSchema.required ?? [], [], "zero-argument today mode should remain valid");

  const toolDescription = tool.description ?? "";
  assert.match(toolDescription, /one date, a recent day range, or today/i);
  const invalid = await client.callTool({ name: "get_health", arguments: { date: "2026-01-01", days: 1 } });
  assert.equal(invalid.isError, true);
  assert.match(JSON.stringify(invalid), /INVALID_HEALTH_INPUT/);

  assert.match(properties.date?.description ?? "", /mutually exclusive with days/i);
  assert.match(properties.days?.description ?? "", /mutually exclusive with date/i);
});
