import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  TodoServiceError,
} from "../../../domains/todo/todo-service.js";
import type { TodoDayPapers } from "../../../domains/todo/todo-types.js";

const todoEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(["pending", "completed", "record"]),
  text: z.string(),
});

const todoPaperSchema = z.object({
  author: z.enum(["L", "G"]),
  date: z.string(),
  revision: z.number().int().nonnegative(),
  entries: z.array(todoEntrySchema),
});

const readTodoDayInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const readTodoDayOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    date: z.string(),
    papers: z.object({
      L: todoPaperSchema.nullable(),
      G: todoPaperSchema.nullable(),
    }),
  }),
});

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
        "Read the authenticated user's complete L and G Todo papers for one exact business date from list_todo_dates or another trusted date. Empty author slots are returned as null.",
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
    return {
      isError: true as const,
      content: [{
        type: "text" as const,
        text: "Authentication is required to read Todo.",
      }],
    };
  }
  if (error instanceof TodoServiceError) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: "The Todo request is invalid." }],
    };
  }
  console.error(
    `${toolName} failed`,
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: "Todo is temporarily unavailable." }],
  };
}

export class TodoReadAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "TodoReadAuthenticationError";
  }
}
