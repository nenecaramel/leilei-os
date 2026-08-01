import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MemoryDomainError,
  type ReadMemoryDetailResult,
} from "../../../domains/memory/memory-service.js";
import { ReadMemoryAuthenticationError } from "../read-memory/register.js";

const memoryCategorySchema = z.enum([
  "profile",
  "preference",
  "goal",
  "project",
]);

const getMemoryInputSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .describe("The exact Memory id returned by another Memory read tool."),
    scope: z.enum(["active", "archived"]).default("active").optional(),
  })
  .strict();

const getMemoryOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string(),
    category: memoryCategorySchema,
    key: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
    source: z.string(),
    updated_at: z.string().datetime(),
    lifecycle_status: z.enum(["active", "archived"]),
  }),
});

export interface GetMemoryToolService {
  readMemoryDetail(input: {
    userId: string;
    id: string;
  }): Promise<ReadMemoryDetailResult>;
  readArchivedMemoryDetail?(input: { userId: string; id: string }): Promise<ReadMemoryDetailResult>;
}

export type GetMemoryToolDependencies = {
  memoryService: GetMemoryToolService;
  getAuthenticatedUserId: () => string;
};

export function registerGetMemoryTool(
  server: McpServer,
  dependencies: GetMemoryToolDependencies,
): void {
  server.registerTool(
    "get_memory",
    {
      title: "Get one Memory",
      description:
        "Read one authorized active Memory record by its exact id. This tool is read-only and cannot access archived or non-assistant-visible records.",
      inputSchema: getMemoryInputSchema,
      outputSchema: getMemoryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, scope = "active" }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const detail = scope === "archived"
          ? await dependencies.memoryService.readArchivedMemoryDetail?.({ userId, id }) ?? (() => { throw new Error("Archived Memory reads are unavailable."); })()
          : await dependencies.memoryService.readMemoryDetail({ userId, id });
        const data = { ...detail, lifecycle_status: scope };

        return {
          content: [
            {
              type: "text",
              text: "Memory retrieved.",
            },
          ],
          structuredContent: {
            success: true as const,
            data,
          },
        };
      } catch (error) {
        return toSafeGetMemoryError(error);
      }
    },
  );
}

function toSafeGetMemoryError(error: unknown) {
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
        : error.code === "MEMORY_NOT_FOUND"
          ? "Memory was not found."
          : "The memory request is invalid.";

    return {
      isError: true as const,
      content: [{ type: "text" as const, text: message }],
    };
  }

  console.error(
    "get_memory failed",
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
