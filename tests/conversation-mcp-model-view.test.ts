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

class ConversationReads {
  searchCalls: Array<Record<string, unknown>> = [];
  readCalls: Array<Record<string, unknown>> = [];

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
      hasMore: false,
      nextOffset: null,
    };
  }
}

async function connect() {
  const reads = new ConversationReads();
  const server = createMcpServer({
    conversationArchiveTools: {
      conversationArchiveReadService: reads as never,
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
  return { client, server, reads };
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
