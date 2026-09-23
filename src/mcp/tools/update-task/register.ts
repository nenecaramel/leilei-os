import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MCP_CONTENT_AUTHOR_DESCRIPTION, TASK_DOMAIN_BOUNDARY } from "../model-language.js";
import { TaskDomainError, type AuthenticatedTaskContext, type TaskEntryResult, type UpdateMcpTaskInput } from "../../../domains/task/task-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { createMcpToolError, mcpErrorRecoveryHint, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { quoteMcpText } from "../content-contract.js";
import { mcpMutationReceipt, mcpMutationReceiptFields } from "../mutation-contract.js";

const updateTaskInputSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(5_000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  due_time: z.string().trim().min(1).max(64).nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  author: z.enum(["L", "G", "C"]).optional().describe(MCP_CONTENT_AUTHOR_DESCRIPTION),
}).strict();

const taskStatusSchema = z.enum(["pending", "in_progress", "completed", "cancelled"]);
const taskActionSchema = z.enum(["start", "complete", "cancel", "reopen"]);
const taskOutputDataSchema = z.object({
  id: z.string(), title: z.string(), description: z.string(), status: taskStatusSchema, priority: z.enum(["low", "normal", "high", "urgent"]), due_time: z.string().datetime().nullable(), timezone: z.string(), time_bucket: z.enum(["no_due_date", "overdue", "today", "next_7_days", "later"]), tags: z.array(z.string()), created_at: z.string().datetime(), updated_at: z.string().datetime(), completed_at: z.string().datetime().nullable(), allowed_actions: z.array(taskActionSchema), lifecycle_status: z.literal("active"), author: z.enum(["L", "G", "C"]).nullable(),
  ...mcpMutationReceiptFields,
});
const updateTaskOutputSchema = z.object({ success: z.boolean(), data: taskOutputDataSchema.optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();

export interface UpdateTaskToolService { updateMcpTask(context: AuthenticatedTaskContext, input: UpdateMcpTaskInput): Promise<TaskEntryResult>; }
export type UpdateTaskToolDependencies = { taskService: UpdateTaskToolService; getAuthenticatedUserId: () => string };

export function registerUpdateTaskTool(server: McpServer, dependencies: UpdateTaskToolDependencies): void {
  server.registerTool("update_task", { title: "Update one Task", description: TASK_DOMAIN_BOUNDARY + " Update only explicitly supplied ordinary fields on one active Task. If the outcome is uncertain, perform a readback with get_task before deciding what to do next; never blindly retry.", inputSchema: updateTaskInputSchema, outputSchema: updateTaskOutputSchema, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }, async ({ id, title, description, priority, due_time, tags, author }) => invokeMcpWrite({
    toolName: "update_task", getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      if (title === undefined && description === undefined && priority === undefined && due_time === undefined && tags === undefined && author === undefined) {
        throw new TaskDomainError("INVALID_TASK_PATCH", "At least one Task field must be supplied.");
      }
      const data = await dependencies.taskService.updateMcpTask({ userId }, { id, ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }), ...(priority === undefined ? {} : { priority }), ...(due_time === undefined ? {} : { dueTime: due_time }), ...(tags === undefined ? {} : { tags }), ...(author === undefined ? {} : { author }) });
      return {
        content: [{ type: "text", text: `Task updated: ${quoteMcpText(data.title)} [id=${data.id}; status=${data.status}].` }],
        structuredContent: {
          success: true as const,
          data: {
            ...data,
            lifecycle_status: "active" as const,
            ...mcpMutationReceipt({
              outcome: "applied",
              entity_type: "task",
              entity_id: data.id,
              revision: null,
              detail_tool: "get_task",
              detail_arguments: { id: data.id },
            }),
          },
        },
      };
    }, mapError: (error) => toSafeToolError(error, id),
  }));
}

function toSafeToolError(error: unknown, taskId?: string) {
  if (error instanceof UpdateTaskAuthenticationError) return createMcpToolError("AUTHENTICATION_REQUIRED", "Authentication is required to update Task.");
  if (error instanceof TaskDomainError) {
    const text = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND" ? "Task updating is unavailable for the authenticated user." : error.code === "TASK_NOT_FOUND" ? "Task was not found." : error.code === "TASK_STATUS_CONFLICT" ? "Task status changed concurrently; read it again before retrying." : "The Task update request is invalid.";
    if (error.code === "TASK_STATUS_CONFLICT" && taskId) {
      return createMcpToolError(
        error.code,
        text,
        text,
        mcpErrorRecoveryHint({
          retryable: false,
          reason: "status_conflict",
          recommendedTool: "get_task",
          recommendedArguments: { id: taskId },
        }),
      );
    }
    return createMcpToolError(error.code, text);
  }
  console.error("update_task failed", error instanceof Error ? error.name : "UnknownError");
  return createMcpToolError("INTERNAL_ERROR", "Task updating is temporarily unavailable.");
}

export class UpdateTaskAuthenticationError extends Error {
  constructor() { super("Authenticated MCP user context is unavailable."); this.name = "UpdateTaskAuthenticationError"; }
}
