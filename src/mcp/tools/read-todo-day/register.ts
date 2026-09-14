import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TodoServiceError } from "../../../domains/todo/todo-service.js";
import type { TodoDayPapers } from "../../../domains/todo/todo-types.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const todoEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(["pending", "completed", "record"]),
  text: z.string(),
  revision: z.number().int().min(1).optional(),
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
  author: todoAuthorSchema.optional(),
}).strict();

const readTodoDayDataSchema = z.object({
  date: z.string(),
  author: todoAuthorSchema.optional(),
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
        "Read Todo papers for one exact business date. Without author, return the complete L, G, and C papers; when the user specifies author (L, G, or C), return only that author's paper. Empty or missing papers are returned as null.",
      inputSchema: readTodoDayInputSchema,
      outputSchema: readTodoDayOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ date, author }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const data = await dependencies.todoService.readDay(userId, date);
        const scopedData = author
          ? {
              date: data.date,
              author,
              papers: {
                L: author === "L" ? data.papers.L : null,
                G: author === "G" ? data.papers.G : null,
                C: author === "C" ? data.papers.C : null,
              },
            }
          : data;
        return {
          content: [{ type: "text", text: todoDayContent(scopedData) }],
          structuredContent: { success: true as const, data: scopedData },
        };
      } catch (error) {
        return toSafeTodoReadError(error, "read_todo_day");
      }
    },
  );
}

function todoDayContent(data: {
  date: string;
  author?: "L" | "G" | "C";
  papers: TodoDayPapers;
}): string {
  const lines = [`Todo ${data.date}`];
  let paperCount = 0;
  for (const author of ["L", "G", "C"] as const) {
    const paper = data.papers[author];
    if (!paper) continue;
    paperCount += 1;
    lines.push(`${author} paper (revision ${paper.revision})`);
    if (paper.entries.length === 0) {
      lines.push(`${author}: empty`);
      continue;
    }
    for (const entry of paper.entries) {
      lines.push(`${author} [${entry.id}; revision=${entry.revision ?? 1}] ${entry.kind}: ${quoteMcpText(entry.text)}`);
    }
  }
  if (paperCount === 0) {
    lines.push(data.author ? `${data.author} paper: missing` : "empty");
  }
  return joinMcpContentLines(lines);
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
