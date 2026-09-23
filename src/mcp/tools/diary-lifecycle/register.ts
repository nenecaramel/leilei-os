import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DiaryDomainError,
  type AuthenticatedDiaryContext,
} from "../../../domains/diary/diary-service.js";
import { invokeMcpWrite } from "../write-context.js";
import {
  createMcpToolError,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";
import { joinMcpContentLines } from "../content-contract.js";
import { mcpMutationReceipt, mcpMutationReceiptFields } from "../mutation-contract.js";

const diaryIdSchema = z
  .string()
  .trim()
  .uuid()
  .describe("The exact Diary id returned by write_diary, search_diary, global_search, or get_diary.");

const lifecycleInputSchema = z.object({
  id: diaryIdSchema,
}).strict();

const lifecycleDataSchema = z.object({
  diary_id: z.string().uuid(),
  lifecycle_status: z.enum(["active", "archived"]),
  ...mcpMutationReceiptFields,
}).strict();

const lifecycleOutputSchema = z.object({
  success: z.boolean(),
  data: lifecycleDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const deleteDataSchema = z.object({
  diary_id: z.string().uuid(),
  deleted: z.literal(true),
  ...mcpMutationReceiptFields,
}).strict();

const deleteOutputSchema = z.object({
  success: z.boolean(),
  data: deleteDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface DiaryLifecycleToolService {
  archiveMcpDiary(
    context: AuthenticatedDiaryContext,
    input: { id: string },
  ): Promise<void>;

  restoreMcpDiary(
    context: AuthenticatedDiaryContext,
    input: { id: string },
  ): Promise<void>;

  permanentlyDeleteMcpDiary(
    context: AuthenticatedDiaryContext,
    input: { id: string },
  ): Promise<void>;
}

export type DiaryLifecycleToolDependencies = {
  diaryService: DiaryLifecycleToolService;
  getAuthenticatedUserId: () => string;
};

export class DiaryLifecycleAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "DiaryLifecycleAuthenticationError";
  }
}

export function registerDiaryLifecycleTools(
  server: McpServer,
  dependencies: DiaryLifecycleToolDependencies,
): void {
  server.registerTool(
    "archive_diary",
    {
      title: "Archive one Diary entry",
      description:
        "Archive one active Diary entry without changing its canonical title, content, author, or updated_at. Canonical Diary comments remain attached and become readable in archived scope but read-only. If the outcome is uncertain, read with get_diary(scope=archived) before deciding whether any retry is needed.",
      inputSchema: lifecycleInputSchema,
      outputSchema: lifecycleOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id }) =>
      invokeMcpWrite({
        toolName: "archive_diary",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          await dependencies.diaryService.archiveMcpDiary(
            { userId },
            { id },
          );
          const data = {
            diary_id: id,
            lifecycle_status: "archived" as const,
            ...mcpMutationReceipt({
              outcome: "applied",
              entity_type: "diary",
              entity_id: id,
              revision: null,
              detail_tool: "get_diary",
              detail_arguments: {
                id,
                scope: "archived",
              },
            }),
          };
          return {
            content: [{
              type: "text" as const,
              text: joinMcpContentLines([
                `Diary archived [id=${id}].`,
                `get_diary(id=${id}, scope=archived)`,
              ]),
            }],
            structuredContent: {
              success: true as const,
              data,
            },
          };
        },
        mapError: (error) => toSafeLifecycleError(error, "archive"),
      }),
  );

  server.registerTool(
    "restore_diary",
    {
      title: "Restore one Diary entry",
      description:
        "Restore one archived Diary entry to active state without changing its canonical title, content, author, or updated_at. Attached canonical Diary comments become writable again. If the outcome is uncertain, read with get_diary(scope=active) before deciding whether any retry is needed.",
      inputSchema: lifecycleInputSchema,
      outputSchema: lifecycleOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id }) =>
      invokeMcpWrite({
        toolName: "restore_diary",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          await dependencies.diaryService.restoreMcpDiary(
            { userId },
            { id },
          );
          const data = {
            diary_id: id,
            lifecycle_status: "active" as const,
            ...mcpMutationReceipt({
              outcome: "applied",
              entity_type: "diary",
              entity_id: id,
              revision: null,
              detail_tool: "get_diary",
              detail_arguments: {
                id,
                scope: "active",
              },
            }),
          };
          return {
            content: [{
              type: "text" as const,
              text: joinMcpContentLines([
                `Diary restored [id=${id}].`,
                `get_diary(id=${id}, scope=active)`,
              ]),
            }],
            structuredContent: {
              success: true as const,
              data,
            },
          };
        },
        mapError: (error) => toSafeLifecycleError(error, "restore"),
      }),
  );

  server.registerTool(
    "delete_diary",
    {
      title: "Permanently delete one archived Diary entry",
      description:
        "Permanently delete one archived Diary entry. The Diary must already be archived. This also removes canonical Diary comments owned by that Diary through the existing Diary lifecycle cascade. This is destructive. If the outcome is uncertain, read archived scope first; if the Diary is already absent, do not blindly retry.",
      inputSchema: lifecycleInputSchema,
      outputSchema: deleteOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id }) =>
      invokeMcpWrite({
        toolName: "delete_diary",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          await dependencies.diaryService.permanentlyDeleteMcpDiary(
            { userId },
            { id },
          );
          return {
            content: [{
              type: "text" as const,
              text: `Diary permanently deleted [id=${id}].`,
            }],
            structuredContent: {
              success: true as const,
              data: {
                diary_id: id,
                deleted: true as const,
                ...mcpMutationReceipt({
                  outcome: "applied",
                  entity_type: "diary",
                  entity_id: id,
                  revision: null,
                  detail_tool: null,
                  detail_arguments: null,
                }),
              },
            },
          };
        },
        mapError: (error) => toSafeLifecycleError(error, "delete"),
      }),
  );
}

function toSafeLifecycleError(
  error: unknown,
  action: "archive" | "restore" | "delete",
) {
  if (error instanceof DiaryLifecycleAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to change Diary lifecycle state.",
    );
  }

  if (error instanceof DiaryDomainError) {
    if (error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND") {
      return createMcpToolError(
        error.code,
        "Diary lifecycle changes are unavailable for the authenticated user.",
      );
    }

    if (error.code === "DIARY_NOT_FOUND") {
      const message =
        action === "archive"
          ? "Active Diary entry was not found."
          : action === "restore"
            ? "Archived Diary entry was not found."
            : "Archived Diary entry was not found or is not eligible for permanent deletion.";
      return createMcpToolError(error.code, message);
    }

    return createMcpToolError(
      error.code,
      "The Diary lifecycle request is invalid.",
    );
  }

  console.error(
    `${action}_diary failed`,
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Diary lifecycle changes are temporarily unavailable.",
  );
}
