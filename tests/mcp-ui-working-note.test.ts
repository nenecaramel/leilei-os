import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProductionMcpSessionServerFactory } from "../src/mcp/server/production-server-factory.js";
import {
  CHATGPT_RENDER_NOTE_CARD_RESOURCE_URI,
  RENDER_NOTE_CARD_RESOURCE_URI,
} from "../src/mcp/tools/render-thinking-block/resource.js";

function factory() {
  return createProductionMcpSessionServerFactory({
    publicToolProfiles: ["ui"],
    activeUserRepository: { findUserById: async () => ({ status: "active" }) },
    diaryService: {} as never,
    toyCommandService: {} as never,
    globalSearchService: {} as never,
    todoService: {} as never,
    universeService: {} as never,
    healthService: {} as never,
  });
}

async function connect(server: McpServer) {
  const client = new Client({ name: "note-card-contract", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("ui profile exposes one neutral note-card tool", async () => {
  const pair = await connect(factory()("user-1", "public"));
  try {
    const tools = (await pair.client.listTools()).tools;
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const tool = byName.get("render_note_card");
    assert.ok(tool);
    assert.equal(byName.has("render_working_note"), false);
    assert.equal(byName.has("render_thinking_block"), false);
    assert.deepEqual(tool.inputSchema.required, ["style", "note", "detail"]);
    assert.deepEqual(tool.inputSchema.properties?.style?.enum, ["plain", "warm"]);
    assert.deepEqual(tool.inputSchema.properties?.detail?.enum, ["brief", "standard", "detailed"]);
    assert.equal(tool._meta?.ui?.resourceUri, RENDER_NOTE_CARD_RESOURCE_URI);
    assert.equal(tool._meta?.["openai/outputTemplate"], CHATGPT_RENDER_NOTE_CARD_RESOURCE_URI);

    const advertised = JSON.stringify({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    });
    assert.doesNotMatch(
      advertised,
      /thinking|chain[- ]of[- ]thought|hidden|private|scratchpad|effort|internal reasoning/iu,
    );
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
});

test("note-card call keeps all rendered text in normal tool output", async () => {
  const pair = await connect(factory()("user-1", "public"));
  try {
    const note = "VISIBLE_NOTE_CARD_7f5f8d";
    const result = await pair.client.callTool({
      name: "render_note_card",
      arguments: { style: "warm", note, detail: "standard" },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      success: true,
      data: { status: "rendered", style: "warm", note, detail: "standard" },
    });
    assert.equal(result._meta, undefined);
    assert.match(JSON.stringify(result.content), new RegExp(note));
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
});
