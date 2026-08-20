import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DiaryDomainError, type AuthenticatedDiaryContext, type DiaryEntryResult, type UpdateMcpDiaryInput } from "../../../domains/diary/diary-service.js";
import { invokeMcpWrite } from "../write-context.js";

const updateDiaryInputSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().max(200).optional(),
  content: z.string().max(20_000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  mood: z.string().max(50).nullable().optional(),
  author: z.enum(["L", "G"]).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "id"), { message: "At least one Diary field must be supplied." });

const updateDiaryOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string(), title: z.string(), content: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), tags: z.array(z.string()), mood: z.string().nullable(), created_at: z.string().datetime(), updated_at: z.string().datetime(), lifecycle_status: z.literal("active"), author: z.enum(["L", "G"]).nullable(),
  }),
});

export interface UpdateDiaryToolService { updateMcpDiary(context: AuthenticatedDiaryContext, input: UpdateMcpDiaryInput): Promise<DiaryEntryResult>; }
export type UpdateDiaryToolDependencies = { diaryService: UpdateDiaryToolService; getAuthenticatedUserId: () => string };

export function registerUpdateDiaryTool(server: McpServer, dependencies: UpdateDiaryToolDependencies): void {
  server.registerTool("update_diary", {
    title: "Update one Diary entry",
    description: "Update only explicitly supplied fields on one active Diary entry.",
    inputSchema: updateDiaryInputSchema,
    outputSchema: updateDiaryOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ id, title, content, date, tags, mood, author }) => invokeMcpWrite({
    toolName: "update_diary", getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      const data = await dependencies.diaryService.updateMcpDiary({ userId }, { id, ...(title === undefined ? {} : { title }), ...(content === undefined ? {} : { content }), ...(date === undefined ? {} : { date }), ...(tags === undefined ? {} : { tags }), ...(mood === undefined ? {} : { mood }), ...(author === undefined ? {} : { author }) });
      return { content: [{ type: "text", text: "Diary entry updated." }], structuredContent: { success: true as const, data: { ...data, lifecycle_status: "active" as const } } };
    }, mapError: toSafeToolError,
  }));
}

function toSafeToolError(error: unknown) {
  if (error instanceof UpdateDiaryAuthenticationError) return { isError: true as const, content: [{ type: "text" as const, text: "Authentication is required to update Diary." }] };
  if (error instanceof DiaryDomainError) {
    const text = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND" ? "Diary updating is unavailable for the authenticated user." : error.code === "DIARY_NOT_FOUND" ? "Diary entry was not found." : "The Diary update request is invalid.";
    return { isError: true as const, content: [{ type: "text" as const, text }] };
  }
  console.error("update_diary failed", error instanceof Error ? error.name : "UnknownError");
  return { isError: true as const, content: [{ type: "text" as const, text: "Diary updating is temporarily unavailable." }] };
}

export class UpdateDiaryAuthenticationError extends Error {
  constructor() { super("Authenticated MCP user context is unavailable."); this.name = "UpdateDiaryAuthenticationError"; }
}
