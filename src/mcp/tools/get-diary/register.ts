import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DiaryDomainError,
  type DiaryEntryResult,
  type ReadDiaryInput,
} from "../../../domains/diary/diary-service.js";
import { DiaryReadAuthenticationError } from "../search-diary/register.js";
import {
  createMcpToolError,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contentAuthorSchema = z.enum(["L", "G"]);

const getDiaryInputSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .describe("The exact Diary id returned by search_diary or global_search."),
    scope: z.enum(["active", "archived"]).default("active").optional().describe("Defaults to active. active reads only active records; archived reads only archived records."),
  })
  .strict();

const getDiaryDataSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  date: dateSchema,
  tags: z.array(z.string()),
  mood: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  lifecycle_status: z.enum(["active", "archived"]),
  author: contentAuthorSchema.nullable(),
});

const getDiaryOutputSchema = z.object({
  success: z.boolean(),
  data: getDiaryDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface GetDiaryToolService {
  readDiary(input: ReadDiaryInput): Promise<DiaryEntryResult>;
  readArchivedDiary?(input: ReadDiaryInput): Promise<DiaryEntryResult>;
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
        "Read one authenticated, authorized Diary entry by exact ID from search_diary or global_search, including full private content. scope defaults to active. scope=active reads only active records and cannot read archived records; scope=archived reads only archived records and cannot read active records.",
      inputSchema: getDiaryInputSchema,
      outputSchema: getDiaryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, scope = "active" }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const detail = scope === "archived"
          ? await dependencies.diaryService.readArchivedDiary?.({ userId, id }) ?? (() => { throw new Error("Archived Diary reads are unavailable."); })()
          : await dependencies.diaryService.readDiary({ userId, id });
        const data = { ...detail, lifecycle_status: scope };

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
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to read Diary.",
    );
  }

  if (error instanceof DiaryDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Diary is unavailable for the authenticated user."
        : error.code === "DIARY_NOT_FOUND"
          ? "Diary entry was not found."
          : "The Diary request is invalid.";

    return createMcpToolError(error.code, message);
  }

  console.error(
    "get_diary failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Diary is temporarily unavailable.",
  );
}
