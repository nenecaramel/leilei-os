import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import type { SharedPaperEdit, SharedPaperRecord } from "../src/domains/shared-paper/shared-paper-types.js";
import type { SharedPaperToolService } from "../src/mcp/tools/shared-paper/register.js";

const id = "00000000-0000-4000-8000-000000000001";
const paper: SharedPaperRecord = {
  id,
  title: "Shared",
  content: "canonical",
  revision: 1,
  updatedBy: "L",
  createdBy: "L",
  userId: "u",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const edit: SharedPaperEdit = {
  id: "00000000-0000-4000-8000-000000000002",
  paperId: id,
  userId: "u",
  baseRevision: 1,
  revision: 2,
  author: "G",
  startOffset: 0,
  endOffset: 9,
  deletedText: "canonical",
  insertedText: "updated",
  createdAt: new Date("2026-01-01T00:00:01.000Z"),
};

function makeService(overrides: Partial<SharedPaperToolService> = {}): SharedPaperToolService {
  return {
    listPapers: async () => [],
    searchPapers: async () => [],
    getPaper: async () => paper,
    listEdits: async () => [],
    createPaperIdempotently: async () => ({ paper, outcome: "committed" }),
    editPaperByMatch: async () => ({ paper, edit, outcome: "committed" }),
    ...overrides,
  };
}

async function connect(sharedPaperService: SharedPaperToolService = makeService()) {
  const server = createMcpServer({ sharedPaperTools: { sharedPaperService, getAuthenticatedUserId: () => "u" } });
  const client = new Client({ name: "shared-paper-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, server };
}

test("Shared Paper MCP exposes six strict tools without user_id", async () => {
  const fixture = await connect();
  const result = await fixture.client.listTools();
  await fixture.client.close(); await fixture.server.close();
  const selected = result.tools.filter((tool) => ["list_shared_papers", "search_shared_papers", "get_shared_paper", "create_shared_paper", "edit_shared_paper", "list_shared_paper_edits"].includes(tool.name));
  assert.deepEqual(selected.map((tool) => tool.name).sort(), ["create_shared_paper", "edit_shared_paper", "get_shared_paper", "list_shared_paper_edits", "list_shared_papers", "search_shared_papers"]);
  for (const tool of selected) {
    const schema = tool.inputSchema as { type?: string; properties?: Record<string, unknown> };
    assert.equal(schema.type, "object");
    assert.equal("user_id" in (schema.properties ?? {}), false);
  }
});

test("Shared Paper MCP schemas enforce Unicode code-point bounds with host-visible limits", async (t) => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const fixture = await connect(makeService({
    createPaperIdempotently: async (input) => {
      calls.push({ name: "create_shared_paper", arguments: input as unknown as Record<string, unknown> });
      return { paper, outcome: "committed" };
    },
    searchPapers: async (input) => {
      calls.push({ name: "search_shared_papers", arguments: input as unknown as Record<string, unknown> });
      return [];
    },
    editPaperByMatch: async (input) => {
      calls.push({ name: "edit_shared_paper", arguments: input as unknown as Record<string, unknown> });
      return { paper, edit, outcome: "committed" };
    },
  }));
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const listed = await fixture.client.listTools();
  const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
  assert.equal((byName.get("create_shared_paper")?.inputSchema.properties?.title as { maxLength?: number }).maxLength, 400);
  assert.equal((byName.get("create_shared_paper")?.inputSchema.properties?.content as { maxLength?: number }).maxLength, 200_000);
  assert.equal((byName.get("search_shared_papers")?.inputSchema.properties?.query as { maxLength?: number }).maxLength, 400);
  assert.equal((byName.get("edit_shared_paper")?.inputSchema.properties?.match_text as { maxLength?: number }).maxLength, 200_000);
  assert.equal((byName.get("edit_shared_paper")?.inputSchema.properties?.replacement_text as { maxLength?: number }).maxLength, 200_000);

  const validTitle = await fixture.client.callTool({
    name: "create_shared_paper",
    arguments: { title: "😀".repeat(200), content: "ok", author: "L", idempotency_key: "shared.paper:emoji-0001" },
  });
  assert.equal(validTitle.isError, undefined);
  const validContent = await fixture.client.callTool({
    name: "create_shared_paper",
    arguments: { title: "ok", content: "😀".repeat(100_000), author: "L", idempotency_key: "shared.paper:emoji-0002" },
  });
  assert.equal(validContent.isError, undefined);
  const validQuery = await fixture.client.callTool({ name: "search_shared_papers", arguments: { query: "😀".repeat(200) } });
  assert.equal(validQuery.isError, undefined);
  const validEdit = await fixture.client.callTool({
    name: "edit_shared_paper",
    arguments: { id, expected_revision: 1, author: "G", match_text: "😀".repeat(100_000), replacement_text: "😀".repeat(100_000), idempotency_key: "shared.paper:emoji-0003" },
  });
  assert.equal(validEdit.isError, undefined);

  const invalidTitle = await fixture.client.callTool({ name: "create_shared_paper", arguments: { title: "😀".repeat(201), content: "ok", author: "L", idempotency_key: "shared.paper:emoji-0004" } });
  const invalidQuery = await fixture.client.callTool({ name: "search_shared_papers", arguments: { query: "😀".repeat(201) } });
  const invalidEdit = await fixture.client.callTool({ name: "edit_shared_paper", arguments: { id, expected_revision: 1, author: "G", match_text: "😀".repeat(100_001), replacement_text: "x", idempotency_key: "shared.paper:emoji-0005" } });
  assert.equal(invalidTitle.isError, true);
  assert.equal(invalidQuery.isError, true);
  assert.equal(invalidEdit.isError, true);
  assert.equal(calls.length, 4);
});

test("Shared Paper MCP mutation receipts distinguish fresh commits from idempotent replays", async (t) => {
  let createCount = 0;
  let editCount = 0;
  let currentPaper = paper;
  const fixture = await connect(makeService({
    createPaperIdempotently: async () => ({ paper, outcome: createCount++ === 0 ? "committed" : "replayed" }),
    editPaperByMatch: async () => ({ paper: currentPaper, edit, outcome: editCount++ === 0 ? "committed" : "replayed" }),
    getPaper: async () => currentPaper,
  }));
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const createArgs = { title: "Shared", content: "canonical", author: "L", idempotency_key: "shared.paper:receipt-0001" };
  const created = await fixture.client.callTool({ name: "create_shared_paper", arguments: createArgs });
  const createdReplay = await fixture.client.callTool({ name: "create_shared_paper", arguments: createArgs });
  assert.equal((created.structuredContent as any).data.metadata.idempotent_replay, false);
  assert.equal((createdReplay.structuredContent as any).data.metadata.idempotent_replay, true);
  assert.match(String(created.content?.[0]?.text), /committed/);
  assert.match(String(createdReplay.content?.[0]?.text), /replayed/);

  const editArgs = { id, expected_revision: 1, author: "G", match_text: "canonical", replacement_text: "updated", idempotency_key: "shared.paper:receipt-0002" };
  const edited = await fixture.client.callTool({ name: "edit_shared_paper", arguments: editArgs });
  currentPaper = { ...paper, revision: 5, content: "later canonical" };
  const editReplay = await fixture.client.callTool({ name: "edit_shared_paper", arguments: editArgs });
  const editReplayData = (editReplay.structuredContent as any).data;
  assert.equal(editReplayData.metadata.idempotent_replay, true);
  assert.equal(editReplayData.edit_id, edited.structuredContent && (edited.structuredContent as any).data.edit_id);
  assert.equal(editReplayData.base_revision, 1);
  assert.equal(editReplayData.revision, 2);
  assert.deepEqual(editReplayData.detail_arguments, { id });
  assert.match(String(editReplay.content?.[0]?.text), /replayed/);
  const current = await fixture.client.callTool({ name: "get_shared_paper", arguments: editReplayData.detail_arguments });
  assert.equal((current.structuredContent as any).data.paper.content, "later canonical");
});

test("Shared Paper MCP edit history exposes a stable before_revision continuation", async (t) => {
  let received: Record<string, unknown> | undefined;
  const fixture = await connect(makeService({
    listEdits: async (input) => { received = input as unknown as Record<string, unknown>; return []; },
  }));
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  const listed = await fixture.client.listTools();
  const tool = listed.tools.find((candidate) => candidate.name === "list_shared_paper_edits");
  assert.equal((tool?.inputSchema.properties?.before_revision as { type?: string }).type, "integer");
  const result = await fixture.client.callTool({ name: "list_shared_paper_edits", arguments: { id, before_revision: 3, limit: 2 } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(received, { userId: "u", paperId: id, limit: 2, beforeRevision: 3 });
});
