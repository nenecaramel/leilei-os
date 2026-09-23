import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MCP_CONTENT_AUTHOR_DESCRIPTION, MEMORY_DOMAIN_BOUNDARY } from "../model-language.js";
import {
  MemoryDomainError,
  type AuthenticatedMemoryContext,
  type ReadMemoryDetailResult,
  type UpdateMcpMemoryInput,
} from "../../../domains/memory/memory-service.js";
import { MEMORY_CONTENT_MAX_LENGTH } from "../../../domains/resource-limits.js";
import { invokeMcpWrite } from "../write-context.js";
import {
  createMcpToolError,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import { mcpMutationReceipt, mcpMutationReceiptFields } from "../mutation-contract.js";

const contentAuthorSchema = z.enum(["L", "G", "C"]);

const updateMemoryInputSchema = z.object({
  id: z.string().trim().min(1),
  category: z.enum(["profile", "preference", "goal", "project"]).optional(),
  key: z.string().max(1_000).optional(),
  content: z.string().max(MEMORY_CONTENT_MAX_LENGTH).optional(),
  tags: z.array(z.string().max(500)).max(20).optional(),
  author: contentAuthorSchema.optional().describe(MCP_CONTENT_AUTHOR_DESCRIPTION),
}).strict();

const updateMemoryDataSchema = z.object({
  id: z.string(),
  category: z.enum(["profile", "preference", "goal", "project"]),
  key: z.string(),
  tags: z.array(z.string()),
  source: z.string(),
  updated_at: z.string().datetime(),
  lifecycle_status: z.literal("active"),
  author: contentAuthorSchema.nullable(),
  ...mcpMutationReceiptFields,
});

const updateMemoryOutputSchema = z.object({
  success: z.boolean(),
  data: updateMemoryDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface UpdateMemoryToolService {
  updateMcpMemory(context: AuthenticatedMemoryContext, input: UpdateMcpMemoryInput): Promise<ReadMemoryDetailResult>;
}

export type UpdateMemoryToolDependencies = {
  memoryService: UpdateMemoryToolService;
  getAuthenticatedUserId: () => string;
};

export function registerUpdateMemoryTool(server: McpServer, dependencies: UpdateMemoryToolDependencies): void {
  server.registerTool("update_memory", {
    title: "Update one Memory",
    description: MEMORY_DOMAIN_BOUNDARY + " Update only explicitly supplied fields on one active Memory record. If the outcome is uncertain, perform a readback with get_memory before deciding what to do next; never blindly retry.",
    inputSchema: updateMemoryInputSchema,
    outputSchema: updateMemoryOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ id, category, key, content, tags, author }) => invokeMcpWrite({
    toolName: "update_memory",
    getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      if (category === undefined && key === undefined && content === undefined && tags === undefined && author === undefined) {
        throw new MemoryDomainError("INVALID_MEMORY_PATCH", "At least one Memory field must be supplied.");
      }
      const data = await dependencies.memoryService.updateMcpMemory(
        { userId },
        { id, ...(category === undefined ? {} : { category }), ...(key === undefined ? {} : { key }), ...(content === undefined ? {} : { content }), ...(tags === undefined ? {} : { tags }), ...(author === undefined ? {} : { author }) },
      );
      const compact = {
        id: data.id,
        category: data.category,
        key: data.key,
        tags: data.tags,
        source: data.source,
        updated_at: data.updated_at,
        lifecycle_status: "active" as const,
        author: data.author,
        ...mcpMutationReceipt({
          outcome: "applied",
          entity_type: "memory",
          entity_id: data.id,
          revision: null,
          detail_tool: "get_memory",
          detail_arguments: { id: data.id, scope: "active" },
        }),
      };
      return {
        content: [{ type: "text", text: joinMcpContentLines([
          `Memory updated: ${quoteMcpText(compact.key)} [id=${compact.id}; category=${compact.category}]`,
          `get_memory(id=${compact.id}, scope=active)`,
        ]) }],
        structuredContent: { success: true as const, data: compact },
      };
    },
    mapError: toSafeToolError,
  }));
}

function toSafeToolError(error: unknown) {
  if (error instanceof UpdateMemoryAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to update Memory.",
    );
  }
  if (error instanceof MemoryDomainError) {
    const text = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
      ? "Memory updating is unavailable for the authenticated user."
      : error.code === "MEMORY_NOT_FOUND" ? "Memory was not found." : "The Memory update request is invalid.";
    return createMcpToolError(error.code, text);
  }
  console.error("update_memory failed", error instanceof Error ? error.name : "UnknownError");
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Memory updating is temporarily unavailable.",
  );
}

export class UpdateMemoryAuthenticationError extends Error {
  constructor() { super("Authenticated MCP user context is unavailable."); this.name = "UpdateMemoryAuthenticationError"; }
}
