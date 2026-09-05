import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TodoServiceError } from "../../../domains/todo/todo-service.js";
import type { TodoDayPapers } from "../../../domains/todo/todo-types.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";

const todoEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(["pending", "completed", "record"]),
  text: z.string(),
});

const todoAuthorSchema = z.enum(["L", "G", "C"]);

const todoPaperSchema = z.object({
  author: todoAuthorSchema,
  date: z.string(),
  revision: z.number().int().nonnegative(),
  entries: z.array(todoEntrySchema),
});

const readTodoDayInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const readTodoDayDataSchema = z.object({
  date: z.string(),
  papers: z.object({
    L: todoPaperSchema.nullable(),
    G: todoPaperSchema.nullable(),
    C: todoPaperSchema.nullable(),
  }),
});

const readTodoDayOutputSchema = z.object({
  success: z.boolean(),
  data: readTodoDayDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface ReadTodoDayToolService {
  readDay(userId: string, date: string): Promise<{
    date: string;
    papers: TodoDayPapers;
  }>;
}

export type ReadTodoDayToolDependencies = {
  todoService: ReadTodoDayToolService;
  getAuthenticatedUserId: () => string;
};

export function registerReadTodoDayTool(
  server: McpServer,
  dependencies: ReadTodoDayToolDependencies,
): void {
  server.registerTool(
    "read_todo_day",
    {
      title: "Read one Todo day",
      description:
        "Read the authenticated user's complete L, G, and C Todo papers for one exact business date from list_todo_dates or another trusted date. Empty author slots are returned as null.",
      inputSchema: readTodoDayInputSchema,
      outputSchema: readTodoDayOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ date }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const data = await dependencies.todoService.readDay(userId, date);
        return {
          content: [{ type: "text", text: "Todo day retrieved." }],
          structuredContent: { success: true as const, data },
        };
      } catch (error) {
        return toSafeTodoReadError(error, "read_todo_day");
      }
    },
  );
}

export function toSafeTodoReadError(
  error: unknown,
  toolName: "read_todo_day" | "list_todo_dates",
) {
  if (error instanceof TodoReadAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to read Todo.",
    );
  }
  if (error instanceof TodoServiceError) {
    return createMcpToolError(error.code, "The Todo request is invalid.");
  }
  console.error(
    `${toolName} failed`,
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Todo is temporarily unavailable.",
  );
}

export class TodoReadAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "TodoReadAuthenticationError";
  }
}
