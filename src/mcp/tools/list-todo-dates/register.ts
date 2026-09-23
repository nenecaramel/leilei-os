import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  toSafeTodoReadError,
  type ReadTodoDayToolDependencies,
} from "../read-todo-day/register.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { joinMcpContentLines } from "../content-contract.js";
import { decodeMcpPaginationCursor, McpPaginationCursorError, paginateMcpRows } from "../pagination.js";

const listTodoDatesInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50).optional(),
  cursor: z.string().min(1).max(2_048).optional(),
}).strict();
const listTodoDatesOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    dates: z.array(z.string()),
    metadata: z.object({
      returned: z.number().int().nonnegative(),
      has_more: z.boolean(),
      next_cursor: z.string().nullable(),
    }),
  }).optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface ListTodoDatesToolService {
  listDates(userId: string, limit?: number, offset?: number): Promise<string[]>;
}

export type ListTodoDatesToolDependencies = {
  todoService: ListTodoDatesToolService;
  getAuthenticatedUserId: ReadTodoDayToolDependencies["getAuthenticatedUserId"];
};

export function registerListTodoDatesTool(
  server: McpServer,
  dependencies: ListTodoDatesToolDependencies,
): void {
  server.registerTool(
    "list_todo_dates",
    {
      title: "List Todo dates",
      description:
        "Browse the authenticated user's business dates that contain persisted Todo entries. Use read_todo_day with an exact returned date to read the complete L, G, and C papers.",
      inputSchema: listTodoDatesInputSchema,
      outputSchema: listTodoDatesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit, cursor }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const pageSize = limit ?? 50;
        const cursorContext = {};
        const offset = decodeMcpPaginationCursor(cursor, "list_todo_dates", cursorContext);
        const rows = await dependencies.todoService.listDates(
          userId,
          pageSize + 1,
          offset,
        );
        const page = paginateMcpRows({
          rows,
          pageSize,
          offset,
          tool: "list_todo_dates",
          context: cursorContext,
        });
        const dates = page.items;
        return {
          content: [{
            type: "text",
            text: joinMcpContentLines([
              `Found ${dates.length} Todo dates.`,
              ...dates.map((date) => `read_todo_day(date=${date})`),
            ]),
          }],
          structuredContent: {
            success: true as const,
            data: { dates, metadata: page.metadata },
          },
        };
      } catch (error) {
        if (error instanceof McpPaginationCursorError) {
          return createMcpToolError("INVALID_CURSOR", "The Todo date continuation cursor is invalid for this request.");
        }
        return toSafeTodoReadError(error, "list_todo_dates");
      }
    },
  );
}
