import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ConversationExclusionManagementError,
  type ConversationExclusionManagementService,
} from "../../../domains/conversation/conversation-exclusion-management-service.js";
import { ConversationArchiveAuthenticationError } from "../conversation-archive/register.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const providerSchema = z.enum(["chatgpt", "claude"]);
const scopeSchema = z.enum(["conversation", "branch"]);
const roleSchema = z.enum(["user", "assistant", "system", "tool", "reasoning", "unknown"]);

const listInputSchema = z.object({
  provider: providerSchema.optional(),
  scope: scopeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  offset: z.number().int().min(0).max(100_000).default(0).optional(),
}).strict();

const exclusionSchema = z.object({
  exclusion_id: z.string().uuid(),
  provider: providerSchema,
  scope: scopeSchema,
  source_conversation_id: z.string(),
  source_node_id: z.string().nullable(),
  canonical_conversation_exists: z.boolean(),
  canonical_node_exists: z.boolean().nullable(),
  title: z.string().nullable(),
  source_created_at: z.string().datetime().nullable(),
  root_role: roleSchema.nullable(),
  root_snippet: z.string().nullable(),
  created_at: z.string().datetime(),
}).strict();

const listOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    items: z.array(exclusionSchema),
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

const inspectInputSchema = z.object({
  exclusion_id: z.string().uuid(),
}).strict();

const candidateSchema = z.object({
  source_id: z.string().uuid(),
  filename: z.string(),
  title: z.string().nullable(),
  root_role: roleSchema.nullable(),
  root_source_created_at: z.string().datetime().nullable(),
  root_snippet: z.string().nullable(),
}).strict();

const inspectOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    exclusion_id: z.string().uuid(),
    candidates: z.array(candidateSchema),
    total: z.number().int().min(0),
    unique_match: z.boolean(),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const pathInputSchema = z.object({
  exclusion_id: z.string().uuid(),
  source_id: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(40).optional(),
  offset: z.number().int().min(0).max(100_000).default(0).optional(),
}).strict();

const evidenceMessageSchema = z.object({
  source_node_id: z.string(),
  parent_source_node_id: z.string().nullable(),
  role: roleSchema,
  source_created_at: z.string().datetime().nullable(),
  display_text: z.string(),
  depth: z.number().int().min(0),
}).strict();

const pathOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    exclusion_id: z.string().uuid(),
    source_id: z.string().uuid(),
    filename: z.string(),
    title: z.string().nullable(),
    root_source_node_id: z.string().nullable(),
    messages: z.array(evidenceMessageSchema),
    metadata: z.object({
      total: z.number().int().min(0),
      offset: z.number().int().min(0),
      returned: z.number().int().min(0),
      has_more: z.boolean(),
      next_offset: z.number().int().min(0).nullable(),
    }).strict(),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const restoreInputSchema = z.object({
  exclusion_id: z.string().uuid(),
  source_id: z.string().uuid(),
}).strict();

const restoreOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    exclusion_id: z.string().uuid(),
    source_id: z.string().uuid(),
    restored: z.literal(true),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type ConversationRecoveryInspectionToolDependencies = {
  conversationExclusionManagementService: Pick<
    ConversationExclusionManagementService,
    "list" | "restoreCandidates" | "restoreEvidence" | "restore"
  >;
  getAuthenticatedUserId: () => string;
};

export function registerConversationRecoveryInspectionTools(
  server: McpServer,
  dependencies: ConversationRecoveryInspectionToolDependencies,
): void {
  server.registerTool("list_conversation_exclusions", {
    title: "List Conversation Exclusions",
    description: "List Conversation exclusions for recovery diagnosis.",
    inputSchema: listInputSchema,
    outputSchema: listOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ provider, scope, limit = 50, offset = 0 }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const result = await dependencies.conversationExclusionManagementService.list({
        userId,
        provider,
        scope,
        limit,
        offset,
      });
      const items = result.items.map((item) => ({
        exclusion_id: item.id,
        provider: item.provider,
        scope: item.scope,
        source_conversation_id: item.sourceConversationId,
        source_node_id: item.sourceNodeId,
        canonical_conversation_exists: item.canonicalConversationExists,
        canonical_node_exists: item.canonicalNodeExists,
        title: item.title,
        source_created_at: item.sourceCreatedAt,
        root_role: item.rootRole,
        root_snippet: item.rootSnippet,
        created_at: item.createdAt,
      }));
      const data = {
        items,
        metadata: {
          count: items.length,
          total: result.total,
          limit,
          offset,
          has_more: offset + items.length < result.total,
        },
      };
      return {
        content: [{
          type: "text",
          text: joinMcpContentLines([
            `Found ${result.total} Conversation exclusions; returning ${items.length}.`,
            ...items.map((item) =>
              `${item.provider} ${item.scope} [exclusion_id=${item.exclusion_id}; source_conversation_id=${item.source_conversation_id}; source_node_id=${item.source_node_id ?? "null"}] ${quoteMcpText(item.title ?? "Untitled conversation")}`
            ),
          ]),
        }],
        structuredContent: { success: true as const, data },
      };
    } catch (error) {
      return safeInspectionError(error, "list");
    }
  });

  server.registerTool("inspect_conversation_restore_candidates", {
    title: "Inspect Conversation Restore Candidates",
    description: "Find retained raw sources containing one Conversation exclusion; no restore.",
    inputSchema: inspectInputSchema,
    outputSchema: inspectOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ exclusion_id }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const result = await dependencies.conversationExclusionManagementService.restoreCandidates({
        userId,
        exclusionId: exclusion_id,
      });
      const candidates = result.items.map((candidate) => ({
        source_id: candidate.sourceId,
        filename: candidate.filename,
        title: candidate.title,
        root_role: candidate.rootRole,
        root_source_created_at: candidate.rootSourceCreatedAt,
        root_snippet: candidate.rootSnippet,
      }));
      const data = {
        exclusion_id,
        candidates,
        total: result.total,
        unique_match: result.total === 1,
      };
      return {
        content: [{
          type: "text",
          text: joinMcpContentLines([
            `Resolved ${result.total} verified retained-source candidate(s) for exclusion ${exclusion_id}.`,
            ...candidates.map((candidate) =>
              `source_id=${candidate.source_id}; file=${quoteMcpText(candidate.filename)}; title=${quoteMcpText(candidate.title ?? "Unavailable")}; root_role=${candidate.root_role ?? "Unavailable"}; root_time=${candidate.root_source_created_at ?? "Unavailable"}; root_snippet=${quoteMcpText(candidate.root_snippet ?? "Unavailable")}`
            ),
          ]),
        }],
        structuredContent: { success: true as const, data },
      };
    } catch (error) {
      return safeInspectionError(error, "inspect");
    }
  });

  server.registerTool("inspect_conversation_restore_path", {
    title: "Inspect Conversation Restore Path",
    description: "Inspect branch recovery evidence for one exclusion/source pair.",
    inputSchema: pathInputSchema,
    outputSchema: pathOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ exclusion_id, source_id, limit = 40, offset = 0 }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const result = await dependencies.conversationExclusionManagementService.restoreEvidence({
        userId,
        exclusionId: exclusion_id,
        sourceId: source_id,
        limit,
        offset,
      });
      const messages = result.messages.map((message) => ({
        source_node_id: message.sourceNodeId,
        parent_source_node_id: message.parentSourceNodeId,
        role: message.role,
        source_created_at: message.sourceCreatedAt,
        display_text: message.displayText,
        depth: message.depth,
      }));
      const consumed = result.offset + messages.length;
      const data = {
        exclusion_id,
        source_id: result.sourceId,
        filename: result.filename,
        title: result.title,
        root_source_node_id: result.rootSourceNodeId,
        messages,
        metadata: {
          total: result.total,
          offset: result.offset,
          returned: messages.length,
          has_more: consumed < result.total,
          next_offset: consumed < result.total ? consumed : null,
        },
      };
      return {
        content: [{
          type: "text",
          text: joinMcpContentLines([
            `Restore-path evidence for exclusion ${exclusion_id} from ${quoteMcpText(result.filename)}: ${messages.length} of ${result.total} message(s).`,
            ...messages.map((message) =>
              `depth=${message.depth}; node=${message.source_node_id}; parent=${message.parent_source_node_id ?? "null"}; role=${message.role}; time=${message.source_created_at ?? "Unavailable"}; text=${quoteMcpText(message.display_text)}`
            ),
          ]),
        }],
        structuredContent: { success: true as const, data },
      };
    } catch (error) {
      return safeInspectionError(error, "path");
    }
  });

  server.registerTool("restore_conversation_exclusion", {
    title: "Restore Conversation Exclusion",
    description: "Restore one Conversation exclusion from a verified source; inspect candidates and path first.",
    inputSchema: restoreInputSchema,
    outputSchema: restoreOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ exclusion_id, source_id }) => {
    try {
      const userId = dependencies.getAuthenticatedUserId();
      const result = await dependencies.conversationExclusionManagementService.restore({
        userId,
        exclusionId: exclusion_id,
        sourceId: source_id,
      });
      const data = {
        exclusion_id,
        source_id: result.sourceId,
        restored: true as const,
      };
      return {
        content: [{
          type: "text",
          text: `Restored Conversation exclusion ${exclusion_id} from retained source ${result.sourceId}.`,
        }],
        structuredContent: { success: true as const, data },
      };
    } catch (error) {
      return safeInspectionError(error, "restore");
    }
  });
}

function safeInspectionError(error: unknown, operation: "list" | "inspect" | "path" | "restore") {
  if (error instanceof ConversationArchiveAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      operation === "restore"
        ? "Authentication is required to restore a Conversation exclusion."
        : "Authentication is required to inspect Conversation recovery state.",
    );
  }
  if (error instanceof ConversationExclusionManagementError) {
    const message = error.code === "CONVERSATION_EXCLUSION_NOT_FOUND"
      ? "Conversation exclusion was not found for the authenticated user."
      : error.code === "CONVERSATION_EXCLUSION_UNAVAILABLE"
        ? operation === "restore"
          ? "Conversation restore is unavailable for the authenticated user."
          : "Conversation recovery inspection is unavailable for the authenticated user."
        : operation === "restore"
          ? "The Conversation restore request is invalid."
          : "The Conversation recovery inspection request is invalid.";
    return createMcpToolError(error.code, message);
  }
  console.error(
    `${operation}_conversation_recovery failed`,
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Conversation recovery inspection is temporarily unavailable.",
  );
}
