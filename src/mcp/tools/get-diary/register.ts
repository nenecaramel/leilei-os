import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DiaryDomainError,
  type DiaryEntryResult,
  type ReadDiaryInput,
} from "../../../domains/diary/diary-service.js";
import { DiaryReadAuthenticationError } from "../search-diary/register.js";
import {
  DiaryCommentDomainError,
  type ListDiaryCommentsResult,
} from "../../../domains/diary/diary-comment-service.js";
import {
  createMcpToolError,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contentAuthorSchema = z.enum(["L", "G", "C"]);

const diaryCommentSchema = z.object({
  id: z.string().uuid(),
  diary_id: z.string().uuid(),
  author: contentAuthorSchema,
  content: z.string(),
  revision: z.number().int().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict();

const diaryCommentsMetadataSchema = z.object({
  count: z.number().int().min(0),
  returned: z.number().int().min(0),
  truncated: z.boolean(),
}).strict();

const getDiaryInputSchema = z
  .object({
    id: z
      .string()
      .trim()
      .uuid()
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
  comments: z.array(diaryCommentSchema).optional(),
  comments_metadata: diaryCommentsMetadataSchema.optional(),
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
  diaryCommentService?: {
    listComments(input: {
      userId: string;
      diaryId: string;
      scope?: "active" | "archived";
      limit?: number;
      before?: string;
    }): Promise<ListDiaryCommentsResult>;
  };
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
        "Read one authenticated, authorized Diary entry by exact ID from search_diary or global_search, including full private content and up to the 50 most recent canonical Diary comments. comments_metadata.truncated tells you when older comments remain; use list_diary_comments to continue. scope defaults to active. scope=active reads only active records and cannot read archived records; scope=archived reads only archived records and cannot read active records.",
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
        const commentPage = dependencies.diaryCommentService
          ? await dependencies.diaryCommentService.listComments({
              userId,
              diaryId: detail.id,
              scope,
              limit: 50,
            })
          : undefined;
        const commentsMetadata = commentPage
          ? {
              count: commentPage.metadata.count,
              returned: commentPage.metadata.returned,
              truncated:
                commentPage.metadata.count >
                commentPage.metadata.returned,
            }
          : undefined;
        const data = {
          ...detail,
          lifecycle_status: scope,
          ...(commentPage
            ? {
                comments: commentPage.comments,
                comments_metadata: commentsMetadata,
              }
            : {}),
        };

        const commentLines = commentPage
          ? [
              `Comments (${commentPage.metadata.count})`,
              ...commentPage.comments.flatMap((comment) => [
                `${comment.author} · ${comment.created_at} [comment_id=${comment.id}; revision=${comment.revision}]`,
                comment.content,
              ]),
              ...(commentsMetadata?.truncated
                ? [`Only ${commentPage.metadata.returned} of ${commentPage.metadata.count} comments are included. Use list_diary_comments to read older comments.`]
                : []),
            ]
          : [];

        return {
          content: [{
            type: "text",
            text: joinMcpContentLines([
              `Diary ${quoteMcpText(data.title)} (${data.date}) [id=${data.id}]`,
              data.content,
              ...commentLines,
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
  if (error instanceof DiaryReadAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to read Diary.",
    );
  }

  if (error instanceof DiaryCommentDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Diary is unavailable for the authenticated user."
        : error.code === "DIARY_NOT_FOUND"
          ? "Diary entry was not found."
          : "Diary comments are temporarily unavailable.";
    return createMcpToolError(error.code, message);
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
