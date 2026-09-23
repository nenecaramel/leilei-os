import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DIARY_DOMAIN_BOUNDARY, MCP_CONTENT_AUTHOR_DESCRIPTION } from "../model-language.js";
import {
  DiaryDomainError,
  type AuthenticatedDiaryContext,
  type CreateDiaryInput,
  type CreateDiaryResult,
} from "../../../domains/diary/diary-service.js";
import { DIARY_CONTENT_MAX_LENGTH } from "../../../domains/resource-limits.js";
import { invokeMcpWrite } from "../write-context.js";
import {
  createMcpToolError,
  mcpErrorRecoveryHint,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import { mcpIdempotencyKeySchema } from "../idempotency-contract.js";
import {
  mcpMutationReceipt,
  mcpMutationReceiptFields,
  mcpMutationOutcomeFromReplay,
} from "../mutation-contract.js";

const contentAuthorSchema = z.enum(["L", "G", "C"]);

const writeDiaryInputSchema = z
  .object({
    title: z.string().min(1).max(200).describe("A concise title for the diary entry."),
    content: z.string().min(1).max(DIARY_CONTENT_MAX_LENGTH).describe("The complete diary entry content."),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The diary date in YYYY-MM-DD format; never use relative dates."),
    tags: z.array(z.string().min(1).max(50)).max(20).describe("Organizational labels for the diary entry; use an empty array when none apply."),
    mood: z.string().min(1).max(50).optional().describe("An optional concise mood label."),
    author: contentAuthorSchema.describe(MCP_CONTENT_AUTHOR_DESCRIPTION),
    idempotency_key: mcpIdempotencyKeySchema,
  })
  .strict();

const writeDiaryDataSchema = z.object({
  diary: z.object({
    id: z.string().uuid(),
    title: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    tags: z.array(z.string()),
    mood: z.string().nullable(),
    created_at: z.string().datetime(),
    author: contentAuthorSchema.nullable(),
  }),
  ...mcpMutationReceiptFields,
});

const writeDiaryOutputSchema = z.object({
  success: z.boolean(),
  data: writeDiaryDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface WriteDiaryToolService {
  createMcpDiary(
    context: AuthenticatedDiaryContext,
    input: CreateDiaryInput,
  ): Promise<CreateDiaryResult>;
}

export type WriteDiaryToolDependencies = {
  diaryService: WriteDiaryToolService;
  getAuthenticatedUserId: () => string;
};

const CREATE_DIARY_DESCRIPTION =
  DIARY_DOMAIN_BOUNDARY + " Create one dated Diary entry. Supply an exact YYYY-MM-DD date; authenticated user and source are server-owned.";

export function registerCreateDiaryTool(
  server: McpServer,
  dependencies: WriteDiaryToolDependencies,
): void {
  server.registerTool(
    "create_diary",
    {
      title: "Create a personal diary entry",
      description: CREATE_DIARY_DESCRIPTION,
      inputSchema: writeDiaryInputSchema,
      outputSchema: writeDiaryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ title, content, date, tags, mood, author, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "write_diary",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const data = await dependencies.diaryService.createMcpDiary(
            { userId },
            {
              title,
              content,
              date,
              tags,
              mood,
              author,
              idempotencyKey: idempotency_key,
            },
          );
          const receipt = mcpMutationReceipt({
            outcome: mcpMutationOutcomeFromReplay(
              data.metadata.idempotent_replay,
            ),
            entity_type: "diary",
            entity_id: data.diary.id,
            revision: null,
            detail_tool: "get_diary",
            detail_arguments: {
              id: data.diary.id,
              scope: "active",
            },
          });
          const result = {
            success: true as const,
            data: {
              diary: data.diary,
              ...receipt,
            },
          };
          const message = data.metadata.idempotent_replay
            ? "The existing diary entry was returned without creating a duplicate."
            : "Diary entry created successfully.";

          return {
            content: [{
              type: "text",
              text: joinMcpContentLines([
                `${message} Diary ${quoteMcpText(data.diary.title)} [id=${data.diary.id}; date=${data.diary.date}]`,
                `get_diary(id=${data.diary.id}, scope=active)`,
              ]),
            }],
            structuredContent: result,
          };
        },
        mapError: toSafeToolError,
      }),
  );
}

function toSafeToolError(error: unknown) {
  if (error instanceof WriteDiaryAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to write a diary entry.",
    );
  }

  if (error instanceof DiaryDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Diary writing is unavailable for the authenticated user."
        : error.code === "IDEMPOTENCY_CONFLICT"
          ? "This idempotency key was already used for different diary content."
          : "The diary request is invalid.";

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
    "write_diary failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Diary writing is temporarily unavailable.",
  );
}

export class WriteDiaryAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "WriteDiaryAuthenticationError";
  }
}
