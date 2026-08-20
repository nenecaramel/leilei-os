import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MemoryDomainError,
  type AuthenticatedMemoryContext,
  type ReadMemoryDetailResult,
  type UpdateMcpMemoryInput,
} from "../../../domains/memory/memory-service.js";
import { invokeMcpWrite } from "../write-context.js";

const updateMemoryInputSchema = z.object({
  id: z.string().trim().min(1),
  category: z.enum(["profile", "preference", "goal", "project"]).optional(),
  key: z.string().max(1_000).optional(),
  content: z.string().max(20_000).optional(),
  tags: z.array(z.string().max(500)).max(20).optional(),
  author: z.enum(["L", "G"]).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "id"), {
  message: "At least one Memory field must be supplied.",
});

const updateMemoryOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string(),
    category: z.enum(["profile", "preference", "goal", "project"]),
    key: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
    source: z.string(),
    updated_at: z.string().datetime(),
    lifecycle_status: z.literal("active"),
    author: z.enum(["L", "G"]).nullable(),
  }),
});

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
    description: "Update only explicitly supplied fields on one active Memory record.",
    inputSchema: updateMemoryInputSchema,
    outputSchema: updateMemoryOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ id, category, key, content, tags, author }) => invokeMcpWrite({
    toolName: "update_memory",
    getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      const data = await dependencies.memoryService.updateMcpMemory(
        { userId },
        { id, ...(category === undefined ? {} : { category }), ...(key === undefined ? {} : { key }), ...(content === undefined ? {} : { content }), ...(tags === undefined ? {} : { tags }), ...(author === undefined ? {} : { author }) },
      );
      return { content: [{ type: "text", text: "Memory updated." }], structuredContent: { success: true as const, data: { ...data, lifecycle_status: "active" as const } } };
    },
    mapError: toSafeToolError,
  }));
}

function toSafeToolError(error: unknown) {
  if (error instanceof UpdateMemoryAuthenticationError) return { isError: true as const, content: [{ type: "text" as const, text: "Authentication is required to update Memory." }] };
  if (error instanceof MemoryDomainError) {
    const text = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
      ? "Memory updating is unavailable for the authenticated user."
      : error.code === "MEMORY_NOT_FOUND" ? "Memory was not found." : "The Memory update request is invalid.";
    return { isError: true as const, content: [{ type: "text" as const, text }] };
  }
  console.error("update_memory failed", error instanceof Error ? error.name : "UnknownError");
  return { isError: true as const, content: [{ type: "text" as const, text: "Memory updating is temporarily unavailable." }] };
}

export class UpdateMemoryAuthenticationError extends Error {
  constructor() { super("Authenticated MCP user context is unavailable."); this.name = "UpdateMemoryAuthenticationError"; }
}
