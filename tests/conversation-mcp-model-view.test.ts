import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import type {
  ConversationArchiveSearchResult,
  ConversationModelView,
} from "../src/domains/conversation/conversation-archive-read-service.js";

const USER_ID = "00000000-0000-4000-8000-000000000901";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000902";
const MESSAGE_ID = "00000000-0000-4000-8000-000000000903";
const EXCLUSION_ID = "00000000-0000-4000-8000-000000000904";
const SOURCE_ID = "00000000-0000-4000-8000-000000000905";

class ConversationReads {
  listCalls: Array<Record<string, unknown>> = [];
  searchCalls: Array<Record<string, unknown>> = [];
  readCalls: Array<Record<string, unknown>> = [];
  nextOffset: number | null = null;

  async search(input: Record<string, unknown>): Promise<{
    items: ConversationArchiveSearchResult[];
    total: number;
  }> {
    this.searchCalls.push(input);
    return {
      total: 1,
      items: [{
        messageId: MESSAGE_ID,
        conversationId: CONVERSATION_ID,
        provider: "chatgpt",
        conversationTitle: "Canonical archive",
        sourceNodeId: "node-saved",
        role: "assistant",
        model: "gpt-5.6",
        sourceCreatedAt: "2026-09-16T12:00:00.000Z",
        isCurrentPath: false,
        snippet: "needle in the canonical saved branch",
      }],
    };
  }

  async list(input: Record<string, unknown>) {
    this.listCalls.push(input);
    return {
      total: 1,
      items: [{
        id: CONVERSATION_ID, provider: "chatgpt" as const, sourceConversationId: "provider-conversation",
        title: "Canonical archive", sourceCreatedAt: "2026-09-16T11:00:00.000Z", sourceUpdatedAt: "2026-09-16T12:30:00.000Z",
        defaultModel: "gpt-5.6", currentLeafSourceNodeId: "current-leaf", messageCount: 1, turnCount: 0, totalNodeCount: 2,
        archivedAt: null, deletedAt: null,
      }],
    };
  }

  async modelView(input: Record<string, unknown>): Promise<ConversationModelView> {
    this.readCalls.push(input);
    return {
      conversation: {
        id: CONVERSATION_ID,
        provider: "chatgpt",
        sourceConversationId: "provider-conversation",
        title: "Canonical archive",
        sourceCreatedAt: "2026-09-16T11:00:00.000Z",
        sourceUpdatedAt: "2026-09-16T12:30:00.000Z",
        defaultModel: "gpt-5.6",
        currentLeafSourceNodeId: "current-leaf",
        messageCount: 1,
        turnCount: 0,
        totalNodeCount: 2,
        providerMetadata: { source: "canonical" },
      },
      representation: "canonical_model_view",
      view: "all",
      pathBasis: "branch_inclusive",
      items: [{
        id: MESSAGE_ID,
        sourceNodeId: "node-saved",
        sourceMessageId: "source-message",
        parentSourceNodeId: "node-parent",
        role: "assistant",
        rawRole: "assistant",
        model: "gpt-5.6",
        sourceCreatedAt: "2026-09-16T12:00:00.000Z",
        sourceUpdatedAt: null,
        isCurrentPath: false,
        currentPathIndex: null,
        turnIndex: 0,
        isPrimary: true,
        displayText: "needle in the canonical saved branch",
        contentBlocks: [
          {
            ordinal: 0,
            kind: "thinking",
            rawType: "thinking",
            text: "private-ish provider thinking preserved in canonical storage",
            payload: { provider_key: "value" },
          },
          {
            ordinal: 1,
            kind: "text",
            rawType: "text",
            text: "needle in the canonical saved branch",
            payload: null,
          },
        ],
        attachments: [{
          ordinal: 0,
          sourceAttachmentId: "file-1",
          name: "note.txt",
          mimeType: "text/plain",
          sizeBytes: 12,
          payload: { kind: "file" },
        }],
      }],
      total: 1,
      offset: 0,
      anchorIndex: 0,
      hasMore: this.nextOffset !== null,
      nextOffset: this.nextOffset,
    };
  }
}

class ConversationPruning {
  calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  async listDeletedBranches(input: Record<string, unknown>) { this.calls.push({ name: "list", input }); return { total: 0, items: [] }; }
  async archiveConversation(input: Record<string, unknown>) { this.calls.push({ name: "archive", input }); return { archived: true as const }; }
  async deleteConversation(input: Record<string, unknown>) { this.calls.push({ name: "deleteConversation", input }); return { provider: "chatgpt" as const, sourceConversationId: "provider", deletedMessages: 1, rawSourcePreserved: true as const }; }
  async deleteBranch(input: Record<string, unknown>) { this.calls.push({ name: "deleteBranch", input }); return { provider: "chatgpt" as const, sourceConversationId: "provider", sourceNodeId: "node", deletedMessages: 1, remainingMessages: 1, currentLeafSourceNodeId: "leaf", rawSourcePreserved: true as const }; }
  async restoreConversation(input: Record<string, unknown>) { this.calls.push({ name: "restoreArchived", input }); return { restored: true as const }; }
  async restoreDeletedConversation(input: Record<string, unknown>) { this.calls.push({ name: "restoreDeleted", input }); return { restored: true as const }; }
  async restoreBranch(input: Record<string, unknown>) { this.calls.push({ name: "restoreBranch", input }); return { restored: true as const }; }
  async permanentlyDeleteConversation(input: Record<string, unknown>) { this.calls.push({ name: "permanentConversation", input }); return { deleted: true as const, rawSourcePreserved: true as const }; }
  async permanentlyDeleteBranch(input: Record<string, unknown>) { this.calls.push({ name: "permanentBranch", input }); return { deleted: true as const, rawSourcePreserved: true as const }; }
}


class RecoveryReads {
  listCalls: Array<Record<string, unknown>> = [];
  candidateCalls: Array<Record<string, unknown>> = [];
  evidenceCalls: Array<Record<string, unknown>> = [];
  restoreCalls: Array<Record<string, unknown>> = [];

  async list(input: Record<string, unknown>) {
    this.listCalls.push(input);
    return {
      total: 1,
      items: [{
        id: EXCLUSION_ID,
        provider: "claude" as const,
        scope: "branch" as const,
        sourceConversationId: "source-conversation",
        sourceNodeId: "source-node",
        canonicalConversationExists: true,
        canonicalNodeExists: false,
        title: "Deleted branch",
        sourceCreatedAt: "2026-09-12T00:00:00.000Z",
        rootRole: null,
        rootSnippet: null,
        createdAt: "2026-09-18T00:00:00.000Z",
      }],
    };
  }

  async restoreCandidates(input: Record<string, unknown>) {
    this.candidateCalls.push(input);
    return {
      total: 1,
      items: [{
        sourceId: SOURCE_ID,
        filename: "claude-export.json",
        title: "Deleted branch",
        rootRole: "user" as const,
        rootSourceCreatedAt: "2026-09-12T00:01:00.000Z",
        rootSnippet: "verified retained root",
      }],
    };
  }

  async restoreEvidence(input: Record<string, unknown>) {
    this.evidenceCalls.push(input);
    return {
      sourceId: SOURCE_ID,
      filename: "claude-export.json",
      title: "Deleted branch",
      rootSourceNodeId: "source-node",
      total: 3,
      offset: Number(input.offset ?? 0),
      messages: [
        {
          sourceNodeId: "source-node",
          parentSourceNodeId: "before-root",
          role: "user" as const,
          sourceCreatedAt: "2026-09-12T00:01:00.000Z",
          displayText: "verified retained root",
          depth: 0,
        },
        {
          sourceNodeId: "child-1",
          parentSourceNodeId: "source-node",
          role: "assistant" as const,
          sourceCreatedAt: "2026-09-12T00:01:01.000Z",
          displayText: "verified child",
          depth: 1,
        },
        {
          sourceNodeId: "child-2",
          parentSourceNodeId: "child-1",
          role: "user" as const,
          sourceCreatedAt: "2026-09-12T00:01:02.000Z",
          displayText: "verified grandchild",
          depth: 2,
        },
      ],
    };
  }

  async restore(input: Record<string, unknown>) {
    this.restoreCalls.push(input);
    return { restored: true as const, sourceId: SOURCE_ID };
  }
}

async function connect() {
  const reads = new ConversationReads();
  const pruning = new ConversationPruning();
  const server = createMcpServer({
    conversationArchiveTools: {
      conversationArchiveReadService: reads as never,
      conversationPruningService: pruning as never,
      getAuthenticatedUserId: () => USER_ID,
    },
  });
  const client = new Client(
    { name: "conversation-mcp-model-view-test", version: "1" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, reads, pruning };
}

test("Conversation MCP inventory exposes dedicated read-only search and model-view tools", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tools = await fixture.client.listTools();
  for (const name of ["search_conversations", "read_conversation"]) {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be registered`);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
  }
});

test("search_conversations returns exact read_conversation pointers for saved branches", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const response = await fixture.client.callTool({
    name: "search_conversations",
    arguments: { query: "needle", provider: "chatgpt" },
  });
  assert.equal(response.isError, undefined);

  const data = (response.structuredContent as {
    data: {
      results: Array<{
        message_id: string;
        conversation_id: string;
        detail_tool: string;
        detail_arguments: Record<string, unknown>;
      }>;
    };
  }).data;
  assert.deepEqual(data.results[0], {
    message_id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    provider: "chatgpt",
    conversation_title: "Canonical archive",
    source_node_id: "node-saved",
    role: "assistant",
    model: "gpt-5.6",
    source_created_at: "2026-09-16T12:00:00.000Z",
    is_current_path: false,
    snippet: "needle in the canonical saved branch",
    detail_tool: "read_conversation",
    detail_arguments: {
        conversation_id: CONVERSATION_ID,
        message_id: MESSAGE_ID,
        view: "all",
        scope: "active",
      },
  });
  assert.equal(fixture.reads.searchCalls[0]?.userId, USER_ID);
});

test("read_conversation returns canonical structured blocks and a model-readable transcript", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const response = await fixture.client.callTool({
    name: "read_conversation",
    arguments: {
      conversation_id: CONVERSATION_ID,
      message_id: MESSAGE_ID,
      view: "all",
      mode: "full",
      context: 20,
    },
  });
  assert.equal(response.isError, undefined);

  const structured = response.structuredContent as {
    data: {
      representation: string;
      path_basis: string;
      messages: Array<{
        content_blocks: Array<{ kind: string; raw_type: string; text: string | null }>;
        attachments: Array<{ name: string | null }>;
      }>;
    };
  };
  assert.equal(structured.data.representation, "canonical_model_view");
  assert.equal(structured.data.path_basis, "branch_inclusive");
  assert.equal(structured.data.messages[0]?.content_blocks[0]?.kind, "thinking");
  assert.equal(structured.data.messages[0]?.content_blocks[1]?.raw_type, "text");
  assert.equal(structured.data.messages[0]?.attachments[0]?.name, "note.txt");

  const text = (response.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(text, /canonical_model_view/);
  assert.match(text, /\[thinking; raw_type=thinking; ordinal=0\]/);
  assert.match(text, /needle in the canonical saved branch/);
  assert.equal(text.includes("raw export"), false);

  assert.equal(fixture.reads.readCalls[0]?.userId, USER_ID);
  assert.equal(fixture.reads.readCalls[0]?.conversationId, CONVERSATION_ID);
  assert.equal(fixture.reads.readCalls[0]?.messageId, MESSAGE_ID);
});


test("Conversation recovery MCP tools expose read-only inspection plus an exact user-scoped restore mutation", async (t) => {
  const recovery = new RecoveryReads();
  const server = createMcpServer({
    conversationRecoveryInspection: {
      conversationExclusionManagementService: recovery as never,
      getAuthenticatedUserId: () => USER_ID,
    },
  });
  const client = new Client(
    { name: "conversation-recovery-inspection-test", version: "1" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const inventory = await client.listTools();
  for (const name of ["list_conversation_exclusions", "inspect_conversation_restore_candidates", "inspect_conversation_restore_path"]) {
    const tool = inventory.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be registered`);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
  }

  const restoreTool = inventory.tools.find((candidate) => candidate.name === "restore_conversation_exclusion");
  assert.ok(restoreTool, "restore_conversation_exclusion should be registered");
  assert.deepEqual(restoreTool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  });
  assert.equal("user_id" in (restoreTool.inputSchema.properties ?? {}), false);

  const listed = await client.callTool({
    name: "list_conversation_exclusions",
    arguments: { provider: "claude", scope: "branch", limit: 20, offset: 0 },
  });
  assert.equal(listed.isError, undefined);
  const listData = (listed.structuredContent as { data: { items: Array<Record<string, unknown>> } }).data;
  assert.equal(listData.items[0]?.exclusion_id, EXCLUSION_ID);
  assert.equal(recovery.listCalls[0]?.userId, USER_ID);

  const inspected = await client.callTool({
    name: "inspect_conversation_restore_candidates",
    arguments: { exclusion_id: EXCLUSION_ID },
  });
  assert.equal(inspected.isError, undefined);
  const inspectData = (inspected.structuredContent as { data: { candidates: Array<Record<string, unknown>>; unique_match: boolean } }).data;
  assert.equal(inspectData.candidates[0]?.source_id, SOURCE_ID);
  assert.equal(inspectData.unique_match, true);
  assert.deepEqual(recovery.candidateCalls[0], { userId: USER_ID, exclusionId: EXCLUSION_ID });

  const path = await client.callTool({
    name: "inspect_conversation_restore_path",
    arguments: { exclusion_id: EXCLUSION_ID, source_id: SOURCE_ID, limit: 40, offset: 0 },
  });
  assert.equal(path.isError, undefined);
  const pathData = (path.structuredContent as {
    data: {
      root_source_node_id: string | null;
      messages: Array<Record<string, unknown>>;
      metadata: { total: number; returned: number; has_more: boolean };
    };
  }).data;
  assert.equal(pathData.root_source_node_id, "source-node");
  assert.equal(pathData.messages[1]?.parent_source_node_id, "source-node");
  assert.equal(pathData.messages[2]?.depth, 2);
  assert.deepEqual(pathData.metadata, { total: 3, offset: 0, returned: 3, has_more: false, next_offset: null });
  assert.deepEqual(recovery.evidenceCalls[0], {
    userId: USER_ID,
    exclusionId: EXCLUSION_ID,
    sourceId: SOURCE_ID,
    limit: 40,
    offset: 0,
  });

  const restored = await client.callTool({
    name: "restore_conversation_exclusion",
    arguments: { exclusion_id: EXCLUSION_ID, source_id: SOURCE_ID },
  });
  assert.equal(restored.isError, undefined);
  assert.deepEqual(restored.structuredContent, {
    success: true,
    data: {
      exclusion_id: EXCLUSION_ID,
      source_id: SOURCE_ID,
      restored: true,
    },
  });
  assert.deepEqual(recovery.restoreCalls[0], {
    userId: USER_ID,
    exclusionId: EXCLUSION_ID,
    sourceId: SOURCE_ID,
  });
});

test("Conversation recovery inspection schemas reject client-supplied identity", async (t) => {
  const recovery = new RecoveryReads();
  const server = createMcpServer({
    conversationRecoveryInspection: {
      conversationExclusionManagementService: recovery as never,
      getAuthenticatedUserId: () => USER_ID,
    },
  });
  const client = new Client(
    { name: "conversation-recovery-identity-test", version: "1" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const result = await client.callTool({
    name: "list_conversation_exclusions",
    arguments: { user_id: "attacker" },
  });
  assert.equal(result.isError, true);
  assert.equal(recovery.listCalls.length, 0);

  const restore = await client.callTool({
    name: "restore_conversation_exclusion",
    arguments: {
      exclusion_id: EXCLUSION_ID,
      source_id: SOURCE_ID,
      user_id: "attacker",
    },
  });
  assert.equal(restore.isError, true);
  assert.equal(recovery.restoreCalls.length, 0);
});

test("Conversation MCP schemas reject client-supplied identity before service calls", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const result = await fixture.client.callTool({
    name: "search_conversations",
    arguments: { query: "needle", user_id: "attacker" },
  });
  assert.equal(result.isError, true);
  assert.equal(fixture.reads.searchCalls.length, 0);
});

test("Conversation product tools reject both user identity spellings before calling services", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const cases: Array<{ name: string; arguments: Record<string, unknown> }> = [
    { name: "list_conversations", arguments: {} },
    { name: "search_conversations", arguments: { query: "needle" } },
    { name: "read_conversation", arguments: { conversation_id: CONVERSATION_ID } },
    { name: "list_deleted_conversation_branches", arguments: {} },
    { name: "archive_conversation", arguments: { conversation_id: CONVERSATION_ID } },
    { name: "delete_conversation_item", arguments: { target: { kind: "conversation", conversation_id: CONVERSATION_ID } } },
    { name: "restore_conversation_item", arguments: { target: { kind: "conversation", conversation_id: CONVERSATION_ID, scope: "archived" } } },
    { name: "permanently_delete_conversation_item", arguments: { target: { kind: "conversation", conversation_id: CONVERSATION_ID, scope: "deleted" } } },
  ];

  for (const field of ["user_id", "userId"] as const) {
    for (const entry of cases) {
      const rejected = await fixture.client.callTool({
        name: entry.name,
        arguments: { ...entry.arguments, [field]: "attacker" },
      });
      assert.equal(rejected.isError, true, `${entry.name} must reject ${field}`);
    }
  }
  assert.equal(fixture.reads.listCalls.length, 0);
  assert.equal(fixture.reads.searchCalls.length, 0);
  assert.equal(fixture.reads.readCalls.length, 0);
  assert.equal(fixture.pruning.calls.length, 0);
});

test("Conversation product surface exposes browse, lifecycle, and compact reads without client identity", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const inventory = await fixture.client.listTools();
  for (const name of [
    "list_conversations",
    "search_conversations",
    "read_conversation",
    "list_deleted_conversation_branches",
    "archive_conversation",
    "delete_conversation_item",
    "restore_conversation_item",
    "permanently_delete_conversation_item",
  ]) {
    const tool = inventory.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be registered`);
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
  }

  const compact = await fixture.client.callTool({
    name: "read_conversation",
    arguments: { conversation_id: CONVERSATION_ID },
  });
  assert.equal(compact.isError, undefined);
  const data = (compact.structuredContent as {
    data: { messages: Array<Record<string, unknown>>; conversation: Record<string, unknown> };
  }).data;
  assert.equal(data.messages[0]?.display_text, "needle in the canonical saved branch");
  assert.equal("content_blocks" in (data.messages[0] ?? {}), false);
  assert.equal("attachments" in (data.messages[0] ?? {}), false);
  assert.equal("provider_metadata" in data.conversation, false);

  const readTool = inventory.tools.find((candidate) => candidate.name === "read_conversation");
  assert.match(readTool?.description ?? "", /mode defaults to compact/i);
  assert.match(readTool?.description ?? "", /without canonical payloads or attachments/i);
  assert.match(readTool?.description ?? "", /mode=full/i);
});

test("read_conversation continuation preserves the complete selected lifecycle state", async (t) => {
  const fixture = await connect();
  fixture.reads.nextOffset = 40;
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const cases = [
    { arguments: { conversation_id: CONVERSATION_ID, view: "all", scope: "archived", mode: "compact" }, expected: "conversation_id=" + CONVERSATION_ID + ", view=all, scope=archived, mode=compact, offset=40" },
    { arguments: { conversation_id: CONVERSATION_ID, view: "default", scope: "deleted", mode: "compact" }, expected: "conversation_id=" + CONVERSATION_ID + ", view=default, scope=deleted, mode=compact, offset=40" },
    { arguments: { conversation_id: CONVERSATION_ID, view: "all", scope: "deleted", branch_id: EXCLUSION_ID, mode: "compact" }, expected: "conversation_id=" + CONVERSATION_ID + ", view=all, scope=deleted, mode=compact, branch_id=" + EXCLUSION_ID + ", offset=40" },
    { arguments: { conversation_id: CONVERSATION_ID, view: "all", scope: "archived", mode: "full" }, expected: "conversation_id=" + CONVERSATION_ID + ", view=all, scope=archived, mode=full, offset=40" },
  ] as const;

  for (const entry of cases) {
    const response = await fixture.client.callTool({ name: "read_conversation", arguments: entry.arguments });
    const text = (response.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    assert.match(text, new RegExp(entry.expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("new Conversation browse and lifecycle tools advertise structured output contracts", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  const inventory = await fixture.client.listTools();
  for (const name of [
    "list_conversations",
    "list_deleted_conversation_branches",
    "archive_conversation",
    "delete_conversation_item",
    "restore_conversation_item",
    "permanently_delete_conversation_item",
  ]) {
    const tool = inventory.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be registered`);
    assert.equal(tool.outputSchema?.type, "object", `${name} must advertise an object output schema`);
    assert.ok(tool.outputSchema?.properties?.success, `${name} must expose success`);
    assert.ok(tool.outputSchema?.properties?.data, `${name} must expose data`);
  }
});

test("Conversation lifecycle tools use the exact authenticated target identities", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  await fixture.client.callTool({ name: "archive_conversation", arguments: { conversation_id: CONVERSATION_ID } });
  await fixture.client.callTool({ name: "delete_conversation_item", arguments: { target: { kind: "branch", conversation_id: CONVERSATION_ID, message_id: MESSAGE_ID } } });
  await fixture.client.callTool({ name: "restore_conversation_item", arguments: { target: { kind: "conversation", conversation_id: CONVERSATION_ID, scope: "deleted" } } });
  await fixture.client.callTool({ name: "permanently_delete_conversation_item", arguments: { target: { kind: "branch", conversation_id: CONVERSATION_ID, branch_id: EXCLUSION_ID } } });
  assert.deepEqual(fixture.pruning.calls, [
    { name: "archive", input: { userId: USER_ID, conversationId: CONVERSATION_ID } },
    { name: "deleteBranch", input: { userId: USER_ID, conversationId: CONVERSATION_ID, messageId: MESSAGE_ID } },
    { name: "restoreDeleted", input: { userId: USER_ID, conversationId: CONVERSATION_ID } },
    { name: "permanentBranch", input: { userId: USER_ID, conversationId: CONVERSATION_ID, branchId: EXCLUSION_ID } },
  ]);
  const rejected = await fixture.client.callTool({ name: "archive_conversation", arguments: { conversation_id: CONVERSATION_ID, user_id: "attacker" } });
  assert.equal(rejected.isError, true);
  assert.equal(fixture.pruning.calls.length, 4);
});
