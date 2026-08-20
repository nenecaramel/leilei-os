import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

async function connect() {
  const server = createMcpServer({} as never);
  const client = new Client({ name: "mcp-universe-write-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("registers the three MCP Universe write tools with frozen annotations", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tools = (await fixture.client.listTools()).tools;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  assert.deepEqual(
    ["create_universe_node", "update_universe_node", "create_universe_relation"]
      .map((name) => byName.has(name)),
    [true, true, true],
  );
  assert.deepEqual(byName.get("create_universe_node")?.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.deepEqual(byName.get("update_universe_node")?.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  });
  assert.deepEqual(byName.get("create_universe_relation")?.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
});

test("exposes the strict create Universe node request fields", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tool = (await fixture.client.listTools()).tools.find((candidate) => candidate.name === "create_universe_node");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, [
    "title",
    "summary",
    "content",
    "type",
    "tags",
    "galaxies",
    "position",
    "expected_version",
    "idempotency_key",
  ]);
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [
    "content",
    "expected_version",
    "galaxies",
    "idempotency_key",
    "position",
    "summary",
    "tags",
    "title",
    "type",
  ]);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test("exposes only the partial update Universe node fields", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tool = (await fixture.client.listTools()).tools.find((candidate) => candidate.name === "update_universe_node");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ["id", "expected_version"]);
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [
    "content",
    "expected_version",
    "galaxies",
    "id",
    "position",
    "summary",
    "tags",
    "title",
    "type",
  ]);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test("exposes the strict create Universe relation request fields", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tool = (await fixture.client.listTools()).tools.find((candidate) => candidate.name === "create_universe_relation");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, [
    "source",
    "target",
    "relation_type",
    "strength",
    "expected_version",
    "idempotency_key",
  ]);
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [
    "expected_version",
    "idempotency_key",
    "relation_type",
    "source",
    "strength",
    "target",
  ]);
  assert.equal(tool.inputSchema.additionalProperties, false);
});
