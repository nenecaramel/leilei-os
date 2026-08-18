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
const rawMemoryKeySchema = z.string().max(1_000);
const rawMemoryContentSchema = z.string().max(20_000);
const rawMemoryTagSchema = z.string().max(500);
const contentAuthorSchema = z.enum(["L", "G"]);
const writeMemoryInputSchema = z.object({
  category: memoryCategorySchema,
  key: rawMemoryKeySchema,
  content: rawMemoryContentSchema,
  tags: z.array(rawMemoryTagSchema).max(20).optional(),
  author: contentAuthorSchema,
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
      author: contentAuthorSchema.nullable(),
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
        "Create one durable Memory record only after the user explicitly approves the exact category, key, content, and tags. Never write model guesses, inferred facts, temporary emotions, one-off conversation details, or automatic summaries. For a newly created active Memory or an active idempotent replay, call get_memory with the returned id and verify the authoritative stored record. For an archived idempotent replay, do not call the active-only get_memory tool.",
      inputSchema: writeMemoryInputSchema,
      outputSchema: writeMemoryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ category, key, content, tags, author, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "write_memory",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const data = await dependencies.memoryService.createMcpMemory(
            { userId },
            { category, key, content, tags, author },
            idempotency_key,
          );
          return {
            content: [{
              type: "text",
              text: responseText(data),
            }],
            structuredContent: { success: true as const, data },
          };
        },
        mapError: toSafeToolError,
      }),
  );
}

function responseText(data: CreateMcpMemoryResult): string {
  if (!data.metadata.idempotent_replay) {
    return "Memory record created successfully. Call get_memory with the returned id to verify it.";
  }
  if (data.memory.lifecycle_status === "archived") {
    return "The original Memory record is archived and no duplicate was created. Do not call the active-only get_memory tool for this archived record.";
  }
  return "The active Memory record was returned without creating a duplicate. Call get_memory with the returned id to verify it.";
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
