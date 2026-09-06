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
import { MEMORY_CONTENT_MAX_LENGTH } from "../../../domains/resource-limits.js";
import { invokeMcpWrite } from "../write-context.js";
import {
  createMcpToolError,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const memoryCategorySchema = z.enum(["profile", "preference", "goal", "project"]);
const rawMemoryKeySchema = z.string().max(1_000);
const rawMemoryContentSchema = z.string().max(MEMORY_CONTENT_MAX_LENGTH);
const rawMemoryTagSchema = z.string().max(500);
const contentAuthorSchema = z.enum(["L", "G", "C"]);
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

const writeMemoryDataSchema = z.object({
  memory: z.object({
    id: z.string().uuid(),
    category: memoryCategorySchema,
    key: z.string(),
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
  detail_tool: z.literal("get_memory"),
  detail_arguments: z.object({
    id: z.string().uuid(),
    scope: z.enum(["active", "archived"]),
  }).strict(),
});

const writeMemoryOutputSchema = z.object({
  success: z.boolean(),
  data: writeMemoryDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

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
        "Create one durable Memory record only after the user explicitly approves the exact category, key, content, and tags. Never write model guesses, inferred facts, temporary emotions, one-off conversation details, or automatic summaries. The success result is a compact receipt; call get_memory with its returned detail_arguments for authoritative readback. For an archived idempotent replay, use get_memory with scope=archived; do not assume the active scope.",
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
          const memory = {
            id: data.memory.id,
            category: data.memory.category,
            key: data.memory.key,
            tags: data.memory.tags,
            source: data.memory.source,
            lifecycle_status: data.memory.lifecycle_status,
            created_at: data.memory.created_at,
            updated_at: data.memory.updated_at,
            author: data.memory.author,
          };
          return {
            content: [{
              type: "text",
              text: joinMcpContentLines([
                responseText(data),
                `Memory ${quoteMcpText(memory.key)} [id=${memory.id}; category=${memory.category}; lifecycle=${memory.lifecycle_status}]`,
                `get_memory(id=${memory.id}, scope=${memory.lifecycle_status})`,
              ]),
            }],
            structuredContent: {
              success: true as const,
              data: {
                memory,
                metadata: data.metadata,
                detail_tool: "get_memory" as const,
                detail_arguments: {
                  id: memory.id,
                  scope: memory.lifecycle_status,
                },
              },
            },
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
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to write Memory.",
    );
  }
  if (error instanceof MemoryDomainError) {
    const text = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
      ? "Memory writing is unavailable for the authenticated user."
      : error.code === "IDEMPOTENCY_CONFLICT"
        ? "This idempotency key was already used for different Memory content."
        : error.code === "MEMORY_KEY_CONFLICT"
          ? "A Memory record already uses this key."
          : "The Memory request is invalid.";
    return createMcpToolError(error.code, text);
  }
  console.error("write_memory failed", error instanceof Error ? error.name : "UnknownError");
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Memory writing is temporarily unavailable.",
  );
}

export class WriteMemoryAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "WriteMemoryAuthenticationError";
  }
}
