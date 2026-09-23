import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProductionMcpSessionServerFactory } from "../src/mcp/server/production-server-factory.js";
import {
  CHATGPT_RENDER_WORKING_NOTE_RESOURCE_URI,
  RENDER_WORKING_NOTE_RESOURCE_URI,
} from "../src/mcp/tools/render-thinking-block/resource.js";

function factory(publicToolProfiles: readonly ("ui" | "legacy_aliases")[]) {
  return createProductionMcpSessionServerFactory({
    activeUserRepository: { findUserById: async () => ({ status: "active" }) },
    memoryService: {} as never,
    diaryService: {} as never,
    taskService: {} as never,
    toyCommandService: {} as never,
    globalSearchService: {} as never,
    todoService: {} as never,
    universeService: {} as never,
    healthService: {} as never,
    bridgeService: {} as never,
    publicToolProfiles,
  });
}

async function listTools(server: McpServer) {
  const client = new Client({ name: "working-note-contract", version: "1" }, { capabilities: {} });
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

test("ui profile exposes one user-visible working-note tool without thinking semantics", async () => {
  const tools = await listTools(factory(["ui"])("user-1", "public"));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const tool = byName.get("render_working_note");
  assert.ok(tool);
  assert.equal(byName.has("render_thinking_block"), false);
  assert.deepEqual(tool.inputSchema.required, ["style", "note", "detail"]);
  assert.deepEqual(tool.inputSchema.properties?.style?.enum, ["analysis", "relational"]);
  assert.deepEqual(tool.inputSchema.properties?.detail?.enum, ["brief", "standard", "detailed"]);
  assert.equal(tool.inputSchema.properties?.thinking, undefined);
  assert.equal(tool.inputSchema.properties?.effort, undefined);
  assert.match(String(tool.description), /user-visible|用户可见/iu);
  assert.match(String(tool.description), /not.*hidden.*reason|不是.*隐藏.*推理/iu);
  assert.match(String(tool.inputSchema.properties?.note?.description), /结论|依据|假设|下一步/iu);
  assert.match(String(tool.inputSchema.properties?.note?.description), /not.*chain-of-thought|不要.*chain-of-thought|不.*隐藏推理/iu);
  assert.equal(tool._meta?.ui?.resourceUri, RENDER_WORKING_NOTE_RESOURCE_URI);
  assert.equal(tool._meta?.["openai/outputTemplate"], CHATGPT_RENDER_WORKING_NOTE_RESOURCE_URI);
});

test("legacy thinking alias requires explicit legacy_aliases composition", async () => {
  const tools = await listTools(factory(["ui", "legacy_aliases"])("user-1", "public"));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const canonical = byName.get("render_working_note");
  const legacy = byName.get("render_thinking_block");
  assert.ok(canonical);
  assert.ok(legacy);
  assert.match(legacy.description ?? "", /^DEPRECATED:/u);
  assert.match(legacy.description ?? "", /render_working_note/u);
  assert.deepEqual(legacy.inputSchema.required, ["style", "thinking", "effort"]);
  assert.deepEqual(legacy.inputSchema.properties?.style?.enum, ["deep_think", "relational"]);
  assert.deepEqual(legacy.inputSchema.properties?.effort?.enum, ["low", "medium", "high"]);
  assert.equal(legacy.inputSchema.properties?.note, undefined);
  assert.equal(legacy.inputSchema.properties?.detail, undefined);
});

test("working note call returns display metadata without echoing note into tool content", async () => {
  const server = factory(["ui"])("user-1", "public");
  const client = new Client({ name: "working-note-call", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const note = "VISIBLE_WORKING_NOTE_7f5f8d";
    const result = await client.callTool({
      name: "render_working_note",
      arguments: { style: "analysis", note, detail: "standard" },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      success: true,
      data: { status: "rendered" },
    });
    assert.deepEqual(result._meta, { style: "analysis", note, detail: "standard" });
    assert.doesNotMatch(JSON.stringify(result.content), new RegExp(note));
  } finally {
    await client.close();
    await server.close();
  }
});
