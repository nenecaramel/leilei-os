import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DiaryDomainError,
  type ListDiariesInput,
  type ListDiariesResult,
} from "../../../domains/diary/diary-service.js";

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
      }),
    ),
    metadata: z.object({
      count: z.number().int().nonnegative(),
    }),
  }),
});

export interface SearchDiaryToolService {
  listDiaries(input: ListDiariesInput): Promise<ListDiariesResult>;
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
        "List authorized diary entries using optional text, exact tag, mood, and inclusive calendar-date filters. This read-only discovery tool intentionally omits full diary content.",
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
        const result = await dependencies.diaryService.listDiaries({
          userId,
          limit,
          query: {
            q: query,
            tag,
            mood,
            dateFrom: date_from,
            dateTo: date_to,
          },
        });
        const data = {
          diaries: result.diaries.map(
            ({
              id,
              title,
              date,
              tags,
              mood: diaryMood,
              created_at,
              updated_at,
              author,
            }) => ({
              id,
              title,
              date,
              tags,
              mood: diaryMood,
              created_at,
              updated_at,
              author,
            }),
          ),
          metadata: result.metadata,
        };

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
