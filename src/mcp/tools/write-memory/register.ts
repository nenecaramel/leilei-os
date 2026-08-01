import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MemoryDomainError,
  type AuthenticatedMemoryContext,
  type CreateMcpMemoryInput,
  type CreateMcpMemoryResult,
} from "../../../domains/memory/memory-service.js";
import {
  MCP_IDEMPOTENCY_KEY_MAX_LENGTH,
  MCP_IDEMPOTENCY_KEY_MIN_LENGTH,
  MCP_IDEMPOTENCY_KEY_PATTERN,
} from "../../../domains/mcp-write/mcp-write-idempotency.js";
import { invokeMcpWrite } from "../write-context.js";

const memoryCategorySchema = z.enum(["profile", "preference", "goal", "project"]);
const writeMemoryInputSchema = z.object({
  category: memoryCategorySchema,
  key: z.string().min(1).max(100),
  content: z.string().min(1).max(4_000),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  idempotency_key: z.string()
    .min(MCP_IDEMPOTENCY_KEY_MIN_LENGTH)
    .max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH)
    .regex(MCP_IDEMPOTENCY_KEY_PATTERN),
}).strict();

const writeMemoryOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    memory: z.object({
      id: z.string().uuid(),
      category: memoryCategorySchema,
      key: z.string(),
      content: z.string(),
      tags: z.array(z.string()),
      source: z.literal("mcp"),
      lifecycle_status: z.enum(["active", "archived"]),
      created_at: z.string().datetime(),
      updated_at: z.string().datetime(),
    }),
    metadata: z.object({
      created: z.boolean(),
      idempotent_replay: z.boolean(),
    }),
  }),
});

export interface WriteMemoryToolService {
  createMcpMemory(
    context: AuthenticatedMemoryContext,
    input: CreateMcpMemoryInput,
    idempotencyKey: string,
  ): Promise<CreateMcpMemoryResult>;
}

export type WriteMemoryToolDependencies = {
  memoryService: WriteMemoryToolService;
  getAuthenticatedUserId: () => string;
};

export function registerWriteMemoryTool(
  server: McpServer,
  dependencies: WriteMemoryToolDependencies,
): void {
  server.registerTool(
    "write_memory",
    {
      title: "Write a confirmed Memory record",
      description:
        "Create one durable Memory record only after the user explicitly approves the exact category, key, content, and tags. Never write model guesses, inferred facts, temporary emotions, one-off conversation details, or automatic summaries. After success, call get_memory with the returned id and verify the authoritative stored record.",
      inputSchema: writeMemoryInputSchema,
      outputSchema: writeMemoryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ category, key, content, tags, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "write_memory",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const data = await dependencies.memoryService.createMcpMemory(
            { userId },
            { category, key, content, tags },
            idempotency_key,
          );
          return {
            content: [{
              type: "text",
              text: data.metadata.idempotent_replay
                ? "The existing Memory record was returned without creating a duplicate."
                : "Memory record created successfully. Call get_memory with the returned id to verify it.",
            }],
            structuredContent: { success: true as const, data },
          };
        },
        mapError: toSafeToolError,
      }),
  );
}

function toSafeToolError(error: unknown) {
  if (error instanceof WriteMemoryAuthenticationError) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: "Authentication is required to write Memory." }],
    };
  }
  if (error instanceof MemoryDomainError) {
    const text = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
      ? "Memory writing is unavailable for the authenticated user."
      : error.code === "IDEMPOTENCY_CONFLICT"
        ? "This idempotency key was already used for different Memory content."
        : error.code === "MEMORY_KEY_CONFLICT"
          ? "A Memory record already uses this key."
          : "The Memory request is invalid.";
    return { isError: true as const, content: [{ type: "text" as const, text }] };
  }
  console.error("write_memory failed", error instanceof Error ? error.name : "UnknownError");
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: "Memory writing is temporarily unavailable." }],
  };
}

export class WriteMemoryAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "WriteMemoryAuthenticationError";
  }
}
