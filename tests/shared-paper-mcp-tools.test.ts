import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import type { SharedPaperService } from "../src/domains/shared-paper/shared-paper-service.js";

const id = "00000000-0000-4000-8000-000000000001";
const service = {
  listPapers: async () => [], searchPapers: async () => [], getPaper: async () => null, listEdits: async () => [],
  createPaperIdempotently: async () => ({ paper: { id, title: "Shared", content: "", revision: 1, updatedBy: "L", createdBy: "L", userId: "u", createdAt: new Date(), updatedAt: new Date() }, metadata: { created: true, idempotent_replay: false } }),
  editPaperByMatch: async () => { throw new Error("unused"); },
} as unknown as SharedPaperService;

async function tools() {
  const server = createMcpServer({ sharedPaperTools: { sharedPaperService: service, getAuthenticatedUserId: () => "u" } });
  const client = new Client({ name: "shared-paper-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try { return await client.listTools(); } finally { await client.close(); await server.close(); }
}

test("Shared Paper MCP exposes six strict tools without user_id", async () => {
  const result = await tools();
  const selected = result.tools.filter((tool) => ["list_shared_papers", "search_shared_papers", "get_shared_paper", "create_shared_paper", "edit_shared_paper", "list_shared_paper_edits"].includes(tool.name));
  assert.deepEqual(selected.map((tool) => tool.name).sort(), ["create_shared_paper", "edit_shared_paper", "get_shared_paper", "list_shared_paper_edits", "list_shared_papers", "search_shared_papers"]);
  for (const tool of selected) {
    const schema = tool.inputSchema as { type?: string; properties?: Record<string, unknown> };
    assert.equal(schema.type, "object");
    assert.equal("user_id" in (schema.properties ?? {}), false);
  }
});
