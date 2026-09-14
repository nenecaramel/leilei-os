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
  archivedAt: null,
};
const edit: SharedPaperEdit = {
  id: "00000000-0000-4000-8000-000000000002",
  paperId: id,
  userId: "u",
  baseRevision: 1,
  revision: 2,
  author: "G",
  target: "content",
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
    archivePaperIdempotently: async () => ({ paper: { ...paper, archivedAt: new Date("2026-01-02T00:00:00.000Z") }, outcome: "committed" }),
    restorePaperIdempotently: async () => ({ paper, outcome: "committed" }),
    deletePaperIdempotently: async () => ({ paperId: id, outcome: "committed" }),
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

test("Shared Paper MCP exposes nine strict tools without user_id", async () => {
  const fixture = await connect();
  const result = await fixture.client.listTools();
  await fixture.client.close(); await fixture.server.close();
  const selected = result.tools.filter((tool) => ["list_shared_papers", "search_shared_papers", "get_shared_paper", "create_shared_paper", "edit_shared_paper", "list_shared_paper_edits", "archive_shared_paper", "restore_shared_paper", "delete_shared_paper"].includes(tool.name));
  assert.deepEqual(selected.map((tool) => tool.name).sort(), ["archive_shared_paper", "create_shared_paper", "delete_shared_paper", "edit_shared_paper", "get_shared_paper", "list_shared_paper_edits", "list_shared_papers", "restore_shared_paper", "search_shared_papers"]);
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
  assert.equal((byName.get("list_shared_papers")?.inputSchema.properties?.scope as { default?: string }).default, "active");
  assert.equal((byName.get("search_shared_papers")?.inputSchema.properties?.scope as { default?: string }).default, "active");
  assert.equal((byName.get("create_shared_paper")?.inputSchema.properties?.title as { maxLength?: number }).maxLength, 400);
  assert.equal((byName.get("create_shared_paper")?.inputSchema.properties?.content as { maxLength?: number }).maxLength, 200_000);
  assert.equal((byName.get("search_shared_papers")?.inputSchema.properties?.query as { maxLength?: number }).maxLength, 400);
  assert.equal((byName.get("edit_shared_paper")?.inputSchema.properties?.match_text as { maxLength?: number }).maxLength, 200_000);
  assert.equal((byName.get("edit_shared_paper")?.inputSchema.properties?.replacement_text as { maxLength?: number }).maxLength, 200_000);
  assert.equal((byName.get("edit_shared_paper")?.inputSchema.properties?.target as { default?: string }).default, "content");

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
  const validTitleEdit = await fixture.client.callTool({
    name: "edit_shared_paper",
    arguments: { id, expected_revision: 1, author: "C", target: "title", match_text: "Shared", replacement_text: "Renamed", idempotency_key: "shared.paper:title-0001" },
  });
  assert.equal(validTitleEdit.isError, undefined);
  assert.equal(calls.find((call) => call.name === "edit_shared_paper" && call.arguments.target === "title")?.arguments.target, "title");

  const invalidTitle = await fixture.client.callTool({ name: "create_shared_paper", arguments: { title: "😀".repeat(201), content: "ok", author: "L", idempotency_key: "shared.paper:emoji-0004" } });
  const invalidQuery = await fixture.client.callTool({ name: "search_shared_papers", arguments: { query: "😀".repeat(201) } });
  const invalidEdit = await fixture.client.callTool({ name: "edit_shared_paper", arguments: { id, expected_revision: 1, author: "G", match_text: "😀".repeat(100_001), replacement_text: "x", idempotency_key: "shared.paper:emoji-0005" } });
  assert.equal(invalidTitle.isError, true);
  assert.equal(invalidQuery.isError, true);
  assert.equal(invalidEdit.isError, true);
  assert.equal(calls.length, 5);
});

test("Shared Paper detail text exposes revision and authors before canonical content", async (t) => {
  const detailedPaper: SharedPaperRecord = {
    ...paper,
    title: "我们一起写的第一张纸",
    content: "canonical content 😀\nwith a second line",
    revision: 3,
    updatedBy: "C",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  };
  const fixture = await connect(makeService({ getPaper: async () => detailedPaper }));
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({ name: "get_shared_paper", arguments: { id } });
  const text = String(result.content?.[0]?.text);

  assert.match(text, /id=00000000-0000-4000-8000-000000000001/);
  assert.match(text, /revision=3/);
  assert.match(text, /created_by=L/);
  assert.match(text, /updated_by=C/);
  assert.match(text, /created_at=2026-01-01T00:00:00\.000Z/);
  assert.match(text, /updated_at=2026-01-03T00:00:00\.000Z/);
  assert.ok(text.indexOf("revision=3") < text.indexOf(detailedPaper.content));
  assert.ok(text.includes(detailedPaper.content));
  assert.deepEqual((result.structuredContent as any).data.paper, {
    id: detailedPaper.id,
    title: detailedPaper.title,
    content: detailedPaper.content,
    revision: detailedPaper.revision,
    created_by: detailedPaper.createdBy,
    updated_by: detailedPaper.updatedBy,
    created_at: detailedPaper.createdAt.toISOString(),
    updated_at: detailedPaper.updatedAt.toISOString(),
    archived_at: null,
  });
});

test("Shared Paper edit history text exposes ordered author and revision summaries", async (t) => {
  const edits: SharedPaperEdit[] = [
    { ...edit, id: "00000000-0000-4000-8000-000000000003", author: "C", baseRevision: 2, revision: 3, deletedText: "updated", insertedText: "final", createdAt: new Date("2026-01-03T00:00:00.000Z") },
    edit,
  ];
  const fixture = await connect(makeService({ listEdits: async () => edits }));
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({ name: "list_shared_paper_edits", arguments: { id } });
  const text = String(result.content?.[0]?.text);

  assert.match(text, /2 shared paper edits\./);
  assert.match(text, /edit=00000000-0000-4000-8000-000000000003/);
  assert.match(text, /author=C/);
  assert.match(text, /target=content/);
  assert.match(text, /revision=2->3/);
  assert.match(text, /author=G/);
  assert.match(text, /revision=1->2/);
  assert.match(text, /created_at=2026-01-03T00:00:00\.000Z/);
  assert.match(text, /deleted=/);
  assert.match(text, /inserted=/);
  assert.ok(text.indexOf("revision=2->3") < text.indexOf("revision=1->2"));
  assert.deepEqual((result.structuredContent as any).data.edits, edits.map((value) => ({
    id: value.id,
    paper_id: value.paperId,
    base_revision: value.baseRevision,
    revision: value.revision,
    author: value.author,
    target: value.target,
    start_offset: value.startOffset,
    end_offset: value.endOffset,
    deleted_text: value.deletedText,
    inserted_text: value.insertedText,
    created_at: value.createdAt.toISOString(),
  })));
});

test("Shared Paper edit history text is Unicode-safe and bounded", async (t) => {
  const edits: SharedPaperEdit[] = Array.from({ length: 100 }, (_, index) => ({
    ...edit,
    id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    baseRevision: index + 1,
    revision: index + 2,
    deletedText: "😀".repeat(500),
    insertedText: "👩‍💻".repeat(500),
    createdAt: new Date(2026, 0, 1, 0, 0, index),
  }));
  const fixture = await connect(makeService({ listEdits: async () => edits }));
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({ name: "list_shared_paper_edits", arguments: { id, limit: 100 } });
  const text = String(result.content?.[0]?.text);

  assert.match(text, /Showing 5 of 100 returned edits; structuredContent contains all returned edits\./);
  assert.ok(text.length < 8_000);
  const deletedLine = text.split("\n").find((line) => line.startsWith("deleted="));
  const insertedLine = text.split("\n").find((line) => line.startsWith("inserted="));
  assert.ok(deletedLine);
  assert.ok(insertedLine);
  const deletedPreview = JSON.parse(deletedLine.slice("deleted=".length)) as string;
  const insertedPreview = JSON.parse(insertedLine.slice("inserted=".length)) as string;
  assert.ok(Array.from(deletedPreview).length <= 200);
  assert.ok(Array.from(insertedPreview).length <= 200);
  assert.ok(deletedPreview.endsWith("…"));
  assert.ok(insertedPreview.endsWith("…"));
  assert.equal((result.structuredContent as any).data.edits.length, 100);
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


test("Shared Paper MCP defaults discovery scope to active and accepts archived scope", async (t) => {
  const received: Array<Record<string, unknown>> = [];
  const fixture = await connect(makeService({
    listPapers: async (input) => { received.push(input as unknown as Record<string, unknown>); return []; },
    searchPapers: async (input) => { received.push(input as unknown as Record<string, unknown>); return []; },
  }));
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  await fixture.client.callTool({ name: "list_shared_papers", arguments: {} });
  await fixture.client.callTool({ name: "search_shared_papers", arguments: { query: "shared", scope: "archived" } });
  assert.equal(received[0]?.scope, "active");
  assert.equal(received[1]?.scope, "archived");
});

test("Shared Paper MCP lifecycle tools return authoritative state and idempotent receipts", async (t) => {
  let archiveCalls = 0;
  let restoreCalls = 0;
  let deleteCalls = 0;
  const archived = { ...paper, archivedAt: new Date("2026-01-02T00:00:00.000Z") };
  const fixture = await connect(makeService({
    archivePaperIdempotently: async () => ({ paper: archived, outcome: archiveCalls++ === 0 ? "committed" : "replayed" }),
    restorePaperIdempotently: async () => ({ paper, outcome: restoreCalls++ === 0 ? "committed" : "replayed" }),
    deletePaperIdempotently: async () => ({ paperId: id, outcome: deleteCalls++ === 0 ? "committed" : "replayed" }),
  }));
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const archivedResult = await fixture.client.callTool({ name: "archive_shared_paper", arguments: { id, idempotency_key: "shared.paper:archive-0001" } });
  const archivedData = (archivedResult.structuredContent as any).data;
  assert.equal(archivedData.paper_id, id);
  assert.equal(archivedData.archived_at, "2026-01-02T00:00:00.000Z");
  assert.equal(archivedData.metadata.idempotent_replay, false);
  assert.deepEqual(archivedData.detail_arguments, { id });

  const restoredResult = await fixture.client.callTool({ name: "restore_shared_paper", arguments: { id, idempotency_key: "shared.paper:restore-0001" } });
  assert.equal((restoredResult.structuredContent as any).data.archived_at, null);

  const deletedResult = await fixture.client.callTool({ name: "delete_shared_paper", arguments: { id, idempotency_key: "shared.paper:delete-0001" } });
  const deletedReplay = await fixture.client.callTool({ name: "delete_shared_paper", arguments: { id, idempotency_key: "shared.paper:delete-0001" } });
  assert.equal((deletedResult.structuredContent as any).data.deleted, true);
  assert.equal((deletedReplay.structuredContent as any).data.metadata.idempotent_replay, true);
  assert.equal((deletedReplay.structuredContent as any).data.paper_id, id);
  assert.match(String(deletedReplay.content?.[0]?.text), /replayed/);
});
