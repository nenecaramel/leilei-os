import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ConversationArchiveReadError,
  type ConversationArchiveReadService,
  type ConversationModelMessage,
  type ConversationModelView,
} from "../../../domains/conversation/conversation-archive-read-service.js";
import type { ConversationArchiveSearchResult } from "../../../domains/conversation/conversation-archive-read-service.js";
import { ConversationPruningError, type ConversationPruningService } from "../../../domains/conversation/conversation-pruning-service.js";
import type { ConversationArchiveListItem } from "../../../domains/conversation/conversation-archive-read-repository.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { compactMcpText, joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const providerSchema = z.enum(["chatgpt", "claude"]);
const roleSchema = z.enum(["user", "assistant"]);
const viewSchema = z.enum(["default", "all"]);
const lifecycleScopeSchema = z.enum(["active", "archived", "deleted"]);
const readModeSchema = z.enum(["compact", "full"]);

const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(500)
    .describe("Text to find inside the current canonical Conversation Archive."),
  provider: providerSchema.optional(),
  role: roleSchema.optional(),
  conversation_id: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time_zone: z.string().min(1).max(100).optional()
    .describe("Required when from or to is supplied. Use an IANA time zone such as Asia/Shanghai."),
  favorites_only: z.boolean().default(false).optional(),
  scope: lifecycleScopeSchema.default("active").optional(),
  limit: z.number().int().min(1).max(100).default(20).optional(),
  offset: z.number().int().min(0).max(1_000_000).default(0).optional(),
}).strict();

const detailArgumentsSchema = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  view: viewSchema,
  scope: lifecycleScopeSchema,
}).strict();

const searchResultSchema = z.object({
  message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  provider: providerSchema,
  conversation_title: z.string().nullable(),
  source_node_id: z.string(),
  role: roleSchema,
  model: z.string().nullable(),
  source_created_at: z.string().datetime().nullable(),
  is_current_path: z.boolean(),
  snippet: z.string(),
  detail_tool: z.literal("read_conversation"),
  detail_arguments: detailArgumentsSchema,
}).strict();

const searchOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    results: z.array(searchResultSchema),
    metadata: z.object({
      count: z.number().int().min(0),
      total: z.number().int().min(0),
      limit: z.number().int().min(1).max(100),
      offset: z.number().int().min(0),
      has_more: z.boolean(),
    }).strict(),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const readInputSchema = z.object({
  conversation_id: z.string().uuid()
    .describe("Canonical Conversation id returned by search_conversations or global_search."),
  message_id: z.string().uuid().optional()
    .describe("Optional exact canonical message id. When supplied, read a bounded context window around this message."),
  view: viewSchema.default("default").optional()
    .describe("default uses the ChatGPT authoritative current path and Claude branch-inclusive canonical view. Use all to inspect saved branches."),
  scope: lifecycleScopeSchema.default("active").optional(),
  branch_id: z.string().uuid().optional()
    .describe("Deleted branch id from list_deleted_conversation_branches. Only valid with scope=deleted."),
  mode: readModeSchema.default("compact").optional()
    .describe("compact returns a bounded transcript. full includes canonical blocks, payloads, attachments, and provider metadata."),
  context: z.number().int().min(0).max(50).default(20).optional()
    .describe("Messages before and after message_id. Ignored when message_id is omitted."),
  limit: z.number().int().min(1).max(100).default(40).optional()
    .describe("Page size when message_id is omitted."),
  offset: z.number().int().min(0).max(1_000_000).default(0).optional()
    .describe("Message offset when message_id is omitted."),
}).strict();

const listInputSchema = z.object({
  provider: providerSchema.optional(),
  scope: lifecycleScopeSchema.default("active").optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  offset: z.number().int().min(0).max(100_000).default(0).optional(),
}).strict();

const deletedBranchesInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50).optional(),
  offset: z.number().int().min(0).max(100_000).default(0).optional(),
}).strict();

const archiveInputSchema = z.object({ conversation_id: z.string().uuid() }).strict();
const conversationTargetSchema = z.object({ kind: z.literal("conversation"), conversation_id: z.string().uuid() }).strict();
const branchDeleteTargetSchema = z.object({ kind: z.literal("branch"), conversation_id: z.string().uuid(), message_id: z.string().uuid() }).strict();
const branchTargetSchema = z.object({ kind: z.literal("branch"), conversation_id: z.string().uuid(), branch_id: z.string().uuid() }).strict();
const deleteInputSchema = z.object({ target: z.discriminatedUnion("kind", [conversationTargetSchema, branchDeleteTargetSchema]) }).strict();
const restoreInputSchema = z.object({ target: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("conversation"), conversation_id: z.string().uuid(), scope: z.enum(["archived", "deleted"]) }).strict(),
  branchTargetSchema,
]) }).strict();
const permanentDeleteInputSchema = z.object({ target: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("conversation"), conversation_id: z.string().uuid(), scope: z.literal("deleted") }).strict(),
  branchTargetSchema,
]) }).strict();

const blockSchema = z.object({
  ordinal: z.number().int().min(0),
  kind: z.enum(["text", "thinking", "reasoning_recap", "tool_use", "tool_result", "image", "audio", "video", "file", "unknown"]),
  raw_type: z.string(),
  text: z.string().nullable(),
  payload: z.unknown().nullable(),
}).strict();

const attachmentSchema = z.object({
  ordinal: z.number().int().min(0),
  source_attachment_id: z.string().nullable(),
  name: z.string().nullable(),
  mime_type: z.string().nullable(),
  size_bytes: z.number().int().min(0).nullable(),
  payload: z.unknown(),
}).strict();

const modelMessageSchema = z.object({
  id: z.string().uuid(),
  source_node_id: z.string(),
  source_message_id: z.string().nullable(),
  parent_source_node_id: z.string().nullable(),
  role: z.enum(["user", "assistant", "system", "tool", "reasoning", "unknown"]),
  raw_role: z.string().nullable(),
  model: z.string().nullable(),
  source_created_at: z.string().datetime().nullable(),
  source_updated_at: z.string().datetime().nullable(),
  is_current_path: z.boolean(),
  current_path_index: z.number().int().min(0).nullable(),
  turn_index: z.number().int().min(0).nullable(),
  is_primary: z.boolean(),
  display_text: z.string(),
  content_blocks: z.array(blockSchema),
  attachments: z.array(attachmentSchema),
}).strict();

const conversationSchema = z.object({
  id: z.string().uuid(),
  provider: providerSchema,
  source_conversation_id: z.string(),
  title: z.string().nullable(),
  source_created_at: z.string().datetime().nullable(),
  source_updated_at: z.string().datetime().nullable(),
  default_model: z.string().nullable(),
  current_leaf_source_node_id: z.string().nullable(),
  message_count: z.number().int().min(0),
  turn_count: z.number().int().min(0),
  total_node_count: z.number().int().min(0),
  provider_metadata: z.unknown(),
}).strict();

const compactConversationSchema = conversationSchema.omit({
  source_conversation_id: true,
  provider_metadata: true,
});

const compactMessageSchema = z.object({
  id: z.string().uuid(),
  source_node_id: z.string(),
  parent_source_node_id: z.string().nullable(),
  role: z.enum(["user", "assistant", "system", "tool", "reasoning", "unknown"]),
  model: z.string().nullable(),
  source_created_at: z.string().datetime().nullable(),
  is_current_path: z.boolean(),
  display_text: z.string(),
}).strict();

const readOutputSchema = z.object({
  success: z.boolean(),
  data: z.union([z.object({
    conversation: conversationSchema,
    representation: z.literal("canonical_model_view"),
    mode: z.literal("full"),
    view: viewSchema,
    path_basis: z.enum(["current_path", "branch_inclusive"]),
    messages: z.array(modelMessageSchema),
    pagination: z.object({
      total: z.number().int().min(0),
      offset: z.number().int().min(0),
      returned: z.number().int().min(0),
      anchor_index: z.number().int().min(0).nullable(),
      has_more: z.boolean(),
      next_offset: z.number().int().min(0).nullable(),
    }).strict(),
  }).strict(), z.object({
    conversation: compactConversationSchema,
    representation: z.literal("canonical_model_view"),
    mode: z.literal("compact"),
    view: viewSchema,
    path_basis: z.enum(["current_path", "branch_inclusive"]),
    messages: z.array(compactMessageSchema),
    pagination: z.object({
      total: z.number().int().min(0),
      offset: z.number().int().min(0),
      returned: z.number().int().min(0),
      anchor_index: z.number().int().min(0).nullable(),
      has_more: z.boolean(),
      next_offset: z.number().int().min(0).nullable(),
    }).strict(),
  }).strict()]).optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type ConversationArchiveMcpToolDependencies = {
  conversationArchiveReadService: Pick<ConversationArchiveReadService, "list" | "search" | "modelView">;
  conversationPruningService?: Pick<ConversationPruningService,
    "listDeletedBranches" | "archiveConversation" | "deleteConversation" | "deleteBranch" |
    "restoreConversation" | "restoreDeletedConversation" | "restoreBranch" |
    "permanentlyDeleteConversation" | "permanentlyDeleteBranch">;
  getAuthenticatedUserId: () => string;
};

export function registerConversationArchiveTools(
  server: McpServer,
  dependencies: ConversationArchiveMcpToolDependencies,
): void {
  server.registerTool("list_conversations", {
    title: "List Conversations",
    description: "List authenticated canonical Conversations in one lifecycle scope. Use read_conversation with each exact detail pointer.",
    inputSchema: listInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ provider, scope = "active", limit = 50, offset = 0 }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const result = await dependencies.conversationArchiveReadService.list({ userId, provider, scope, limit, offset });
      const items = result.items.map((item) => toListToolResult(item, scope));
      return {
        content: [{ type: "text", text: joinMcpContentLines([
          `${result.total} Conversations in ${scope}; returning ${items.length}.`,
          ...items.map((item) => `${item.provider} ${quoteMcpText(item.title ?? "Untitled conversation")} [conversation_id=${item.conversation_id}; detail_tool=read_conversation]`),
        ]) }],
        structuredContent: { success: true as const, data: { items, metadata: {
          count: items.length, total: result.total, limit, offset, has_more: offset + items.length < result.total,
        } } },
      };
    } catch (error) {
      return safeConversationToolError(error, "list");
    }
  });

  server.registerTool("search_conversations", {
    title: "Search Conversation Archive",
    description: "Search the authenticated user's current canonical Conversation Archive when the target domain is known to be past ChatGPT or Claude conversations. Results come from canonical messages after LeileiOS pruning/deletion, never directly from immutable raw exports. Each hit points to read_conversation for bounded model-readable context. Use global_search instead when the target domain is unknown.",
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({
    query,
    provider,
    role,
    conversation_id,
    from,
    to,
    time_zone,
    favorites_only = false,
    scope = "active",
    limit = 20,
    offset = 0,
  }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const result = await dependencies.conversationArchiveReadService.search({
        userId,
        query,
        provider,
        role,
        conversationId: conversation_id,
        from,
        to,
        timeZone: time_zone,
        favoritesOnly: favorites_only,
        scope,
        limit,
        offset,
      });
      const results = result.items.map((item) => toSearchToolResult(item, scope));
      const data = {
        results,
        metadata: {
          count: results.length,
          total: result.total,
          limit,
          offset,
          has_more: offset + results.length < result.total,
        },
      };
      return {
        content: [{
          type: "text",
          text: joinMcpContentLines([
            `Found ${result.total} matching Conversation messages; returning ${results.length}.`,
            ...results.map((item) =>
              `${item.provider} ${quoteMcpText(item.conversation_title ?? "Untitled conversation")} [conversation_id=${item.conversation_id}; message_id=${item.message_id}; view=${item.detail_arguments.view}; detail_tool=read_conversation] — ${quoteMcpText(item.snippet)}`
            ),
          ]),
        }],
        structuredContent: { success: true as const, data },
      };
    } catch (error) {
      return safeConversationToolError(error, "search");
    }
  });

  server.registerTool("read_conversation", {
    title: "Read Conversation",
    description: "Read a bounded, model-friendly canonical transcript from LeileiOS after an exact Conversation id is known. This view preserves canonical role/model/timestamps, source-node and parent-node ids, ordered content blocks (including thinking/tool kinds when stored), and attachment metadata. It reflects current LeileiOS state after conversation or branch deletion/pruning; immutable raw export blobs are not read by this tool. With message_id, returns context around the exact hit; without it, page through the conversation with offset/limit.",
    inputSchema: readInputSchema,
    outputSchema: readOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({
    conversation_id,
    message_id,
    view = "default",
    scope = "active",
    branch_id,
    mode = "compact",
    context = 20,
    limit = 40,
    offset = 0,
  }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const modelView = await dependencies.conversationArchiveReadService.modelView({
        userId,
        conversationId: conversation_id,
        messageId: message_id,
        view,
        scope,
        branchId: branch_id,
        mode,
        context,
        limit,
        offset,
      });
      const data = toReadToolData(modelView, mode);
      return {
        content: [{ type: "text", text: modelViewContent(modelView) }],
        structuredContent: { success: true as const, data },
      };
    } catch (error) {
      return safeConversationToolError(error, "read");
    }
  });

  if (!dependencies.conversationPruningService) return;
  registerConversationLifecycleTools(server, {
    ...dependencies,
    conversationPruningService: dependencies.conversationPruningService,
  });
}

function toListToolResult(item: ConversationArchiveListItem, scope: "active" | "archived" | "deleted") {
  return {
    conversation_id: item.id,
    provider: item.provider,
    title: item.title,
    source_created_at: item.sourceCreatedAt,
    source_updated_at: item.sourceUpdatedAt,
    default_model: item.defaultModel,
    current_leaf_source_node_id: item.currentLeafSourceNodeId,
    message_count: item.messageCount,
    turn_count: item.turnCount,
    total_node_count: item.totalNodeCount,
    ...(item.archivedAt ? { archived_at: item.archivedAt } : {}),
    ...(item.deletedAt ? { deleted_at: item.deletedAt } : {}),
    detail_tool: "read_conversation" as const,
    detail_arguments: { conversation_id: item.id, view: "default" as const, scope },
  };
}

function toSearchToolResult(item: ConversationArchiveSearchResult, scope: "active" | "archived" | "deleted") {
  const view = item.provider === "chatgpt" && !item.isCurrentPath ? "all" as const : "default" as const;
  return {
    message_id: item.messageId,
    conversation_id: item.conversationId,
    provider: item.provider,
    conversation_title: item.conversationTitle,
    source_node_id: item.sourceNodeId,
    role: item.role,
    model: item.model,
    source_created_at: item.sourceCreatedAt,
    is_current_path: item.isCurrentPath,
    snippet: item.snippet,
    detail_tool: "read_conversation" as const,
    detail_arguments: {
      conversation_id: item.conversationId,
      message_id: item.messageId,
      view,
      scope,
    },
  };
}

function toReadToolData(view: ConversationModelView, mode: "compact" | "full") {
  const pagination = {
    total: view.total,
    offset: view.offset,
    returned: view.items.length,
    anchor_index: view.anchorIndex,
    has_more: view.hasMore,
    next_offset: view.nextOffset,
  };
  if (mode === "compact") {
    return {
      conversation: {
        id: view.conversation.id,
        provider: view.conversation.provider,
        title: view.conversation.title,
        source_created_at: view.conversation.sourceCreatedAt,
        source_updated_at: view.conversation.sourceUpdatedAt,
        default_model: view.conversation.defaultModel,
        current_leaf_source_node_id: view.conversation.currentLeafSourceNodeId,
        message_count: view.conversation.messageCount,
        turn_count: view.conversation.turnCount,
        total_node_count: view.conversation.totalNodeCount,
      },
      representation: view.representation,
      mode,
      view: view.view,
      path_basis: view.pathBasis,
      messages: view.items.map((message) => ({
        id: message.id,
        source_node_id: message.sourceNodeId,
        parent_source_node_id: message.parentSourceNodeId,
        role: message.role,
        model: message.model,
        source_created_at: message.sourceCreatedAt,
        is_current_path: message.isCurrentPath,
        display_text: message.displayText,
      })),
      pagination,
    };
  }
  return {
    conversation: {
      id: view.conversation.id,
      provider: view.conversation.provider,
      source_conversation_id: view.conversation.sourceConversationId,
      title: view.conversation.title,
      source_created_at: view.conversation.sourceCreatedAt,
      source_updated_at: view.conversation.sourceUpdatedAt,
      default_model: view.conversation.defaultModel,
      current_leaf_source_node_id: view.conversation.currentLeafSourceNodeId,
      message_count: view.conversation.messageCount,
      turn_count: view.conversation.turnCount,
      total_node_count: view.conversation.totalNodeCount,
      provider_metadata: view.conversation.providerMetadata,
    },
    representation: view.representation,
    mode,
    view: view.view,
    path_basis: view.pathBasis,
    messages: view.items.map((message) => ({
      id: message.id,
      source_node_id: message.sourceNodeId,
      source_message_id: message.sourceMessageId,
      parent_source_node_id: message.parentSourceNodeId,
      role: message.role,
      raw_role: message.rawRole,
      model: message.model,
      source_created_at: message.sourceCreatedAt,
      source_updated_at: message.sourceUpdatedAt,
      is_current_path: message.isCurrentPath,
      current_path_index: message.currentPathIndex,
      turn_index: message.turnIndex,
      is_primary: message.isPrimary,
      display_text: message.displayText,
      content_blocks: message.contentBlocks.map((block) => ({
        ordinal: block.ordinal,
        kind: block.kind,
        raw_type: block.rawType,
        text: block.text,
        payload: block.payload,
      })),
      attachments: message.attachments.map((attachment) => ({
        ordinal: attachment.ordinal,
        source_attachment_id: attachment.sourceAttachmentId,
        name: attachment.name,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
        payload: attachment.payload,
      })),
    })),
    pagination,
  };
}

function modelViewContent(view: ConversationModelView): string {
  const title = view.conversation.title?.trim() || "Untitled conversation";
  const start = view.items.length > 0 ? view.offset + 1 : 0;
  const end = view.offset + view.items.length;
  return joinMcpContentLines([
    `Conversation ${quoteMcpText(title)} [conversation_id=${view.conversation.id}; provider=${view.conversation.provider}; representation=${view.representation}; view=${view.view}; path_basis=${view.pathBasis}]`,
    `Messages ${start}-${end} of ${view.total}.`,
    ...view.items.flatMap((message, index) => renderModelMessage(message, view.offset + index)),
    ...(view.nextOffset !== null
      ? [`More messages are available: read_conversation(conversation_id=${view.conversation.id}, view=${view.view}, offset=${view.nextOffset}).`]
      : []),
  ]);
}

function registerConversationLifecycleTools(
  server: McpServer,
  dependencies: ConversationArchiveMcpToolDependencies & { conversationPruningService: NonNullable<ConversationArchiveMcpToolDependencies["conversationPruningService"]> },
): void {
  const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
  server.registerTool("list_deleted_conversation_branches", {
    title: "List Deleted Conversation Branches",
    description: "List recoverable deleted canonical Conversation branches. Use the returned branch id to read, restore, or permanently delete a branch.",
    inputSchema: deletedBranchesInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ limit = 50, offset = 0 }) => {
    try {
      const result = await dependencies.conversationPruningService.listDeletedBranches({ userId: dependencies.getAuthenticatedUserId(), limit, offset });
      const items = result.items.map((item) => ({
        branch_id: item.id,
        conversation_id: item.conversationId,
        provider: item.provider,
        title: item.title,
        deleted_at: item.deletedAt ?? null,
        root_role: item.rootRole,
        root_source_created_at: item.rootSourceCreatedAt,
        root_snippet: item.rootSnippet,
        detail_tool: "read_conversation" as const,
        detail_arguments: { conversation_id: item.conversationId, branch_id: item.id, scope: "deleted" as const, view: "all" as const },
      }));
      return { content: [{ type: "text", text: `${result.total} deleted Conversation branches; returning ${items.length}.` }], structuredContent: { success: true, data: { items, metadata: { count: items.length, total: result.total, limit, offset, has_more: offset + items.length < result.total } } } };
    } catch (error) { return safeConversationToolError(error, "lifecycle"); }
  });

  server.registerTool("archive_conversation", {
    title: "Archive Conversation",
    description: "Move one active Conversation to Archive. It remains restorable.", inputSchema: archiveInputSchema, annotations,
  }, async ({ conversation_id }) => {
    try {
      await dependencies.conversationPruningService.archiveConversation({ userId: dependencies.getAuthenticatedUserId(), conversationId: conversation_id });
      return lifecycleSuccess("Conversation archived.", { conversation_id, archived: true });
    } catch (error) { return safeConversationToolError(error, "lifecycle"); }
  });

  server.registerTool("delete_conversation_item", {
    title: "Delete Conversation Item",
    description: "Move an active Conversation or a branch rooted at message_id to Deleted. Branch deletion is recoverable and requires the root message id, not a deleted branch id.", inputSchema: deleteInputSchema,
    annotations: { ...annotations, destructiveHint: true },
  }, async ({ target }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const result = target.kind === "conversation"
        ? await dependencies.conversationPruningService.deleteConversation({ userId, conversationId: target.conversation_id })
        : await dependencies.conversationPruningService.deleteBranch({ userId, conversationId: target.conversation_id, messageId: target.message_id });
      return lifecycleSuccess("Conversation item moved to Deleted.", { target, ...result });
    } catch (error) { return safeConversationToolError(error, "lifecycle"); }
  });

  server.registerTool("restore_conversation_item", {
    title: "Restore Conversation Item",
    description: "Restore an archived/deleted whole Conversation or a deleted branch using its stored branch_id.", inputSchema: restoreInputSchema, annotations,
  }, async ({ target }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      if (target.kind === "branch") await dependencies.conversationPruningService.restoreBranch({ userId, conversationId: target.conversation_id, branchId: target.branch_id });
      else if (target.scope === "archived") await dependencies.conversationPruningService.restoreConversation({ userId, conversationId: target.conversation_id });
      else await dependencies.conversationPruningService.restoreDeletedConversation({ userId, conversationId: target.conversation_id });
      return lifecycleSuccess("Conversation item restored.", { target, restored: true });
    } catch (error) { return safeConversationToolError(error, "lifecycle"); }
  });

  server.registerTool("permanently_delete_conversation_item", {
    title: "Permanently Delete Conversation Item",
    description: "Permanently delete a previously deleted Conversation or deleted branch and block its later reimport. The original export remains preserved.", inputSchema: permanentDeleteInputSchema,
    annotations: { ...annotations, destructiveHint: true },
  }, async ({ target }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const result = target.kind === "branch"
        ? await dependencies.conversationPruningService.permanentlyDeleteBranch({ userId, conversationId: target.conversation_id, branchId: target.branch_id })
        : await dependencies.conversationPruningService.permanentlyDeleteConversation({ userId, conversationId: target.conversation_id });
      return lifecycleSuccess("Conversation item permanently deleted; original export remains preserved.", { target, ...result });
    } catch (error) { return safeConversationToolError(error, "lifecycle"); }
  });
}

function lifecycleSuccess(text: string, data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent: { success: true as const, data } };
}

function renderModelMessage(message: ConversationModelMessage, absoluteIndex: number): string[] {
  const header = [
    `#${absoluteIndex + 1}`,
    message.sourceCreatedAt ?? "time-unknown",
    message.role,
    message.model ? `model=${message.model}` : null,
    `message_id=${message.id}`,
    `node=${message.sourceNodeId}`,
    message.parentSourceNodeId ? `parent=${message.parentSourceNodeId}` : null,
    message.isCurrentPath ? "current_path" : "saved_branch",
  ].filter(Boolean).join(" | ");

  const blocks = message.contentBlocks.length > 0
    ? message.contentBlocks.flatMap((block) => {
        const label = `[${block.kind}; raw_type=${block.rawType}; ordinal=${block.ordinal}]`;
        const text = block.text?.trim();
        const payload = block.payload == null ? null : compactJson(block.payload);
        return [label, ...(text ? [text] : []), ...(payload ? [`payload: ${payload}`] : [])];
      })
    : [message.displayText || "(empty message)"];

  const attachments = message.attachments.map((attachment) =>
    `[attachment ordinal=${attachment.ordinal}; name=${quoteMcpText(attachment.name ?? "")}; mime=${attachment.mimeType ?? "unknown"}; size=${attachment.sizeBytes ?? "unknown"}; source_id=${attachment.sourceAttachmentId ?? "unknown"}]`
  );

  return [`[${header}]`, ...blocks, ...attachments];
}

function compactJson(value: unknown): string {
  try {
    return compactMcpText(JSON.stringify(value), 1200);
  } catch {
    return "[unserializable payload]";
  }
}

function safeConversationToolError(error: unknown, operation: "list" | "search" | "read" | "lifecycle") {
  if (error instanceof ConversationArchiveAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to read Conversation Archive.",
    );
  }
  if (error instanceof ConversationArchiveReadError) {
    const message = error.code === "CONVERSATION_NOT_FOUND"
      ? "Conversation or message was not found in the selected canonical view."
      : error.code === "CONVERSATION_UNAVAILABLE"
        ? "Conversation Archive is unavailable for the authenticated user."
        : "The Conversation Archive request is invalid.";
    return createMcpToolError(error.code, message);
  }
  if (error instanceof ConversationPruningError) {
    const message = error.code === "CONVERSATION_PRUNE_NOT_FOUND"
      ? "Conversation item was not found in the selected lifecycle state."
      : error.code === "CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED"
        ? "This branch contains the whole Conversation and must be deleted as a whole Conversation."
        : error.code === "CONVERSATION_PRUNE_UNAVAILABLE"
          ? "Conversation lifecycle actions are unavailable for the authenticated user."
          : error.code === "CONVERSATION_PRUNE_ACTION_NOT_AVAILABLE"
            ? "This Conversation lifecycle action is unavailable."
            : "The Conversation lifecycle request is invalid.";
    return createMcpToolError(error.code, message);
  }
  console.error(
    `${operation}_conversation failed`,
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Conversation Archive is temporarily unavailable.",
  );
}

export class ConversationArchiveAuthenticationError extends Error {
  constructor() {
    super("Conversation Archive authentication is required.");
    this.name = "ConversationArchiveAuthenticationError";
  }
}
