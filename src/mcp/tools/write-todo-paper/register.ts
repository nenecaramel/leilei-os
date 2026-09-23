import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MCP_CONTENT_AUTHOR_DESCRIPTION, TODO_DOMAIN_BOUNDARY } from "../model-language.js";
import {
  TodoServiceError,
  type ReplaceTodoPaperIdempotentlyServiceResult,
} from "../../../domains/todo/todo-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { createMcpToolError, mcpErrorRecoveryHint, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { formatMcpDetailPointer, joinMcpContentLines } from "../content-contract.js";
import { mcpMutationReceipt, mcpMutationReceiptFields, mcpMutationOutcomeFromReplay } from "../mutation-contract.js";
import { mcpExpectedNullableRevisionSchema, mcpIdempotencyKeySchema } from "../idempotency-contract.js";

const todoEntryInputSchema = z.object({
  id: z.string(),
  kind: z.enum(["pending", "completed", "record"]),
  text: z.string(),
}).strict();

const todoEntryOutputSchema = z.object({
  id: z.string(),
  kind: z.enum(["pending", "completed", "record"]),
  text: z.string(),
  revision: z.number().int().min(1),
}).strict();

const todoAuthorSchema = z.enum(["L", "G", "C"]);

const todoPaperSchema = z.object({
  author: todoAuthorSchema.describe(MCP_CONTENT_AUTHOR_DESCRIPTION),
  date: z.string(),
  revision: z.number().int().nonnegative(),
  entries: z.array(todoEntryOutputSchema),
});

const writeTodoPaperInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  author: todoAuthorSchema.describe(MCP_CONTENT_AUTHOR_DESCRIPTION),
  expected_revision: mcpExpectedNullableRevisionSchema,
  entries: z.array(todoEntryInputSchema),
  idempotency_key: mcpIdempotencyKeySchema,
}).strict();

const writeTodoPaperDataSchema = z.object({
  paper: todoPaperSchema,
  ...mcpMutationReceiptFields,
});

const writeTodoPaperOutputSchema = z.object({
  success: z.boolean(),
  data: writeTodoPaperDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface WriteTodoPaperToolService {
  replacePaperIdempotently(input: {
    userId: string;
    date: unknown;
    author: unknown;
    revision: unknown;
    entries: unknown;
    idempotencyKey: string;
  }): Promise<ReplaceTodoPaperIdempotentlyServiceResult>;
}

export type WriteTodoPaperToolDependencies = {
  todoService: WriteTodoPaperToolService;
  getAuthenticatedUserId: () => string;
};

const REPLACE_TODO_PAPER_DESCRIPTION =
  TODO_DOMAIN_BOUNDARY + " Replace one complete L/G/C paper using expected_revision from read_todo_day, or null when missing. Use for creation, reorder, or full replacement; use entry tools for single-entry changes. entries is the complete ordered paper.";

export function registerReplaceTodoPaperTool(
  server: McpServer,
  dependencies: WriteTodoPaperToolDependencies,
): void {
  server.registerTool(
    "replace_todo_paper",
    {
      title: "Replace one Todo paper",
      description: REPLACE_TODO_PAPER_DESCRIPTION,
      inputSchema: writeTodoPaperInputSchema,
      outputSchema: writeTodoPaperOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ date, author, expected_revision, entries, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "write_todo_paper",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const data = await dependencies.todoService.replacePaperIdempotently({
            userId,
            date,
            author,
            revision: expected_revision,
            entries,
            idempotencyKey: idempotency_key,
          });
          return {
            content: [{
              type: "text" as const,
              text: joinMcpContentLines([
                data.metadata.idempotent_replay
                  ? "The Todo paper was returned without applying a duplicate write."
                  : "The Todo paper was saved.",
                `Todo ${data.paper.date} author=${data.paper.author} revision=${data.paper.revision}; entries=${data.paper.entries.length}.`,
                formatMcpDetailPointer("read_todo_day", {
                  date: data.paper.date,
                  author: data.paper.author,
                }),
              ]),
            }],
            structuredContent: {
              success: true as const,
              data: {
                paper: data.paper,
                ...mcpMutationReceipt({
                  outcome: mcpMutationOutcomeFromReplay(
                    data.metadata.idempotent_replay,
                  ),
                  entity_type: "todo_paper",
                  entity_id: `${data.paper.date}:${data.paper.author}`,
                  revision: data.paper.revision,
                  detail_tool: "read_todo_day",
                  detail_arguments: {
                    date: data.paper.date,
                    author: data.paper.author,
                  },
                }),
              },
            },
          };
        },
        mapError: (error) => toSafeWriteTodoPaperError(error, { date, author }),
      }),
  );
}

function toSafeWriteTodoPaperError(
  error: unknown,
  context?: { date: string; author: "L" | "G" | "C" },
) {
  if (error instanceof WriteTodoPaperAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to write Todo.",
    );
  }
  if (error instanceof TodoServiceError) {
    const text = error.code === "TODO_PAPER_CONFLICT"
      ? "The Todo paper changed. Read the current paper and retry with its revision."
      : error.code === "IDEMPOTENCY_CONFLICT"
        ? "This idempotency key was already used for different Todo content."
        : "The Todo request is invalid.";
    if (error.code === "TODO_PAPER_CONFLICT" && context) {
      return createMcpToolError(
        error.code,
        text,
        text,
        mcpErrorRecoveryHint({
          retryable: false,
          reason: "stale_revision",
          recommendedTool: "read_todo_day",
          recommendedArguments: context,
        }),
      );
    }
    if (error.code === "IDEMPOTENCY_CONFLICT") {
      return createMcpToolError(
        error.code,
        text,
        text,
        mcpErrorRecoveryHint({
          retryable: false,
          reason: "idempotency_conflict",
        }),
      );
    }
    return createMcpToolError(error.code, text);
  }
  console.error(
    "write_todo_paper failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Todo writing is temporarily unavailable.",
  );
}

export class WriteTodoPaperAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "WriteTodoPaperAuthenticationError";
  }
}
