import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MEMORY_DOMAIN_BOUNDARY } from "../model-language.js";
import {
  MemoryDomainError,
  type ReadMemoryDetailResult,
} from "../../../domains/memory/memory-service.js";
import { ReadMemoryAuthenticationError } from "../read-memory/register.js";
import {
  createMcpToolError,
  mcpErrorRecoveryHint,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import {
  boundedReadInputSchemaFields,
  boundedReadMetadataSchema,
  formatMcpBoundedReadHint,
  McpBoundedReadCursorError,
  sliceMcpBoundedContent,
} from "../bounded-read.js";

const memoryCategorySchema = z.enum([
  "profile",
  "preference",
  "goal",
  "project",
]);
const contentAuthorSchema = z.enum(["L", "G", "C"]);

const getMemoryInputSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .describe("The exact Memory id returned by read_memory, search_memory, or global_search."),
    scope: z.enum(["active", "archived"]).default("active").optional().describe("Defaults to active. active reads only active records; archived reads only archived records."),
    ...boundedReadInputSchemaFields,
  })
  .strict();

const getMemoryDataSchema = z.object({
  id: z.string(),
  category: memoryCategorySchema,
  key: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  source: z.string(),
  updated_at: z.string().datetime(),
  lifecycle_status: z.enum(["active", "archived"]),
  author: contentAuthorSchema.nullable(),
  content_metadata: boundedReadMetadataSchema,
});

const getMemoryOutputSchema = z.object({
  success: z.boolean(),
  data: getMemoryDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

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
        MEMORY_DOMAIN_BOUNDARY + " Read one authenticated Memory by exact ID using a bounded authoritative content window. max_chars defaults to 12000 Unicode code points. When content_metadata.truncated is true, continue with content_metadata.next_cursor and the same id/scope. A cursor becomes invalid if the Memory changes. This is not the primary discovery tool.",
      inputSchema: getMemoryInputSchema,
      outputSchema: getMemoryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, scope = "active", max_chars, cursor }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const detail = scope === "archived"
          ? await dependencies.memoryService.readArchivedMemoryDetail?.({ userId, id }) ?? (() => { throw new Error("Archived Memory reads are unavailable."); })()
          : await dependencies.memoryService.readMemoryDetail({ userId, id });
        const window = sliceMcpBoundedContent({
          content: detail.content,
          maxChars: max_chars,
          cursor,
          tool: "get_memory",
          context: {
            id: detail.id,
            scope,
            updated_at: detail.updated_at,
          },
        });
        const data = {
          ...detail,
          content: window.content,
          lifecycle_status: scope,
          content_metadata: window.metadata,
        };

        return {
          content: [
            {
              type: "text",
              text: joinMcpContentLines([
                `Memory ${quoteMcpText(data.key)} (${data.category}) [id=${data.id}; ${data.lifecycle_status}]`,
                formatMcpBoundedReadHint(window.metadata),
                data.content || "(empty)",
              ]),
            },
          ],
          structuredContent: {
            success: true as const,
            data,
          },
        };
      } catch (error) {
        return toSafeGetMemoryError(error, { id, scope });
      }
    },
  );
}

function toSafeGetMemoryError(
  error: unknown,
  context?: { id: string; scope: "active" | "archived" },
) {
  if (error instanceof McpBoundedReadCursorError) {
    return createMcpToolError(
      "INVALID_CURSOR",
      "The Memory continuation cursor is invalid or stale. Read the Memory again without a cursor.",
      "The Memory continuation cursor is invalid or stale. Read the Memory again without a cursor.",
      mcpErrorRecoveryHint({
        retryable: false,
        reason: "invalid_cursor",
        recommendedTool: context ? "get_memory" : null,
        recommendedArguments: context,
      }),
    );
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
        : error.code === "MEMORY_NOT_FOUND"
          ? "Memory was not found."
          : "The memory request is invalid.";

    return createMcpToolError(error.code, message);
  }

  console.error(
    "get_memory failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Memory is temporarily unavailable.",
  );
}
