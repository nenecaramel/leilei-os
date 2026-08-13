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

const todoEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(["pending", "completed", "record"]),
  text: z.string(),
}).strict();

const todoPaperSchema = z.object({
  author: z.enum(["L", "G"]),
  date: z.string(),
  revision: z.number().int().nonnegative(),
  entries: z.array(todoEntrySchema),
});

const writeTodoPaperInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  author: z.enum(["L", "G"]),
  revision: z.number().int().min(0).nullable(),
  entries: z.array(todoEntrySchema),
  idempotency_key: z.string()
    .min(MCP_IDEMPOTENCY_KEY_MIN_LENGTH)
    .max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH)
    .regex(MCP_IDEMPOTENCY_KEY_PATTERN),
}).strict();

const writeTodoPaperOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    paper: todoPaperSchema,
    metadata: z.object({
      committed: z.boolean(),
      idempotent_replay: z.boolean(),
    }),
  }),
});

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
      title: "Replace one Todo paper",
      description:
        "Replace one complete L or G Todo paper for an exact date after the user approves the full ordered entry list. revision must be null only when creating a missing paper; otherwise pass the exact current revision returned by read_todo_day.",
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
              text: data.metadata.idempotent_replay
                ? "The Todo paper was returned without applying a duplicate write."
                : "The Todo paper was saved.",
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
    return {
      isError: true as const,
      content: [{
        type: "text" as const,
        text: "Authentication is required to write Todo.",
      }],
    };
  }
  if (error instanceof TodoServiceError) {
    const text = error.code === "TODO_PAPER_CONFLICT"
      ? "The Todo paper changed. Read the current paper and retry with its revision."
      : error.code === "IDEMPOTENCY_CONFLICT"
        ? "This idempotency key was already used for different Todo content."
        : "The Todo request is invalid.";
    return {
      isError: true as const,
      content: [{ type: "text" as const, text }],
    };
  }
  console.error(
    "write_todo_paper failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text: "Todo writing is temporarily unavailable.",
    }],
  };
}

export class WriteTodoPaperAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "WriteTodoPaperAuthenticationError";
  }
}
