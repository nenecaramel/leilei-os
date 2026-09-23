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
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import {
  boundedReadInputSchemaFields,
  boundedReadMetadataSchema,
  McpBoundedReadCursorError,
  sliceMcpBoundedContent,
} from "../bounded-read.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contentAuthorSchema = z.enum(["L", "G", "C"]);

const getDiaryInputSchema = z
  .object({
    id: z
      .string()
      .trim()
      .uuid()
      .describe("The exact Diary id returned by search_diary or global_search."),
    scope: z.enum(["active", "archived"]).default("active").optional().describe("Defaults to active. active reads only active records; archived reads only archived records."),
    ...boundedReadInputSchemaFields,
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
  content_metadata: boundedReadMetadataSchema,
  comments_tool: z.literal("list_diary_comments"),
  comments_arguments: z.object({
    diary_id: z.string().uuid(),
    scope: z.enum(["active", "archived"]),
  }).strict(),
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
        "Read one authenticated Diary entry by exact ID using a bounded authoritative content window. max_chars defaults to 12000 Unicode code points. When content_metadata.truncated is true, continue with content_metadata.next_cursor and the same id/scope. A cursor becomes invalid if the Diary changes. Comments are not embedded; use the returned list_diary_comments pointer.",
      inputSchema: getDiaryInputSchema,
      outputSchema: getDiaryOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, scope = "active", max_chars, cursor }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const detail = scope === "archived"
          ? await dependencies.diaryService.readArchivedDiary?.({ userId, id }) ?? (() => { throw new Error("Archived Diary reads are unavailable."); })()
          : await dependencies.diaryService.readDiary({ userId, id });
        const window = sliceMcpBoundedContent({
          content: detail.content,
          maxChars: max_chars,
          cursor,
          tool: "get_diary",
          context: {
            id: detail.id,
            scope,
            updated_at: detail.updated_at,
          },
        });
        const commentsArguments = { diary_id: detail.id, scope };
        const data = {
          ...detail,
          content: window.content,
          lifecycle_status: scope,
          content_metadata: window.metadata,
          comments_tool: "list_diary_comments" as const,
          comments_arguments: commentsArguments,
        };

        return {
          content: [{
            type: "text",
            text: joinMcpContentLines([
              `Diary ${quoteMcpText(data.title)} (${data.date}) [id=${data.id}]`,
              data.content || "(empty)",
              `Comments: list_diary_comments(diary_id=${detail.id}, scope=${scope})`,
            ]),
          }],
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
  if (error instanceof McpBoundedReadCursorError) {
    return createMcpToolError(
      "INVALID_CURSOR",
      "The Diary continuation cursor is invalid or stale. Read the Diary again without a cursor.",
    );
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
        : error.code === "DIARY_NOT_FOUND"
          ? "Diary entry was not found."
          : error.code === "INVALID_DIARY_ID"
            ? "Invalid argument: id must be a Diary UUID returned by search_diary or global_search."
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
