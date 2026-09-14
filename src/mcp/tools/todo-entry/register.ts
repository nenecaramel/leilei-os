import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MCP_IDEMPOTENCY_KEY_MAX_LENGTH,
  MCP_IDEMPOTENCY_KEY_MIN_LENGTH,
  MCP_IDEMPOTENCY_KEY_PATTERN,
} from "../../../domains/mcp-write/mcp-write-idempotency.js";
import {
  TodoServiceError,
  type TodoEntryDeleteServiceResult,
  type TodoEntryMutationServiceResult,
} from "../../../domains/todo/todo-service.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { formatMcpDetailPointer, joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import { invokeMcpWrite } from "../write-context.js";

const todoAuthorSchema = z.enum(["L", "G", "C"]);
const todoKindSchema = z.enum(["pending", "completed", "record"]);
const idempotencyKeySchema = z.string()
  .min(MCP_IDEMPOTENCY_KEY_MIN_LENGTH)
  .max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH)
  .regex(MCP_IDEMPOTENCY_KEY_PATTERN);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const entryIdSchema = z.string().min(1).max(128);
const entryRevisionSchema = z.number().int().min(1);
const entryTextSchema = z.string().min(1).max(4_000);

const appendInputSchema = z.object({
  date: dateSchema,
  author: todoAuthorSchema,
  kind: todoKindSchema,
  text: entryTextSchema,
  idempotency_key: idempotencyKeySchema,
}).strict();

const updateInputSchema = z.object({
  date: dateSchema,
  author: todoAuthorSchema,
  entry_id: entryIdSchema,
  expected_revision: entryRevisionSchema,
  kind: todoKindSchema.optional(),
  text: entryTextSchema.optional(),
  idempotency_key: idempotencyKeySchema,
}).strict().refine((value) => value.kind !== undefined || value.text !== undefined, {
  message: "kind or text is required",
});

const deleteInputSchema = z.object({
  date: dateSchema,
  author: todoAuthorSchema,
  entry_id: entryIdSchema,
  expected_revision: entryRevisionSchema,
  idempotency_key: idempotencyKeySchema,
}).strict();

const entrySchema = z.object({
  id: z.string(),
  kind: todoKindSchema,
  text: z.string(),
  revision: entryRevisionSchema,
}).strict();

const mutationOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    entry: entrySchema,
    paper_revision: z.number().int().min(1),
    metadata: z.object({
      committed: z.boolean(),
      idempotent_replay: z.boolean(),
    }).strict(),
    detail_tool: z.literal("read_todo_day"),
    detail_arguments: z.object({
      date: dateSchema,
      author: todoAuthorSchema,
    }).strict(),
  }).optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const deleteOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    entry_id: z.string(),
    deleted: z.literal(true),
    paper_revision: z.number().int().min(1),
    metadata: z.object({
      committed: z.boolean(),
      idempotent_replay: z.boolean(),
    }).strict(),
    detail_tool: z.literal("read_todo_day"),
    detail_arguments: z.object({
      date: dateSchema,
      author: todoAuthorSchema,
    }).strict(),
  }).optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface TodoEntryWriteToolService {
  appendEntryIdempotently(input: {
    userId: string;
    date: unknown;
    author: unknown;
    kind: unknown;
    text: unknown;
    idempotencyKey: string;
  }): Promise<TodoEntryMutationServiceResult>;
  updateEntryIdempotently(input: {
    userId: string;
    date: unknown;
    author: unknown;
    entryId: unknown;
    expectedRevision: unknown;
    kind?: unknown;
    text?: unknown;
    idempotencyKey: string;
  }): Promise<TodoEntryMutationServiceResult>;
  deleteEntryIdempotently(input: {
    userId: string;
    date: unknown;
    author: unknown;
    entryId: unknown;
    expectedRevision: unknown;
    idempotencyKey: string;
  }): Promise<TodoEntryDeleteServiceResult>;
}

export type TodoEntryWriteToolDependencies = {
  todoService: TodoEntryWriteToolService;
  getAuthenticatedUserId: () => string;
};

export function registerTodoEntryWriteTools(
  server: McpServer,
  dependencies: TodoEntryWriteToolDependencies,
): void {
  server.registerTool(
    "append_todo_entry",
    {
      title: "Append one Todo entry",
      description:
        "Append one entry to an exact L, G, or C Todo paper without resending the whole paper. The server creates the entry id and entry revision=1. This operation does not require the paper revision, so independent appends do not overwrite other entries. Use a stable idempotency_key for safe replay.",
      inputSchema: appendInputSchema,
      outputSchema: mutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ date, author, kind, text, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "append_todo_entry",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const result = await dependencies.todoService.appendEntryIdempotently({
            userId,
            date,
            author,
            kind,
            text,
            idempotencyKey: idempotency_key,
          });
          return mutationSuccess("append", date, author, result);
        },
        mapError: toSafeTodoEntryWriteError,
      }),
  );

  server.registerTool(
    "update_todo_entry",
    {
      title: "Update one Todo entry",
      description:
        "Update one exact Todo entry by entry_id. Supply expected_revision from read_todo_day; only that entry revision is compared. Other entries may change independently without causing this update to fail. kind and text are partial fields; provide at least one. Use a stable idempotency_key for safe replay.",
      inputSchema: updateInputSchema,
      outputSchema: mutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ date, author, entry_id, expected_revision, kind, text, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "update_todo_entry",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const result = await dependencies.todoService.updateEntryIdempotently({
            userId,
            date,
            author,
            entryId: entry_id,
            expectedRevision: expected_revision,
            kind,
            text,
            idempotencyKey: idempotency_key,
          });
          return mutationSuccess("update", date, author, result);
        },
        mapError: toSafeTodoEntryWriteError,
      }),
  );

  server.registerTool(
    "delete_todo_entry",
    {
      title: "Delete one Todo entry",
      description:
        "Delete one exact Todo entry by entry_id. Supply expected_revision from read_todo_day; only that entry revision is compared. Other entries may change independently without causing this delete to fail. Use a stable idempotency_key for safe replay.",
      inputSchema: deleteInputSchema,
      outputSchema: deleteOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ date, author, entry_id, expected_revision, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "delete_todo_entry",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const result = await dependencies.todoService.deleteEntryIdempotently({
            userId,
            date,
            author,
            entryId: entry_id,
            expectedRevision: expected_revision,
            idempotencyKey: idempotency_key,
          });
          const detailArguments = { date, author };
          const data = {
            entry_id: result.entryId,
            deleted: true as const,
            paper_revision: result.paperRevision,
            metadata: result.metadata,
            detail_tool: "read_todo_day" as const,
            detail_arguments: detailArguments,
          };
          return {
            content: [{
              type: "text" as const,
              text: joinMcpContentLines([
                `Todo entry ${result.metadata.idempotent_replay ? "delete replayed" : "deleted"}: ${result.entryId}.`,
                `paper_revision=${result.paperRevision}`,
                formatMcpDetailPointer("read_todo_day", detailArguments),
              ]),
            }],
            structuredContent: { success: true as const, data },
          };
        },
        mapError: toSafeTodoEntryWriteError,
      }),
  );
}

function mutationSuccess(
  operation: "append" | "update",
  date: string,
  author: "L" | "G" | "C",
  result: TodoEntryMutationServiceResult,
) {
  const detailArguments = { date, author };
  const data = {
    entry: {
      id: result.entry.id,
      kind: result.entry.kind,
      text: result.entry.text,
      revision: result.entry.revision ?? 1,
    },
    paper_revision: result.paperRevision,
    metadata: result.metadata,
    detail_tool: "read_todo_day" as const,
    detail_arguments: detailArguments,
  };
  return {
    content: [{
      type: "text" as const,
      text: joinMcpContentLines([
        `Todo entry ${result.metadata.idempotent_replay ? `${operation} replayed` : `${operation} committed`}: [${data.entry.id}] ${data.entry.kind} revision=${data.entry.revision} ${quoteMcpText(data.entry.text)}`,
        `paper_revision=${result.paperRevision}`,
        formatMcpDetailPointer("read_todo_day", detailArguments),
      ]),
    }],
    structuredContent: { success: true as const, data },
  };
}

function toSafeTodoEntryWriteError(error: unknown) {
  if (error instanceof TodoEntryWriteAuthenticationError) {
    return createMcpToolError("AUTHENTICATION_REQUIRED", "Authentication is required to write Todo.");
  }
  if (error instanceof TodoServiceError) {
    const text =
      error.code === "TODO_ENTRY_CONFLICT"
        ? "The Todo entry changed. Read the current Todo day and retry with that entry's revision."
        : error.code === "TODO_ENTRY_NOT_FOUND"
          ? "The Todo entry was not found."
          : error.code === "TODO_ENTRY_LIMIT"
            ? "The Todo paper already has the maximum number of entries."
            : error.code === "IDEMPOTENCY_CONFLICT"
              ? "This idempotency key was already used for a different Todo entry mutation."
              : "The Todo entry request is invalid.";
    return createMcpToolError(error.code, text);
  }
  console.error(
    "Todo entry write failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError("INTERNAL_ERROR", "Todo writing is temporarily unavailable.");
}

export class TodoEntryWriteAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "TodoEntryWriteAuthenticationError";
  }
}
