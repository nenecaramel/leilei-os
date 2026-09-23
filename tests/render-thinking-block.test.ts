import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProductionMcpSessionServerFactory } from "../src/mcp/server/production-server-factory.js";
import {
  CHATGPT_RENDER_NOTE_CARD_RESOURCE_URI,
  RENDER_NOTE_CARD_RESOURCE_URI,
  createNoteCardHtml,
} from "../src/mcp/tools/render-thinking-block/resource.js";

function createFactory() {
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

async function connect(server: McpServer, name: string) {
  const client = new Client({ name, version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("note-card resource uses only canonical resource identities", () => {
  assert.equal(RENDER_NOTE_CARD_RESOURCE_URI, "ui://widget/leileios-note-card-v1.html");
  assert.equal(CHATGPT_RENDER_NOTE_CARD_RESOURCE_URI, "ui://widget/leileios-note-card-chatgpt-v1.html");
  const html = createNoteCardHtml();
  assert.match(html, /LeileiOS Note Card/u);
  assert.match(html, /用户可见笔记卡片/u);
  assert.doesNotMatch(html, /leileios-thinking-block|render_thinking_block|render_working_note/iu);
});

test("render_note_card is stateless and does not echo note text into content", async () => {
  const pair = await connect(createFactory()("user-1", "public"), "note-card-call");
  const originalCwd = process.cwd();
  const tempCwd = await mkdtemp(join(tmpdir(), "leileios-note-card-"));
  const note = "NOTE_CARD_CONTENT_7f5f8d";
  try {
    process.chdir(tempCwd);
    const result = await pair.client.callTool({
      name: "render_note_card",
      arguments: { style: "analysis", note, detail: "brief" },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      success: true,
      data: { status: "rendered" },
    });
    assert.deepEqual(result._meta, { style: "analysis", note, detail: "brief" });
    assert.doesNotMatch(JSON.stringify(result.content), new RegExp(note));
    assert.deepEqual(await readdir(tempCwd), []);
  } finally {
    process.chdir(originalCwd);
    await rm(tempCwd, { recursive: true, force: true });
    await pair.client.close();
    await pair.server.close();
  }
});
