import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MCP_IDEMPOTENCY_KEY_MAX_LENGTH,
  MCP_IDEMPOTENCY_KEY_MIN_LENGTH,
  MCP_IDEMPOTENCY_KEY_PATTERN,
} from "../../../domains/mcp-write/mcp-write-idempotency.js";
import {
  TodoServiceError,
  type ReplaceTodoPaperIdempotentlyServiceResult,
} from "../../../domains/todo/todo-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { joinMcpContentLines } from "../content-contract.js";

const todoEntryInputSchema = z.object({
  id: z.string(),
  kind: z.enum(["pending", "completed", "record"]),
  text: z.string(),
  revision: z.number().int().min(1).optional(),
}).strict();

const todoEntryOutputSchema = z.object({
  id: z.string(),
  kind: z.enum(["pending", "completed", "record"]),
  text: z.string(),
  revision: z.number().int().min(1),
}).strict();

const todoAuthorSchema = z.enum(["L", "G", "C"]);

const todoPaperSchema = z.object({
  author: todoAuthorSchema,
  date: z.string(),
  revision: z.number().int().nonnegative(),
  entries: z.array(todoEntryOutputSchema),
});

const writeTodoPaperInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  author: todoAuthorSchema,
  revision: z.number().int().min(0).nullable(),
  entries: z.array(todoEntryInputSchema),
  idempotency_key: z.string()
    .min(MCP_IDEMPOTENCY_KEY_MIN_LENGTH)
    .max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH)
    .regex(MCP_IDEMPOTENCY_KEY_PATTERN),
}).strict();

const writeTodoPaperDataSchema = z.object({
  paper: todoPaperSchema,
  metadata: z.object({
    committed: z.boolean(),
    idempotent_replay: z.boolean(),
  }),
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

export function registerWriteTodoPaperTool(
  server: McpServer,
  dependencies: WriteTodoPaperToolDependencies,
): void {
  server.registerTool(
    "write_todo_paper",
    {
      title: "Save one Todo paper",
      description:
        "Replace one complete L, G, or C Todo paper. Use this for initial whole-paper creation or intentional whole-paper reorder/replacement. For adding, editing, completing, or deleting a single entry, prefer append_todo_entry, update_todo_entry, or delete_todo_entry so unrelated concurrent entries are not overwritten. Supply an exact YYYY-MM-DD date, the logical author, the exact current paper revision returned by read_todo_day (or null only when creating a missing paper), and a complete ordered array where every item is {\"id\":\"todo-1\",\"kind\":\"pending\",\"text\":\"...\"}. kind must be exactly one of \"pending\", \"completed\", or \"record\". The authenticated user is assigned by the server.",
      inputSchema: writeTodoPaperInputSchema,
      outputSchema: writeTodoPaperOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ date, author, revision, entries, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "write_todo_paper",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const data = await dependencies.todoService.replacePaperIdempotently({
            userId,
            date,
            author,
            revision,
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
              ]),
            }],
            structuredContent: { success: true as const, data },
          };
        },
        mapError: toSafeWriteTodoPaperError,
      }),
  );
}

function toSafeWriteTodoPaperError(error: unknown) {
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
