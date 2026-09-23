import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MCP_CONTENT_AUTHOR_DESCRIPTION, TODO_DOMAIN_BOUNDARY } from "../model-language.js";
import {
  TodoServiceError,
  type TodoEntriesMutationServiceResult,
  type TodoEntryDeleteServiceResult,
  type TodoEntryMutationServiceResult,
} from "../../../domains/todo/todo-service.js";
import { createMcpToolError, mcpErrorRecoveryHint, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { formatMcpDetailPointer, joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import { invokeMcpWrite } from "../write-context.js";
import { MAX_TODO_ENTRIES } from "../../../domains/resource-limits.js";
import { mcpExpectedRevisionSchema, mcpIdempotencyKeySchema } from "../idempotency-contract.js";
import { mcpMutationReceipt, mcpMutationReceiptFields, mcpMutationOutcomeFromReplay } from "../mutation-contract.js";

const todoAuthorSchema = z.enum(["L", "G", "C"]);
const todoKindSchema = z.enum(["pending", "completed", "record"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const entryIdSchema = z.string().min(1).max(128);
const entryRevisionSchema = z.number().int().min(1);
const entryTextSchema = z.string().min(1).max(4_000);

const appendInputSchema = z.object({
  date: dateSchema,
  author: todoAuthorSchema.describe(MCP_CONTENT_AUTHOR_DESCRIPTION),
  kind: todoKindSchema,
  text: entryTextSchema,
  idempotency_key: mcpIdempotencyKeySchema,
}).strict();

const appendBatchInputSchema = z.object({
  date: dateSchema,
  author: todoAuthorSchema.describe(MCP_CONTENT_AUTHOR_DESCRIPTION),
  entries: z.array(
    z.object({
      kind: todoKindSchema,
      text: entryTextSchema,
    }).strict(),
  ).min(1).max(MAX_TODO_ENTRIES),
  idempotency_key: mcpIdempotencyKeySchema,
}).strict();

const updateInputSchema = z.object({
  date: dateSchema,
  author: todoAuthorSchema.describe(MCP_CONTENT_AUTHOR_DESCRIPTION),
  entry_id: entryIdSchema,
  expected_revision: mcpExpectedRevisionSchema,
  kind: todoKindSchema.optional(),
  text: entryTextSchema.optional(),
  idempotency_key: mcpIdempotencyKeySchema,
}).strict();

const deleteInputSchema = z.object({
  date: dateSchema,
  author: todoAuthorSchema.describe(MCP_CONTENT_AUTHOR_DESCRIPTION),
  entry_id: entryIdSchema,
  expected_revision: mcpExpectedRevisionSchema,
  idempotency_key: mcpIdempotencyKeySchema,
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
    ...mcpMutationReceiptFields,
  }).optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const batchMutationOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    entries: z.array(
      entrySchema.extend({
        outcome: z.enum(["applied", "replayed"]),
      }).strict(),
    ).min(1).max(MAX_TODO_ENTRIES),
    paper_revision: z.number().int().min(1),
    ...mcpMutationReceiptFields,
  }).optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const deleteOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    entry_id: z.string(),
    deleted: z.literal(true),
    paper_revision: z.number().int().min(1),
    ...mcpMutationReceiptFields,
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
  appendEntriesIdempotently(input: {
    userId: string;
    date: unknown;
    author: unknown;
    entries: unknown;
    idempotencyKey: string;
  }): Promise<TodoEntriesMutationServiceResult>;
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
    "append_todo_entries",
    {
      title: "Append multiple Todo entries",
      description:
        TODO_DOMAIN_BOUNDARY + " Append 1-200 entries atomically to one L/G/C paper with one idempotency_key. The server creates ids/revision=1 and returns per-entry outcome; this does not require the paper revision.",
      inputSchema: appendBatchInputSchema,
      outputSchema: batchMutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ date, author, entries, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "append_todo_entries",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const result = await dependencies.todoService.appendEntriesIdempotently({
            userId,
            date,
            author,
            entries,
            idempotencyKey: idempotency_key,
          });
          return batchMutationSuccess(date, author, result);
        },
        mapError: (error) => toSafeTodoEntryWriteError(error, { date, author }),
      }),
  );

  server.registerTool(
    "append_todo_entry",
    {
      title: "Append one Todo entry",
      description:
        TODO_DOMAIN_BOUNDARY + " Append one entry without resending the paper. The server creates the entry id and revision=1; this does not require the paper revision, so independent appends do not overwrite each other.",
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
        mapError: (error) => toSafeTodoEntryWriteError(error, { date, author }),
      }),
  );

  server.registerTool(
    "update_todo_entry",
    {
      title: "Update one Todo entry",
      description:
        TODO_DOMAIN_BOUNDARY + " Update one entry by entry_id using expected_revision from read_todo_day; only that entry revision is compared. Other entries may change independently. Provide kind and/or text.",
      inputSchema: updateInputSchema,
      outputSchema: mutationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ date, author, entry_id, expected_revision, kind, text, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "update_todo_entry",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          if (kind === undefined && text === undefined) {
            throw new TodoServiceError("TODO_ENTRY_INVALID", "Todo entry update must change kind or text.");
          }
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
        mapError: (error) => toSafeTodoEntryWriteError(error, { date, author }),
      }),
  );

  server.registerTool(
    "delete_todo_entry",
    {
      title: "Delete one Todo entry",
      description:
        TODO_DOMAIN_BOUNDARY + " Delete one entry by entry_id using expected_revision from read_todo_day; only that entry revision is compared. Other entries may change independently.",
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
            ...mcpMutationReceipt({
              outcome: mcpMutationOutcomeFromReplay(
                result.metadata.idempotent_replay,
              ),
              entity_type: "todo_entry",
              entity_id: result.entryId,
              revision: null,
              detail_tool: "read_todo_day",
              detail_arguments: detailArguments,
            }),
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
        mapError: (error) => toSafeTodoEntryWriteError(error, { date, author }),
      }),
  );
}

function batchMutationSuccess(
  date: string,
  author: "L" | "G" | "C",
  result: TodoEntriesMutationServiceResult,
) {
  const detailArguments = { date, author };
  const data = {
    entries: result.entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      revision: entry.revision ?? 1,
      outcome: entry.outcome,
    })),
    paper_revision: result.paperRevision,
    ...mcpMutationReceipt({
      outcome: mcpMutationOutcomeFromReplay(
        result.metadata.idempotent_replay,
      ),
      entity_type: "todo_paper",
      entity_id: `${date}:${author}`,
      revision: result.paperRevision,
      detail_tool: "read_todo_day",
      detail_arguments: detailArguments,
    }),
  };
  return {
    content: [{
      type: "text" as const,
      text: joinMcpContentLines([
        `Todo batch append ${result.metadata.idempotent_replay ? "replayed" : "committed"}: ${data.entries.length} entries.`,
        `paper_revision=${result.paperRevision}`,
        formatMcpDetailPointer("read_todo_day", detailArguments),
      ]),
    }],
    structuredContent: { success: true as const, data },
  };
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
    ...mcpMutationReceipt({
      outcome: mcpMutationOutcomeFromReplay(
        result.metadata.idempotent_replay,
      ),
      entity_type: "todo_entry",
      entity_id: result.entry.id,
      revision: result.entry.revision ?? 1,
      detail_tool: "read_todo_day",
      detail_arguments: detailArguments,
    }),
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

function toSafeTodoEntryWriteError(
  error: unknown,
  context?: { date: string; author: "L" | "G" | "C" },
) {
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
    if (error.code === "TODO_ENTRY_CONFLICT" && context) {
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
