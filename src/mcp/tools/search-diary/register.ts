import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DiaryDomainError,
  type SearchDiaryDiscoveryResult,
  type ListDiariesInput,
  type ListDiariesResult,
} from "../../../domains/diary/diary-service.js";
import { createBodyMatchSnippet } from "../../../domains/compact-text.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contentAuthorSchema = z.enum(["L", "G"]);

const searchDiaryInputSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    tag: z.string().trim().min(1).max(50).optional(),
    mood: z.string().trim().min(1).max(50).optional(),
    date_from: dateSchema.optional(),
    date_to: dateSchema.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const searchDiaryOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
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
    }),
  }),
});

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
        "Discover or search authorized Diary entries using optional text, exact tag, mood, and inclusive calendar-date filters. Results are compact and omit full diary content; use get_diary for the complete selected entry.",
      inputSchema: searchDiaryInputSchema,
      outputSchema: searchDiaryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, tag, mood, date_from, date_to, limit }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const input = {
          userId,
          limit,
          query: {
            q: query,
            tag,
            mood,
            dateFrom: date_from,
            dateTo: date_to,
          },
        } satisfies ListDiariesInput;
        const discovery = dependencies.diaryService.searchDiaryDiscovery
          ? await dependencies.diaryService.searchDiaryDiscovery(input)
          : compactFallback(await dependencies.diaryService.listDiaries(input), query ?? "");
        const data = withDetailPointers(discovery);

        return {
          content: [
            {
              type: "text",
              text: `Found ${data.metadata.count} diary entries.`,
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
  if (error instanceof DiaryReadAuthenticationError) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: "Authentication is required to read Diary.",
        },
      ],
    };
  }

  if (error instanceof DiaryDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Diary is unavailable for the authenticated user."
        : "The Diary search is invalid.";

    return {
      isError: true as const,
      content: [{ type: "text" as const, text: message }],
    };
  }

  console.error(
    "search_diary failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: "Diary is temporarily unavailable.",
      },
    ],
  };
}

export class DiaryReadAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "DiaryReadAuthenticationError";
  }
}
