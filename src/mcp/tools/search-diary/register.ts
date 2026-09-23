import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DiaryDomainError,
  type SearchDiaryDiscoveryResult,
  type ListDiariesInput,
  type ListDiariesResult,
} from "../../../domains/diary/diary-service.js";
import { createBodyMatchSnippet } from "../../../domains/compact-text.js";
import {
  createMcpToolError,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";
import {
  formatMcpDetailPointer,
  joinMcpContentLines,
  quoteMcpText,
} from "../content-contract.js";
import {
  decodeMcpPaginationCursor,
  McpPaginationCursorError,
  paginateMcpRows,
} from "../pagination.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contentAuthorSchema = z.enum(["L", "G", "C"]);

const searchDiaryInputSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    tag: z.string().trim().min(1).max(50).optional(),
    mood: z.string().trim().min(1).max(50).optional(),
    author: contentAuthorSchema.optional(),
    date_from: dateSchema.optional(),
    date_to: dateSchema.optional(),
    limit: z.number().int().min(1).max(50).default(50).optional(),
    cursor: z.string().min(1).max(2_048).optional(),
  })
  .strict();

const searchDiaryDataSchema = z.object({
  diaries: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      date: dateSchema,
      tags: z.array(z.string()),
      mood: z.string().nullable(),
      created_at: z.string().datetime(),
      updated_at: z.string().datetime(),
      author: contentAuthorSchema.nullable(),
      snippet: z.string().nullable(),
      detail_tool: z.literal("get_diary"),
      detail_arguments: z.object({ id: z.string(), scope: z.literal("active") }),
    }),
  ),
  metadata: z.object({
    count: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
  }),
});

const searchDiaryOutputSchema = z.object({
  success: z.boolean(),
  data: searchDiaryDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface SearchDiaryToolService {
  listDiaries(input: ListDiariesInput): Promise<ListDiariesResult>;
  searchDiaryDiscovery?(input: ListDiariesInput): Promise<SearchDiaryDiscoveryResult>;
}

export type SearchDiaryToolDependencies = {
  diaryService: SearchDiaryToolService;
  getAuthenticatedUserId: () => string;
};

export function registerSearchDiaryTool(
  server: McpServer,
  dependencies: SearchDiaryToolDependencies,
): void {
  server.registerTool(
    "search_diary",
    {
      title: "Search diary entries",
      description:
        "Discover or search authorized Diary entries using optional text, exact tag, mood, author, and inclusive calendar-date filters. Results are compact and omit Diary body content; use get_diary for authoritative bounded detail and continue with its content cursor when needed. When has_more is true, continue this result set by passing next_cursor back as cursor with the same filters.",
      inputSchema: searchDiaryInputSchema,
      outputSchema: searchDiaryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, tag, mood, author, date_from, date_to, limit, cursor }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const pageSize = limit ?? 50;
        const cursorContext = {
          query: query ?? null,
          tag: tag ?? null,
          mood: mood ?? null,
          author: author ?? null,
          date_from: date_from ?? null,
          date_to: date_to ?? null,
        };
        const offset = decodeMcpPaginationCursor(cursor, "search_diary", cursorContext);
        const input = {
          userId,
          limit: pageSize + 1,
          offset,
          query: {
            q: query,
            tag,
            mood,
            author,
            dateFrom: date_from,
            dateTo: date_to,
          },
        } satisfies ListDiariesInput;
        const discovery = dependencies.diaryService.searchDiaryDiscovery
          ? await dependencies.diaryService.searchDiaryDiscovery(input)
          : compactFallback(await dependencies.diaryService.listDiaries(input), query ?? "");
        const withPointers = withDetailPointers(discovery);
        const page = paginateMcpRows({
          rows: withPointers.diaries,
          pageSize,
          offset,
          tool: "search_diary",
          context: cursorContext,
        });
        const data = {
          ...withPointers,
          diaries: page.items,
          metadata: {
            ...withPointers.metadata,
            ...page.metadata,
          },
        };

        return {
          content: [
            {
              type: "text",
              text: diarySearchContent(data),
            },
          ],
          structuredContent: {
            success: true as const,
            data,
          },
        };
      } catch (error) {
        return toSafeSearchDiaryError(error);
      }
    },
  );
}

function diarySearchContent(data: SearchDiaryDiscoveryResult): string {
  const lines = [`Found ${data.metadata.count} diary entries.`];
  for (const diary of data.diaries) {
    const pointer = formatMcpDetailPointer("get_diary", { id: diary.id, scope: "active" });
    const snippet = diary.snippet ? ` — ${quoteMcpText(diary.snippet)}` : "";
    lines.push(`${diary.date} ${quoteMcpText(diary.title)} [id=${diary.id}; ${pointer}]${snippet}`);
  }
  return joinMcpContentLines(lines);
}

function compactFallback(result: ListDiariesResult, query: string): SearchDiaryDiscoveryResult {
  return {
    diaries: result.diaries.map(({ id, title, date, tags, mood, created_at, updated_at, author, content }) => ({
      id,
      title,
      date,
      tags,
      mood,
      created_at,
      updated_at,
      author: author ?? null,
      snippet: createBodyMatchSnippet(content, query),
      detail_tool: "get_diary" as const,
      detail_arguments: { id, scope: "active" as const },
    })),
    metadata: result.metadata,
  };
}

function withDetailPointers(result: SearchDiaryDiscoveryResult): SearchDiaryDiscoveryResult {
  return {
    ...result,
    diaries: result.diaries.map((diary) => ({
      ...diary,
      detail_tool: "get_diary" as const,
      detail_arguments: { id: diary.id, scope: "active" as const },
    })),
  };
}

function toSafeSearchDiaryError(error: unknown) {
  if (error instanceof McpPaginationCursorError) {
    return createMcpToolError("INVALID_CURSOR", "The Diary continuation cursor is invalid for this search.");
  }
  if (error instanceof DiaryReadAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to read Diary.",
    );
  }

  if (error instanceof DiaryDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Diary is unavailable for the authenticated user."
        : "The Diary search is invalid.";

    return createMcpToolError(error.code, message);
  }

  console.error(
    "search_diary failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Diary is temporarily unavailable.",
  );
}

export class DiaryReadAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "DiaryReadAuthenticationError";
  }
}
