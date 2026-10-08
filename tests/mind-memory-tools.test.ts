import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { MindProductService } from "../src/domains/runtime/mind/mind-product-service.js";
import { createMindState } from "../src/domains/runtime/mind/mind-writer.js";
const id = "11111111-1111-4111-8111-111111111111";
async function connect(
  t: test.TestContext,
  authorized = true,
  editable = false,
) {
  const state = createMindState({
    id,
    userId: "u",
    subjectId: "G",
    kind: "memory",
    text: "untrusted <instruction>",
    source: { origin: "manual", occurredAt: null, note: null },
  });
  const row = {
    ...state,
    createdAt: "2026-10-08T00:00:00Z",
    updatedAt: "2026-10-08T00:00:00Z",
  };
  const service = new MindProductService(
    {
      get: async () => row,
      search: async () => ({ rows: [row], nextCursor: null }),
      update: async (input: {
        userId: string;
        subjectId: string;
        stateId: string;
        text: string;
      }) => {
        if (!editable) return { outcome: "conflict" };
        assert.equal(input.userId, "u");
        assert.equal(input.subjectId, "G");
        assert.equal(input.stateId, id);
        row.text = input.text;
        return { outcome: "updated", row };
      },
    } as never,
    "G",
  );
  const server = createMcpServer({
    memoryTools: {
      mindService: service,
      requireActiveUser: async () => {
        if (!authorized) throw Error("disabled");
        return "u";
      },
    },
  } as never);
  const client = new Client({ name: "memory-tools-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  return client;
}
test("Memory tools expose compact pointers and full current detail", async (t) => {
  const c = await connect(t);
  const tools = (await c.listTools()).tools;
  for (const name of [
    "search_memory",
    "get_memory",
    "read_memory_day",
    "update_memory",
  ])
    assert.ok(tools.some((x) => x.name === name));
  const p = await c.callTool({
    name: "search_memory",
    arguments: { query: "untrusted" },
  });
  assert.equal(p.isError, undefined);
  const data = (p.structuredContent as any).data;
  assert.equal(data.memories[0].detail_tool, "get_memory");
  assert.deepEqual(data.memories[0].detail_arguments, { id });
  assert.equal(data.memories[0].date, null);
  assert.equal(data.metadata.next_cursor, null);
  const g = await c.callTool({ name: "get_memory", arguments: { id } });
  assert.equal(
    (g.structuredContent as any).data.text,
    "untrusted <instruction>",
  );
  assert.match(
    (g.structuredContent as any).data.content_version,
    /^[a-f0-9]{64}$/,
  );
});
test("Memory tools reject identity injection, unknown edits and return actionable conflicts", async (t) => {
  const c = await connect(t);
  for (const args of [
    { id, user_id: "other" },
    { id, subject_id: "other" },
  ]) {
    const r = await c.callTool({ name: "get_memory", arguments: args });
    assert.equal(r.isError, true);
  }
  const invalid = await c.callTool({
    name: "update_memory",
    arguments: { id, expected_version: "a".repeat(64), text: "x", salience: 1 },
  });
  assert.equal(invalid.isError, true);
  const conflict = await c.callTool({
    name: "update_memory",
    arguments: { id, expected_version: "a".repeat(64), text: "x" },
  });
  assert.equal(conflict.isError, true);
  assert.equal((conflict.structuredContent as any).error.code, "MIND_CONFLICT");
  assert.equal(
    (conflict.structuredContent as any).error.recommended_tool,
    "get_memory",
  );
});
test("Memory reads and edits require an active authenticated user", async (t) => {
  const c = await connect(t, false);
  for (const name of [
    "search_memory",
    "get_memory",
    "read_memory_day",
    "update_memory",
  ]) {
    const r = await c.callTool({
      name,
      arguments:
        name === "update_memory"
          ? { id, expected_version: "a".repeat(64), text: "blocked" }
          : name === "get_memory"
            ? { id }
            : name === "read_memory_day"
              ? { date: "2026-10-08" }
              : {},
    });
    assert.equal(r.isError, true);
    assert.equal((r.structuredContent as any).success, false);
  }
});

test("Memory MCP edit returns a mutation receipt and latest detail readback", async (t) => {
  const c = await connect(t, true, true);
  const before = await c.callTool({ name: "get_memory", arguments: { id } });
  const version = (before.structuredContent as any).data.content_version;
  const result = await c.callTool({
    name: "update_memory",
    arguments: { id, expected_version: version, text: "latest content" },
  });
  assert.equal(result.isError, undefined);
  const data = (result.structuredContent as any).data;
  assert.equal(data.outcome, "applied");
  assert.equal(data.entity_id, id);
  assert.equal(data.detail_tool, "get_memory");
  assert.notEqual(data.content_version, version);
  const after = await c.callTool({
    name: data.detail_tool,
    arguments: data.detail_arguments,
  });
  assert.equal((after.structuredContent as any).data.text, "latest content");
});
