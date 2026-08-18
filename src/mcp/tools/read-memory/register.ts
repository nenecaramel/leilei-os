import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MemoryDomainError,
  type ReadMemoryInput,
  type ReadMemoryResult,
} from "../../../domains/memory/memory-service.js";

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

const readMemoryOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    user: z.object({
      display_name: z.string(),
    }),
    memories: z.array(
      z.object({
        category: memoryCategorySchema,
        key: z.string(),
        content: z.string(),
        author: contentAuthorSchema.nullable(),
        updated_at: z.string().datetime(),
      }),
    ),
    metadata: z.object({
      count: z.number().int().nonnegative(),
    }),
  }),
});

export interface ReadMemoryToolService {
  readMemory(input: ReadMemoryInput): Promise<ReadMemoryResult>;
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
        "Read authorized core memories, stable preferences, long-term goals, and current projects from Leilei OS. This tool is read-only and cannot create, modify, or delete memories.",
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
        const data = await dependencies.memoryService.readMemory({
          userId,
          categories,
          keys,
        });
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

function toSafeToolError(error: unknown) {
  if (error instanceof ReadMemoryAuthenticationError) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: "Authentication is required to read memory.",
        },
      ],
    };
  }

  if (error instanceof MemoryDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Memory is unavailable for the authenticated user."
        : "The memory request is invalid.";

    return {
      isError: true as const,
      content: [{ type: "text" as const, text: message }],
    };
  }

  console.error(
    "read_memory failed",
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

export class ReadMemoryAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "ReadMemoryAuthenticationError";
  }
}
