import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TodoServiceError } from "../../../domains/todo/todo-service.js";
import type { TodoSearchResult } from "../../../domains/todo/todo-types.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { formatMcpDetailPointer, joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import { TodoReadAuthenticationError } from "../read-todo-day/register.js";
import { decodeMcpPaginationCursor, McpPaginationCursorError, paginateMcpRows } from "../pagination.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const authorSchema = z.enum(["L", "G", "C"]);
const kindSchema = z.enum(["pending", "completed", "record"]);
const inputSchema = z.object({
  query: z.string().max(400).refine((value) => {
    const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
    return normalized.length > 0 && [...normalized].length <= 200;
  }, "Query must contain 1 to 200 Unicode code points after normalization and trimming.").describe("Required text to search Todo entry text (1–200 Unicode code points after normalization)."),
  author: authorSchema.optional().describe("Optional Todo paper author."),
  kind: kindSchema.optional().describe("Optional entry kind filter."),
  date_from: dateSchema.optional().describe("Inclusive business-date lower bound."),
  date_to: dateSchema.optional().describe("Inclusive business-date upper bound."),
  limit: z.number().int().min(1).max(50).default(50).optional().describe("Maximum compact entries to return. Defaults to 50."),
  cursor: z.string().min(1).max(2_048).optional().describe("Opaque continuation cursor returned by the previous search_todo call."),
}).strict();

const entrySchema = z.object({
  entry_id: z.string(),
  date: dateSchema,
  author: authorSchema,
  kind: kindSchema,
  text: z.string(),
  snippet: z.string(),
  detail_tool: z.literal("read_todo_day"),
  detail_arguments: z.object({ date: dateSchema }).strict(),
}).strict();
const dataSchema = z.object({
  entries: z.array(entrySchema).max(50),
  metadata: z.object({
    count: z.number().int().min(0).max(50),
    author: authorSchema.nullable(),
    returned: z.number().int().nonnegative(),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
  }).strict(),
}).strict();
const outputSchema = z.object({ success: z.boolean(), data: dataSchema.optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();

export interface SearchTodoToolService {
  search(input: {
    userId: string;
    query: unknown;
    author?: unknown;
    kind?: unknown;
    date_from?: unknown;
    date_to?: unknown;
    limit?: unknown;
    offset?: unknown;
  }): Promise<TodoSearchResult>;
}

export type SearchTodoToolDependencies = { todoService: SearchTodoToolService; getAuthenticatedUserId: () => string };

export function registerSearchTodoTool(server: McpServer, dependencies: SearchTodoToolDependencies): void {
  server.registerTool("search_todo", {
    title: "Search Todo entries",
    description: "Search the authenticated user's Todo entry text across dates. Results are compact discovery records with date, author, kind, matched text, and a snippet; use read_todo_day with the returned date for the complete paper. Optional author, kind, and inclusive date filters narrow the search. With an author filter, metadata.author echoes that author even when no paper exists (count 0).",
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ query, author, kind, date_from, date_to, limit, cursor }) => {
    try {
      const pageSize = limit ?? 50;
      const cursorContext = {
        query,
        author: author ?? null,
        kind: kind ?? null,
        date_from: date_from ?? null,
        date_to: date_to ?? null,
      };
      const offset = decodeMcpPaginationCursor(cursor, "search_todo", cursorContext);
      const data = await dependencies.todoService.search({
        userId: dependencies.getAuthenticatedUserId(),
        query, author, kind, date_from, date_to,
        limit: pageSize + 1,
        offset,
      });
      const page = paginateMcpRows({
        rows: data.entries,
        pageSize,
        offset,
        tool: "search_todo",
        context: cursorContext,
      });
      const entries = page.items.map((entry) => ({
        ...entry,
        detail_tool: "read_todo_day" as const,
        detail_arguments: { date: entry.date },
      }));
      const output = {
        entries,
        metadata: {
          count: page.items.length,
          author: data.metadata.author,
          ...page.metadata,
        },
      };
      return {
        content: [{ type: "text" as const, text: todoSearchContent(output) }],
        structuredContent: { success: true as const, data: output },
      };
    } catch (error) {
      if (error instanceof McpPaginationCursorError) return createMcpToolError("INVALID_CURSOR", "The Todo continuation cursor is invalid for this search.");
      if (error instanceof TodoReadAuthenticationError) return createMcpToolError("AUTHENTICATION_REQUIRED", "Authentication is required to search Todo.");
      if (error instanceof TodoServiceError) {
        const unavailable = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND";
        return createMcpToolError(error.code, unavailable ? "Todo is unavailable for the authenticated user." : "The Todo search request is invalid.");
      }
      console.error("search_todo failed", error instanceof Error ? error.name : "UnknownError");
      return createMcpToolError("INTERNAL_ERROR", "Todo is temporarily unavailable.");
    }
  });
}

function todoSearchContent(data: { entries: Array<{ entry_id: string; date: string; author: string; kind: string; snippet: string; detail_arguments: { date: string } }>; metadata: { count: number; author: string | null; returned: number; has_more: boolean; next_cursor: string | null } }): string {
  const lines = [data.metadata.author ? `Found ${data.metadata.count} Todo entries for author ${data.metadata.author}.` : `Found ${data.metadata.count} Todo entries.`];
  for (const entry of data.entries) {
    lines.push(`${entry.date} ${entry.author} ${entry.kind} [entry_id=${entry.entry_id}; ${formatMcpDetailPointer("read_todo_day", entry.detail_arguments)}] — ${quoteMcpText(entry.snippet)}`);
  }
  return joinMcpContentLines(lines);
}
