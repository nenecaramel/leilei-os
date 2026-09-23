import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MEMORY_DOMAIN_BOUNDARY } from "../model-language.js";
import {
  MemoryDomainError,
  type SearchMemoryDiscoveryResult,
  type ReadMemoryInput,
  type ReadMemoryResult,
} from "../../../domains/memory/memory-service.js";
import { ReadMemoryAuthenticationError } from "../read-memory/register.js";
import { createBodyMatchSnippet } from "../../../domains/compact-text.js";
import {
  createMcpToolError,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";
import { formatMcpDetailPointer, joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import {
  decodeMcpPaginationCursor,
  McpPaginationCursorError,
  paginateMcpRows,
} from "../pagination.js";

const memoryCategorySchema = z.enum([
  "profile",
  "preference",
  "goal",
  "project",
]);
const contentAuthorSchema = z.enum(["L", "G", "C"]);

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
      .default(50)
      .optional()
      .describe("Maximum number of search results to return. Defaults to 50."),
    cursor: z.string().min(1).max(2_048).optional(),
  })
  .strict();

const searchMemoryDataSchema = z.object({
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
    returned: z.number().int().nonnegative(),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
  }),
});

const searchMemoryOutputSchema = z.object({
  success: z.boolean(),
  data: searchMemoryDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

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
        MEMORY_DOMAIN_BOUNDARY + " Search authorized active Memory records by text, category, and exact tag. Use read_memory for category or exact-key browsing without a query. Results are compact and bounded; call get_memory for authoritative bounded detail, continuing with its content cursor when needed. When has_more is true, continue this result set by passing next_cursor back as cursor with the same search filters.",
      inputSchema: searchMemoryInputSchema,
      outputSchema: searchMemoryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, categories, tag, limit, cursor }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const pageSize = limit ?? 50;
        const cursorContext = {
          query,
          categories: categories ?? null,
          tag: tag ?? null,
        };
        const offset = decodeMcpPaginationCursor(cursor, "search_memory", cursorContext);
        const input = {
          userId,
          query,
          categories,
          tag,
          ordering: "updated_desc",
          limit: pageSize + 1,
          offset,
        } as ReadMemoryInput;
        const discovery = dependencies.memoryService.searchMemoryDiscovery
          ? await dependencies.memoryService.searchMemoryDiscovery(input)
          : compactFallback(await dependencies.memoryService.readMemory(input), query ?? "");
        const withPointers = withDetailPointers(discovery);
        const page = paginateMcpRows({
          rows: withPointers.memories,
          pageSize,
          offset,
          tool: "search_memory",
          context: cursorContext,
        });
        const data = {
          ...withPointers,
          memories: page.items,
          metadata: {
            count: page.items.length,
            ...page.metadata,
          },
        };

        return {
          content: [
            {
              type: "text",
              text: memorySearchContent(data),
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

function memorySearchContent(data: SearchMemoryDiscoveryResult): string {
  const lines = [`Found ${data.metadata.count} Memory records.`];
  for (const memory of data.memories) {
    const pointer = formatMcpDetailPointer("get_memory", { id: memory.id, scope: "active" });
    const snippet = memory.snippet ? ` — ${quoteMcpText(memory.snippet)}` : "";
    lines.push(`${memory.category}/${quoteMcpText(memory.key)} [id=${memory.id}; ${pointer}]${snippet}`);
  }
  return joinMcpContentLines(lines);
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
  if (error instanceof McpPaginationCursorError) {
    return createMcpToolError("INVALID_CURSOR", "The Memory continuation cursor is invalid for this search.");
  }
  if (error instanceof ReadMemoryAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to search memory.",
    );
  }

  if (error instanceof MemoryDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Memory is unavailable for the authenticated user."
        : "The Memory search is invalid.";

    return createMcpToolError(error.code, message);
  }

  console.error(
    "search_memory failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Memory is temporarily unavailable.",
  );
}
