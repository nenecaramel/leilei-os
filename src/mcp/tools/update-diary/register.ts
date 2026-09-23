import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DIARY_DOMAIN_BOUNDARY, MCP_CONTENT_AUTHOR_DESCRIPTION } from "../model-language.js";
import { DiaryDomainError, type AuthenticatedDiaryContext, type DiaryEntryResult, type UpdateMcpDiaryInput } from "../../../domains/diary/diary-service.js";
import { DIARY_CONTENT_MAX_LENGTH } from "../../../domains/resource-limits.js";
import { invokeMcpWrite } from "../write-context.js";
import {
  createMcpToolError,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import { mcpMutationReceipt, mcpMutationReceiptFields } from "../mutation-contract.js";

const contentAuthorSchema = z.enum(["L", "G", "C"]);

const updateDiaryInputSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(DIARY_CONTENT_MAX_LENGTH).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  mood: z.string().min(1).max(50).nullable().optional(),
  author: contentAuthorSchema.optional().describe(MCP_CONTENT_AUTHOR_DESCRIPTION),
}).strict();

const updateDiaryDataSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tags: z.array(z.string()),
  mood: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  lifecycle_status: z.literal("active"),
  author: contentAuthorSchema.nullable(),
  ...mcpMutationReceiptFields,
});

const updateDiaryOutputSchema = z.object({
  success: z.boolean(),
  data: updateDiaryDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface UpdateDiaryToolService { updateMcpDiary(context: AuthenticatedDiaryContext, input: UpdateMcpDiaryInput): Promise<DiaryEntryResult>; }
export type UpdateDiaryToolDependencies = { diaryService: UpdateDiaryToolService; getAuthenticatedUserId: () => string };

export function registerUpdateDiaryTool(server: McpServer, dependencies: UpdateDiaryToolDependencies): void {
  server.registerTool("update_diary", {
    title: "Update one Diary entry",
    description: DIARY_DOMAIN_BOUNDARY + " Update only supplied fields on one active Diary entry. If outcome is uncertain, read get_diary before retrying.",
    inputSchema: updateDiaryInputSchema,
    outputSchema: updateDiaryOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ id, title, content, date, tags, mood, author }) => invokeMcpWrite({
    toolName: "update_diary", getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      if (title === undefined && content === undefined && date === undefined && tags === undefined && mood === undefined && author === undefined) {
        throw new DiaryDomainError("INVALID_DIARY_PATCH", "At least one Diary field must be supplied.");
      }
      const data = await dependencies.diaryService.updateMcpDiary({ userId }, { id, ...(title === undefined ? {} : { title }), ...(content === undefined ? {} : { content }), ...(date === undefined ? {} : { date }), ...(tags === undefined ? {} : { tags }), ...(mood === undefined ? {} : { mood }), ...(author === undefined ? {} : { author }) });
      const compact = {
        id: data.id,
        title: data.title,
        date: data.date,
        tags: data.tags,
        mood: data.mood,
        created_at: data.created_at,
        updated_at: data.updated_at,
        lifecycle_status: "active" as const,
        author: data.author,
        ...mcpMutationReceipt({
          outcome: "applied",
          entity_type: "diary",
          entity_id: data.id,
          revision: null,
          detail_tool: "get_diary",
          detail_arguments: { id: data.id, scope: "active" },
        }),
      };
      return {
        content: [{ type: "text", text: joinMcpContentLines([
          `Diary entry updated: ${quoteMcpText(compact.title)} [id=${compact.id}; date=${compact.date}]`,
          `get_diary(id=${compact.id}, scope=active)`,
        ]) }],
        structuredContent: { success: true as const, data: compact },
      };
    }, mapError: toSafeToolError,
  }));
}

function toSafeToolError(error: unknown) {
  if (error instanceof UpdateDiaryAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to update Diary.",
    );
  }
  if (error instanceof DiaryDomainError) {
    const text = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND" ? "Diary updating is unavailable for the authenticated user." : error.code === "DIARY_NOT_FOUND" ? "Diary entry was not found." : "The Diary update request is invalid.";
    return createMcpToolError(error.code, text);
  }
  console.error("update_diary failed", error instanceof Error ? error.name : "UnknownError");
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Diary updating is temporarily unavailable.",
  );
}

export class UpdateDiaryAuthenticationError extends Error {
  constructor() { super("Authenticated MCP user context is unavailable."); this.name = "UpdateDiaryAuthenticationError"; }
}
