import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MemoryDomainError,
  type SearchMemoryDiscoveryResult,
  type ReadMemoryInput,
  type ReadMemoryResult,
} from "../../../domains/memory/memory-service.js";
import { ReadMemoryAuthenticationError } from "../read-memory/register.js";
import { createBodyMatchSnippet } from "../../../domains/compact-text.js";

const memoryCategorySchema = z.enum([
  "profile",
  "preference",
  "goal",
  "project",
]);
const contentAuthorSchema = z.enum(["L", "G"]);

const searchMemoryInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("Required text to search in Memory keys and content."),
    categories: z
      .array(memoryCategorySchema)
      .max(4)
      .optional()
      .describe("Optional exact Memory categories to include."),
    tag: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .optional()
      .describe("Optional exact Memory tag to match."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum number of search results to return."),
  })
  .strict();

const searchMemoryOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    memories: z.array(
      z.object({
        id: z.string(),
        category: memoryCategorySchema,
        key: z.string(),
        tags: z.array(z.string()),
        updated_at: z.string().datetime(),
        author: contentAuthorSchema.nullable(),
        snippet: z.string().nullable(),
        detail_tool: z.literal("get_memory"),
        detail_arguments: z.object({ id: z.string(), scope: z.literal("active") }),
      }),
    ),
    metadata: z.object({
      count: z.number().int().nonnegative(),
    }),
  }),
});

export interface SearchMemoryToolService {
  readMemory(input: ReadMemoryInput): Promise<ReadMemoryResult>;
  searchMemoryDiscovery?(input: ReadMemoryInput): Promise<SearchMemoryDiscoveryResult>;
}

export type SearchMemoryToolDependencies = {
  memoryService: SearchMemoryToolService;
  getAuthenticatedUserId: () => string;
};

export function registerSearchMemoryTool(
  server: McpServer,
  dependencies: SearchMemoryToolDependencies,
): void {
  server.registerTool(
    "search_memory",
    {
      title: "Search Leilei's memory",
      description:
        "Search authorized active Memory records by text, category, and exact tag. Use read_memory for category or exact-key browsing without a query. Results are compact and bounded; call get_memory for the complete content of a selected record.",
      inputSchema: searchMemoryInputSchema,
      outputSchema: searchMemoryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, categories, tag, limit }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const input = {
          userId,
          query,
          categories,
          tag,
          ordering: "updated_desc",
          limit,
        } as ReadMemoryInput;
        const discovery = dependencies.memoryService.searchMemoryDiscovery
          ? await dependencies.memoryService.searchMemoryDiscovery(input)
          : compactFallback(await dependencies.memoryService.readMemory(input), query ?? "");
        const data = withDetailPointers(discovery);

        return {
          content: [
            {
              type: "text",
              text: `Found ${data.metadata.count} Memory records.`,
            },
          ],
          structuredContent: {
            success: true as const,
            data,
          },
        };
      } catch (error) {
        return toSafeSearchMemoryError(error);
      }
    },
  );
}

function compactFallback(result: ReadMemoryResult, query: string): SearchMemoryDiscoveryResult {
  return {
    memories: result.memories.map(({ id, category, key, content, tags, updated_at, author }) => ({
      id,
      category,
      key,
      tags,
      updated_at,
      author: author ?? null,
      snippet: createBodyMatchSnippet(content, query),
      detail_tool: "get_memory" as const,
      detail_arguments: { id, scope: "active" as const },
    })),
    metadata: result.metadata,
  };
}

function withDetailPointers(result: SearchMemoryDiscoveryResult): SearchMemoryDiscoveryResult {
  return {
    ...result,
    memories: result.memories.map((memory) => ({
      ...memory,
      detail_tool: "get_memory" as const,
      detail_arguments: { id: memory.id, scope: "active" as const },
    })),
  };
}

function toSafeSearchMemoryError(error: unknown) {
  if (error instanceof ReadMemoryAuthenticationError) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: "Authentication is required to search memory.",
        },
      ],
    };
  }

  if (error instanceof MemoryDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Memory is unavailable for the authenticated user."
        : "The Memory search is invalid.";

    return {
      isError: true as const,
      content: [{ type: "text" as const, text: message }],
    };
  }

  console.error(
    "search_memory failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: "Memory is temporarily unavailable.",
      },
    ],
  };
}
