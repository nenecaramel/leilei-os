import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import {
  DEFAULT_PUBLIC_MCP_TOOL_PROFILES,
  parseMcpToolProfiles,
  resolveMcpToolExposure,
} from "../src/mcp/server/tool-profiles.js";

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

test("full keeps legacy aliases with equivalent schemas and explicit deprecation guidance", async () => {
  const tools = await listTools(
    createMcpServer({}, undefined, resolveMcpToolExposure(["full"])),
  );
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  for (const [canonical, legacy] of RENAMES) {
    const canonicalTool = byName.get(canonical);
    const legacyTool = byName.get(legacy);
    assert.ok(canonicalTool, `full must expose canonical tool ${canonical}`);
    assert.ok(legacyTool, `full must retain legacy alias ${legacy}`);
    assert.deepEqual(legacyTool.inputSchema, canonicalTool.inputSchema);
    assert.deepEqual(legacyTool.outputSchema, canonicalTool.outputSchema);
    assert.deepEqual(legacyTool.annotations, canonicalTool.annotations);
    assert.match(legacyTool.description ?? "", /^DEPRECATED:/u);
    assert.match(legacyTool.description ?? "", new RegExp(canonical, "u"));
  }
});

test("legacy_aliases can be explicitly composed for transitional clients", async () => {
  const profiles = parseMcpToolProfiles(
    "core,legacy_aliases",
    DEFAULT_PUBLIC_MCP_TOOL_PROFILES,
  );
  assert.deepEqual(profiles, ["core", "legacy_aliases"]);

  const tools = await listTools(
    createMcpServer({}, undefined, resolveMcpToolExposure(profiles)),
  );
  const names = new Set(tools.map((tool) => tool.name));
  for (const [canonical, legacy] of RENAMES) {
    assert.equal(names.has(canonical), true);
    assert.equal(names.has(legacy), true);
  }
});
