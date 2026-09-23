import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DIARY_COMMENT_CONTENT_MAX_CODE_POINTS,
  DiaryCommentDomainError,
  type AddDiaryCommentResult,
  type DiaryCommentResult,
  type DiaryCommentService,
  type ListDiaryCommentsResult,
} from "../../../domains/diary/diary-comment-service.js";
import { invokeMcpWrite } from "../write-context.js";
import {
  createMcpToolError,
  mcpErrorRecoveryHint,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";
import {
  joinMcpContentLines,
  quoteMcpText,
} from "../content-contract.js";
import {
  mcpMutationReceipt,
  mcpMutationReceiptFields,
  mcpMutationOutcomeFromReplay,
} from "../mutation-contract.js";

const idSchema = z.string().trim().uuid();
const contentAuthorSchema = z.enum(["L", "G", "C"]);
const scopeSchema = z.enum(["active", "archived"]);
const commentContentSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      Array.from(value.normalize("NFC").trim()).length <=
      DIARY_COMMENT_CONTENT_MAX_CODE_POINTS,
    {
      message: `Comment content must not exceed ${DIARY_COMMENT_CONTENT_MAX_CODE_POINTS} Unicode code points.`,
    },
  );

const commentSchema = z.object({
  id: idSchema,
  diary_id: idSchema,
  author: contentAuthorSchema,
  content: z.string(),
  revision: z.number().int().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict();

const addInputSchema = z.object({
  diary_id: idSchema.describe("Exact Diary id returned by search_diary, get_diary, or global_search."),
  author: contentAuthorSchema.describe("Logical author of this comment: L, G, or C. Author is immutable after creation."),
  content: commentContentSchema.describe("Complete comment text. The server NFC-normalizes and trims it."),
  idempotency_key: z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/).describe("Stable unique key that prevents duplicate comment creation."),
}).strict();

const addOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    comment: commentSchema,
    ...mcpMutationReceiptFields,
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const getInputSchema = z.object({
  id: idSchema.describe("Exact Diary comment id."),
  scope: scopeSchema.default("active").optional().describe("Parent Diary lifecycle scope. Defaults to active."),
}).strict();

const getOutputSchema = z.object({
  success: z.boolean(),
  data: commentSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const listInputSchema = z.object({
  diary_id: idSchema.describe("Exact parent Diary id."),
  scope: scopeSchema.default("active").optional().describe("Parent Diary lifecycle scope. Defaults to active."),
  limit: z.number().int().min(1).max(100).default(50).optional(),
  before: z.string().min(1).max(1024).optional().describe("Opaque cursor returned as metadata.next_before by a previous list_diary_comments call."),
}).strict();

const listOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    comments: z.array(commentSchema),
    metadata: z.object({
      count: z.number().int().min(0),
      returned: z.number().int().min(0),
      has_more: z.boolean(),
      next_before: z.string().nullable(),
    }).strict(),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const updateInputSchema = z.object({
  id: idSchema.describe("Exact Diary comment id."),
  expected_revision: z.number().int().min(1).describe("Revision from the latest get_diary_comment or list_diary_comments read."),
  content: commentContentSchema.describe("Complete replacement comment text. Author cannot be changed."),
}).strict();

const updateOutputSchema = z.object({
  success: z.boolean(),
  data: commentSchema.extend(mcpMutationReceiptFields).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const deleteInputSchema = z.object({
  id: idSchema.describe("Exact Diary comment id."),
  expected_revision: z.number().int().min(1).describe("Revision from the latest authoritative comment read."),
}).strict();

const deleteOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    comment_id: idSchema,
    deleted: z.literal(true),
    ...mcpMutationReceiptFields,
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface DiaryCommentToolService {
  addMcpComment(
    context: { userId: string },
    input: {
      diaryId: string;
      author: "L" | "G" | "C";
      content: string;
      idempotencyKey: string;
    },
  ): Promise<AddDiaryCommentResult>;
  getComment(input: {
    userId: string;
    id: string;
    scope?: "active" | "archived";
  }): Promise<DiaryCommentResult>;
  listComments(input: {
    userId: string;
    diaryId: string;
    scope?: "active" | "archived";
    limit?: number;
    before?: string;
  }): Promise<ListDiaryCommentsResult>;
  updateComment(input: {
    userId: string;
    id: string;
    expectedRevision: number;
    content: string;
  }): Promise<DiaryCommentResult>;
  deleteComment(input: {
    userId: string;
    id: string;
    expectedRevision: number;
  }): Promise<{ comment_id: string; deleted: true }>;
}

export type DiaryCommentToolDependencies = {
  diaryCommentService: DiaryCommentToolService;
  getAuthenticatedUserId: () => string;
};

export function registerDiaryCommentTools(
  server: McpServer,
  dependencies: DiaryCommentToolDependencies,
): void {
  server.registerTool(
    "add_diary_comment",
    {
      title: "Add a Diary comment",
      description:
        "Create one independent canonical comment on an active Diary entry. The comment does not modify Diary content, Diary author, Diary updated_at, or Diary ordering. Author is immutable after creation. Supply a stable idempotency key; if the outcome is uncertain, read back before retrying.",
      inputSchema: addInputSchema,
      outputSchema: addOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ diary_id, author, content, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "add_diary_comment",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const data = await dependencies.diaryCommentService.addMcpComment(
            { userId },
            {
              diaryId: diary_id,
              author,
              content,
              idempotencyKey: idempotency_key,
            },
          );
          const replay = data.metadata.idempotent_replay;
          return {
            content: [{
              type: "text",
              text: joinMcpContentLines([
                replay
                  ? `Existing Diary comment returned [id=${data.comment.id}; revision=${data.comment.revision}].`
                  : `Diary comment created [id=${data.comment.id}; revision=${data.comment.revision}].`,
                `get_diary_comment(id=${data.comment.id}, scope=active)`,
              ]),
            }],
            structuredContent: {
              success: true as const,
              data: {
                comment: data.comment,
                ...mcpMutationReceipt({
                  outcome: mcpMutationOutcomeFromReplay(replay),
                  entity_type: "diary_comment",
                  entity_id: data.comment.id,
                  revision: data.comment.revision,
                  detail_tool: "get_diary_comment",
                  detail_arguments: {
                    id: data.comment.id,
                    scope: "active",
                  },
                }),
              },
            },
          };
        },
        mapError: toSafeCommentError,
      }),
  );

  server.registerTool(
    "get_diary_comment",
    {
      title: "Get one Diary comment",
      description:
        "Read one canonical Diary comment by exact id. scope defaults to active and must match the lifecycle state of the parent Diary.",
      inputSchema: getInputSchema,
      outputSchema: getOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, scope = "active" }) => {
      try {
        const data = await dependencies.diaryCommentService.getComment({
          userId: dependencies.getAuthenticatedUserId(),
          id,
          scope,
        });
        return {
          content: [{
            type: "text",
            text: joinMcpContentLines([
              `Diary comment by ${data.author} [id=${data.id}; diary_id=${data.diary_id}; revision=${data.revision}]`,
              data.content,
            ]),
          }],
          structuredContent: {
            success: true as const,
            data,
          },
        };
      } catch (error) {
        return toSafeCommentError(error);
      }
    },
  );

  server.registerTool(
    "list_diary_comments",
    {
      title: "List Diary comments",
      description:
        "List canonical comments attached to one Diary entry. The page is returned in chronological reading order. Use metadata.next_before to load older comments. scope defaults to active.",
      inputSchema: listInputSchema,
      outputSchema: listOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      diary_id,
      scope = "active",
      limit = 50,
      before,
    }) => {
      try {
        const data = await dependencies.diaryCommentService.listComments({
          userId: dependencies.getAuthenticatedUserId(),
          diaryId: diary_id,
          scope,
          limit,
          before,
        });
        const lines = [
          `Diary comments [diary_id=${diary_id}; count=${data.metadata.count}; returned=${data.metadata.returned}]`,
          ...data.comments.flatMap((comment) => [
            `${comment.author} · ${comment.created_at} [id=${comment.id}; revision=${comment.revision}]`,
            comment.content,
          ]),
          ...(data.metadata.next_before
            ? [`Older comments remain. Continue with before=${quoteMcpText(data.metadata.next_before)}.`]
            : []),
        ];
        return {
          content: [{
            type: "text",
            text: joinMcpContentLines(lines),
          }],
          structuredContent: {
            success: true as const,
            data,
          },
        };
      } catch (error) {
        return toSafeCommentError(error);
      }
    },
  );

  server.registerTool(
    "update_diary_comment",
    {
      title: "Update one Diary comment",
      description:
        "Replace the content of one comment on an active Diary without changing its immutable author. Requires the exact current revision. On a conflict or uncertain outcome, call get_diary_comment before deciding whether to retry.",
      inputSchema: updateInputSchema,
      outputSchema: updateOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id, expected_revision, content }) =>
      invokeMcpWrite({
        toolName: "update_diary_comment",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const data =
            await dependencies.diaryCommentService.updateComment({
              userId,
              id,
              expectedRevision: expected_revision,
              content,
            });
          return {
            content: [{
              type: "text",
              text: `Diary comment updated [id=${data.id}; revision=${data.revision}].`,
            }],
            structuredContent: {
              success: true as const,
              data: {
                ...data,
                ...mcpMutationReceipt({
                  outcome: "applied",
                  entity_type: "diary_comment",
                  entity_id: data.id,
                  revision: data.revision,
                  detail_tool: "get_diary_comment",
                  detail_arguments: { id: data.id, scope: "active" },
                }),
              },
            },
          };
        },
        mapError: (error) => toSafeCommentError(error, { id }),
      }),
  );

  server.registerTool(
    "delete_diary_comment",
    {
      title: "Delete one Diary comment",
      description:
        "Permanently delete one comment from an active Diary. This does not modify or delete the Diary itself. Requires the exact current revision. On an uncertain outcome, read back with get_diary_comment before deciding whether to retry.",
      inputSchema: deleteInputSchema,
      outputSchema: deleteOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id, expected_revision }) =>
      invokeMcpWrite({
        toolName: "delete_diary_comment",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const data =
            await dependencies.diaryCommentService.deleteComment({
              userId,
              id,
              expectedRevision: expected_revision,
            });
          return {
            content: [{
              type: "text",
              text: `Diary comment permanently deleted [id=${data.comment_id}].`,
            }],
            structuredContent: {
              success: true as const,
              data: {
                ...data,
                ...mcpMutationReceipt({
                  outcome: "applied",
                  entity_type: "diary_comment",
                  entity_id: data.comment_id,
                  revision: null,
                  detail_tool: null,
                  detail_arguments: null,
                }),
              },
            },
          };
        },
        mapError: (error) => toSafeCommentError(error, { id }),
      }),
  );
}

function toSafeCommentError(
  error: unknown,
  recoveryContext?: { id: string },
) {
  if (error instanceof DiaryCommentAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to access Diary comments.",
    );
  }

  if (error instanceof DiaryCommentDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Diary comments are unavailable for the authenticated user."
        : error.code === "DIARY_NOT_FOUND"
          ? "Diary entry was not found."
          : error.code === "DIARY_ARCHIVED"
            ? "Archived Diary comments are read-only."
            : error.code === "COMMENT_NOT_FOUND"
              ? "Diary comment was not found."
              : error.code === "COMMENT_REVISION_CONFLICT"
                ? "Diary comment revision changed. Read the comment again before retrying."
                : error.code === "IDEMPOTENCY_CONFLICT"
                  ? "This idempotency key was already used for a different Diary comment."
                  : "The Diary comment request is invalid.";
    if (error.code === "COMMENT_REVISION_CONFLICT" && recoveryContext) {
      return createMcpToolError(
        error.code,
        message,
        message,
        mcpErrorRecoveryHint({
          retryable: false,
          reason: "stale_revision",
          recommendedTool: "get_diary_comment",
          recommendedArguments: {
            id: recoveryContext.id,
            scope: "active",
          },
        }),
      );
    }
    if (error.code === "IDEMPOTENCY_CONFLICT") {
      return createMcpToolError(
        error.code,
        message,
        message,
        mcpErrorRecoveryHint({
          retryable: false,
          reason: "idempotency_conflict",
        }),
      );
    }
    return createMcpToolError(error.code, message);
  }

  console.error(
    "Diary comment tool failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Diary comments are temporarily unavailable.",
  );
}

export class DiaryCommentAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "DiaryCommentAuthenticationError";
  }
}

export type { DiaryCommentService };
