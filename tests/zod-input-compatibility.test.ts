import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

// Zod 4 tightened or changed these. LeileiOS keeps accepting what it accepted
// before: stored and imported ids, model-written times, and omitted arguments.
type ToolSchemas = Record<string, { inputSchema: { safeParse(value: unknown): { success: boolean; data?: any } }; outputSchema?: any }>;
const tools = () => (createMcpServer({}) as unknown as { _registeredTools: ToolSchemas })._registeredTools;
const accepts = (name: string, value: unknown) => tools()[name]!.inputSchema.safeParse(value).success;

test("ids outside RFC 9562 versions and variants stay valid", () => {
  for (const id of ["11111111-1111-1111-1111-111111111111", "11111111-1111-9111-8111-111111111111", "11111111-1111-4111-c111-111111111111", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"]) {
    assert.equal(accepts("get_memory", { id }), true, id);
    assert.equal(accepts("get_diary", { id: ` ${id} ` }), true, id);
  }
  for (const id of ["", "not-a-uuid", "11111111-1111-4111-8111-11111111111", "{11111111-1111-4111-8111-111111111111}"]) {
    assert.equal(accepts("get_memory", { id }), false, id);
  }
});

test("times without seconds or with a compact offset stay valid", () => {
  const write = (occurred_at: unknown) => tools().write_memory!.inputSchema.safeParse({ occurred_at }) as any;
  const rejectsTime = (value: unknown) => (write(value).error?.issues ?? []).some((issue: any) => issue.path[0] === "occurred_at");
  for (const value of ["2026-11-25T17:39+08:00", "2026-11-25T17:39Z", "2026-11-25T17:39:00+0800", "2026-11-25T17:39:00.123+08:00", null]) {
    assert.equal(rejectsTime(value), false, String(value));
  }
  for (const value of ["2026-11-25", "2026-11-25T17:39", "2026-02-29T00:00:00Z", "2026-11-25 17:39:00Z", "", 1]) {
    assert.equal(rejectsTime(value), true, String(value));
  }
});

test("an omitted argument reaches the handler omitted, and its default is only advertised", async () => {
  const registered = tools();
  for (const [name, input, fields] of [
    ["global_search", { query: "q" }, { modules: ["diary", "todo", "universe", "memory"], scope: "active", mode: "normal", limit: 10 }],
    ["list_todo_dates", {}, { limit: 50 }],
    ["search_todo", { query: "q" }, { limit: 50 }],
    ["search_memory", { query: "q" }, { limit: 50 }],
    ["search_diary", { query: "q" }, { limit: 50 }],
    ["list_universe_nodes", {}, { limit: 25 }],
    ["list_diary_comments", { diary_id: "11111111-1111-4111-8111-111111111111" }, { scope: "active", limit: 50 }],
    ["get_diary", { id: "11111111-1111-4111-8111-111111111111" }, { scope: "active", max_chars: 12_000 }],
  ] as const) {
    const parsed = registered[name]!.inputSchema.safeParse(input);
    assert.equal(parsed.success, true, name);
    for (const field of Object.keys(fields)) assert.equal(Object.hasOwn(parsed.data, field), false, `${name}.${field}`);
  }
  const client = new Client({ name: "zod-input-compatibility", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({});
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools: surface } = await client.listTools();
    const memory = surface.find((tool) => tool.name === "get_memory")!.outputSchema as any;
    for (const field of ["lifecycle", "provenance"]) assert.equal(memory.properties.data.required.includes(field), false, field);
    const listed = new Map(surface.map((tool) => [tool.name, tool.inputSchema as any]));
    for (const [name, field, value] of [
      ["global_search", "scope", "active"], ["global_search", "mode", "normal"], ["global_search", "limit", 10],
      ["list_todo_dates", "limit", 50], ["search_todo", "limit", 50], ["search_memory", "limit", 50], ["search_diary", "limit", 50],
      ["list_universe_nodes", "limit", 25], ["list_diary_comments", "limit", 50], ["list_diary_comments", "scope", "active"], ["get_diary", "scope", "active"], ["get_diary", "max_chars", 12_000],
    ] as const) {
      const schema = listed.get(name);
      assert.equal(schema.properties[field].default, value, `${name}.${field}`);
      assert.equal((schema.required ?? []).includes(field), false, `${name}.${field}`);
    }
  } finally {
    await client.close();
    await server.close();
  }
});
