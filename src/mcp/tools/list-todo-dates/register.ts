import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  toSafeTodoReadError,
  type ReadTodoDayToolDependencies,
} from "../read-todo-day/register.js";
import { mcpToolErrorDetailsSchema } from "../error-contract.js";
import { joinMcpContentLines } from "../content-contract.js";

const listTodoDatesInputSchema = z.object({}).strict();
const listTodoDatesOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({ dates: z.array(z.string()) }).optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface ListTodoDatesToolService {
  listDates(userId: string): Promise<string[]>;
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
    async () => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const dates = await dependencies.todoService.listDates(userId);
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
            data: { dates },
          },
        };
      } catch (error) {
        return toSafeTodoReadError(error, "list_todo_dates");
      }
    },
  );
}
