import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MemoryDomainError,
  type ReadMemoryDiscoveryResult,
  type ReadMemoryInput,
  type ReadMemoryResult,
} from "../../../domains/memory/memory-service.js";
import { createLeadingPreview } from "../../../domains/compact-text.js";
import {
  createMcpToolError,
  mcpToolErrorStructuredContentSchema,
} from "../error-contract.js";

const memoryCategorySchema = z.enum([
  "profile",
  "preference",
  "goal",
  "project",
]);
const contentAuthorSchema = z.enum(["L", "G"]);

const readMemoryInputSchema = z
  .object({
    categories: z
      .array(memoryCategorySchema)
      .max(4)
      .optional()
      .describe("Optional core-memory categories to include."),
    keys: z
      .array(z.string().trim().min(1).max(100))
      .max(50)
      .optional()
      .describe("Optional exact memory keys to include."),
  })
  .strict();

const readMemorySuccessOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    user: z.object({
      display_name: z.string(),
    }),
    memories: z.array(
      z.object({
        id: z.string(),
        category: memoryCategorySchema,
        key: z.string(),
        tags: z.array(z.string()),
        author: contentAuthorSchema.nullable(),
        updated_at: z.string().datetime(),
        preview: z.string(),
        detail_tool: z.literal("get_memory"),
        detail_arguments: z.object({ id: z.string(), scope: z.literal("active") }),
      }),
    ),
    metadata: z.object({
      count: z.number().int().nonnegative(),
    }),
  }),
});

const readMemoryOutputSchema = z.union([
  readMemorySuccessOutputSchema,
  mcpToolErrorStructuredContentSchema,
]);

export interface ReadMemoryToolService {
  readMemory(input: ReadMemoryInput): Promise<ReadMemoryResult>;
  readMemoryDiscovery?(input: ReadMemoryInput): Promise<ReadMemoryDiscoveryResult>;
}

export type ReadMemoryToolDependencies = {
  memoryService: ReadMemoryToolService;
  getAuthenticatedUserId: () => string;
};

export function registerReadMemoryTool(
  server: McpServer,
  dependencies: ReadMemoryToolDependencies,
): void {
  server.registerTool(
    "read_memory",
    {
      title: "Read Leilei's core memory",
      description:
        "Browse authorized Memory by category or exact key without a text query. Results are compact previews with stable IDs; use search_memory for text discovery and get_memory for the complete content of a selected record.",
      inputSchema: readMemoryInputSchema,
      outputSchema: readMemoryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ categories, keys }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const input = {
          userId,
          categories,
          keys,
        };
        const discovery = dependencies.memoryService.readMemoryDiscovery
          ? await dependencies.memoryService.readMemoryDiscovery(input)
          : compactFallback(await dependencies.memoryService.readMemory(input));
        const data = withDetailPointers(discovery);
        const result = {
          success: true as const,
          data,
        };

        return {
          content: [
            {
              type: "text",
              text: `Retrieved ${data.metadata.count} core memories.`,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return toSafeToolError(error);
      }
    },
  );
}

function compactFallback(result: ReadMemoryResult): ReadMemoryDiscoveryResult {
  return {
    user: result.user,
    memories: result.memories.map(({ id, category, key, tags, author, updated_at, content }) => ({
      id,
      category,
      key,
      tags,
      author: author ?? null,
      updated_at,
      preview: createLeadingPreview(content),
      detail_tool: "get_memory" as const,
      detail_arguments: { id, scope: "active" as const },
    })),
    metadata: result.metadata,
  };
}

function withDetailPointers(result: ReadMemoryDiscoveryResult): ReadMemoryDiscoveryResult {
  return {
    ...result,
    memories: result.memories.map((memory) => ({
      ...memory,
      detail_tool: "get_memory" as const,
      detail_arguments: { id: memory.id, scope: "active" as const },
    })),
  };
}

function toSafeToolError(error: unknown) {
  if (error instanceof ReadMemoryAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to read memory.",
    );
  }

  if (error instanceof MemoryDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Memory is unavailable for the authenticated user."
        : "The memory request is invalid.";

    return createMcpToolError(error.code, message);
  }

  console.error(
    "read_memory failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Memory is temporarily unavailable.",
  );
}

export class ReadMemoryAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "ReadMemoryAuthenticationError";
  }
}
