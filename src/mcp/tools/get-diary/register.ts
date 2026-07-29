import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DiaryDomainError,
  type DiaryEntryResult,
  type ReadDiaryInput,
} from "../../../domains/diary/diary-service.js";
import { DiaryReadAuthenticationError } from "../search-diary/register.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const getDiaryInputSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .describe("The exact Diary id returned by search_diary."),
  })
  .strict();

const getDiaryOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    date: dateSchema,
    tags: z.array(z.string()),
    mood: z.string().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  }),
});

export interface GetDiaryToolService {
  readDiary(input: ReadDiaryInput): Promise<DiaryEntryResult>;
}

export type GetDiaryToolDependencies = {
  diaryService: GetDiaryToolService;
  getAuthenticatedUserId: () => string;
};

export function registerGetDiaryTool(
  server: McpServer,
  dependencies: GetDiaryToolDependencies,
): void {
  server.registerTool(
    "get_diary",
    {
      title: "Get one diary entry",
      description:
        "Read one authorized diary entry, including its full private content, by the exact id returned from search_diary.",
      inputSchema: getDiaryInputSchema,
      outputSchema: getDiaryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const data = await dependencies.diaryService.readDiary({
          userId,
          id,
        });

        return {
          content: [{ type: "text", text: "Diary entry retrieved." }],
          structuredContent: {
            success: true as const,
            data,
          },
        };
      } catch (error) {
        return toSafeGetDiaryError(error);
      }
    },
  );
}

function toSafeGetDiaryError(error: unknown) {
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
        : error.code === "DIARY_NOT_FOUND"
          ? "Diary entry was not found."
          : "The Diary request is invalid.";

    return {
      isError: true as const,
      content: [{ type: "text" as const, text: message }],
    };
  }

  console.error(
    "get_diary failed",
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
