import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetCurrentTimeTool } from "../src/mcp/tools/get-current-time/register.js";
import { assertContentIncludes } from "./helpers/mcp-content-only.js";

async function connect() {
  const server = new McpServer({ name: "current-time-tool-test", version: "1" });
  const authorizationCalls: string[] = [];
  registerGetCurrentTimeTool(server, {
    requireActiveUser: async () => {
      authorizationCalls.push("required");
      return "00000000-0000-4000-8000-000000000513";
    },
    now: () => new Date("2026-09-06T04:33:10.000Z"),
  });
  const client = new Client({ name: "current-time-tool-client", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, authorizationCalls };
}

test("get_current_time exposes a strict empty read-only schema", async (t) => {
  const { client, server } = await connect();
  t.after(async () => { await client.close(); await server.close(); });

  const tool = (await client.listTools()).tools.find((candidate) => candidate.name === "get_current_time");
  assert.ok(tool);
  assert.deepEqual(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.equal(tool.inputSchema.type, "object");
  assert.deepEqual(tool.inputSchema.properties, {});
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test("get_current_time authorizes first and returns fixed Asia/Shanghai time", async (t) => {
  const { client, server, authorizationCalls } = await connect();
  t.after(async () => { await client.close(); await server.close(); });

  const result = await client.callTool({ name: "get_current_time", arguments: {} });

  assert.equal(result.isError, undefined);
  assert.deepEqual(authorizationCalls, ["required"]);
  assertContentIncludes(
    result,
    "2026-09-06",
    "12:33:10",
    "2026-09-06T12:33:10+08:00",
    "Asia/Shanghai",
    "Sunday",
  );
  assert.deepEqual(result.structuredContent, {
    date: "2026-09-06",
    time: "12:33:10",
    datetime: "2026-09-06T12:33:10+08:00",
    timezone: "Asia/Shanghai",
    weekday: "Sunday",
  });
});

test("get_current_time rejects input properties before authorization", async (t) => {
  const { client, server, authorizationCalls } = await connect();
  t.after(async () => { await client.close(); await server.close(); });

  const result = await client.callTool({ name: "get_current_time", arguments: { user_id: "forbidden" } });

  assert.equal(result.isError, true);
  assert.deepEqual(authorizationCalls, []);
});
