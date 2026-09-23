import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MEMORY_DOMAIN_BOUNDARY } from "../model-language.js";
import {
  MemoryDomainError,
  type ReadMemoryDiscoveryResult,
  type ReadMemoryInput,
  type ReadMemoryResult,
} from "../../../domains/memory/memory-service.js";
import { createLeadingPreview } from "../../../domains/compact-text.js";
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
    limit: z.number().int().min(1).max(50).default(50).optional(),
    cursor: z.string().min(1).max(2_048).optional(),
  })
  .strict();

const readMemoryDataSchema = z.object({
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
    returned: z.number().int().nonnegative(),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
  }),
});

const readMemoryOutputSchema = z.object({
  success: z.boolean(),
  data: readMemoryDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

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
        MEMORY_DOMAIN_BOUNDARY + " Browse by category or exact key without text search. Returns compact previews with stable IDs. Use search_memory for text discovery and get_memory for bounded detail. If has_more, pass next_cursor back with the same filters.",
      inputSchema: readMemoryInputSchema,
      outputSchema: readMemoryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ categories, keys, limit, cursor }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const pageSize = limit ?? 50;
        const cursorContext = {
          categories: categories ?? null,
          keys: keys ?? null,
        };
        const offset = decodeMcpPaginationCursor(cursor, "read_memory", cursorContext);
        const input = {
          userId,
          categories,
          keys,
          limit: pageSize + 1,
          offset,
        };
        const discovery = dependencies.memoryService.readMemoryDiscovery
          ? await dependencies.memoryService.readMemoryDiscovery(input)
          : compactFallback(await dependencies.memoryService.readMemory(input));
        const withPointers = withDetailPointers(discovery);
        const page = paginateMcpRows({
          rows: withPointers.memories,
          pageSize,
          offset,
          tool: "read_memory",
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
        const result = {
          success: true as const,
          data,
        };

        return {
          content: [
            {
              type: "text",
              text: memoryReadContent(data),
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

function memoryReadContent(data: ReadMemoryDiscoveryResult): string {
  const lines = [`Retrieved ${data.metadata.count} core memories for ${quoteMcpText(data.user.display_name)}.`];
  for (const memory of data.memories) {
    const pointer = formatMcpDetailPointer("get_memory", { id: memory.id, scope: "active" });
    lines.push(`${memory.category}/${quoteMcpText(memory.key)} [id=${memory.id}; ${pointer}] — ${quoteMcpText(memory.preview)}`);
  }
  return joinMcpContentLines(lines);
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
  if (error instanceof McpPaginationCursorError) {
    return createMcpToolError("INVALID_CURSOR", "The Memory continuation cursor is invalid for this request.");
  }
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
