import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { resolveMcpToolExposure } from "../src/mcp/server/tool-profiles.js";

type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

async function listTools(server: McpServer): Promise<ListedTool[]> {
  const client = new Client(
    { name: "naming-deprecation-acceptance", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

const RENAMES = [
  ["create_diary", "write_diary"],
  ["replace_todo_paper", "write_todo_paper"],
] as const;

test("core exposes canonical names and hides deprecated aliases", async () => {
  const tools = await listTools(
    createMcpServer({}, undefined, resolveMcpToolExposure(["core"])),
  );
  const names = new Set(tools.map((tool) => tool.name));

  for (const [canonical, legacy] of RENAMES) {
    assert.equal(names.has(canonical), true, `core must expose ${canonical}`);
    assert.equal(names.has(legacy), false, `core must hide deprecated alias ${legacy}`);
  }
});

test("full permanently omits retired aliases", async () => {
  const tools = await listTools(
    createMcpServer({}, undefined, resolveMcpToolExposure(["full"])),
  );
  const names = new Set(tools.map((tool) => tool.name));

  for (const [canonical, legacy] of RENAMES) {
    assert.equal(names.has(canonical), true, `full must expose canonical tool ${canonical}`);
    assert.equal(names.has(legacy), false, `full must not revive retired alias ${legacy}`);
  }
  assert.equal(names.has("render_thinking_block"), false);
  assert.equal(names.has("render_working_note"), false);
});
