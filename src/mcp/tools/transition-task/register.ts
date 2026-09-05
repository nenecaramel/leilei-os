import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskDomainError, type AuthenticatedTaskContext, type TaskEntryResult, type TransitionMcpTaskInput } from "../../../domains/task/task-service.js";
import { invokeMcpWrite } from "../write-context.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";

const transitionTaskInputSchema = z.object({ id: z.string().trim().min(1), action: z.enum(["start", "complete", "cancel", "reopen"]) }).strict();
const transitionTaskDataSchema = z.object({ id: z.string(), title: z.string(), description: z.string(), status: z.enum(["pending", "in_progress", "completed", "cancelled"]), priority: z.enum(["low", "normal", "high", "urgent"]), due_time: z.string().datetime().nullable(), timezone: z.string(), time_bucket: z.enum(["no_due_date", "overdue", "today", "next_7_days", "later"]), tags: z.array(z.string()), created_at: z.string().datetime(), updated_at: z.string().datetime(), completed_at: z.string().datetime().nullable(), allowed_actions: z.array(z.enum(["start", "complete", "cancel", "reopen"])), lifecycle_status: z.literal("active"), author: z.enum(["L", "G", "C"]).nullable() });
const transitionTaskOutputSchema = z.object({ success: z.boolean(), data: transitionTaskDataSchema.optional(), error: mcpToolErrorDetailsSchema.optional() }).strict();

export interface TransitionTaskToolService { transitionMcpTask(context: AuthenticatedTaskContext, input: TransitionMcpTaskInput): Promise<TaskEntryResult>; }
export type TransitionTaskToolDependencies = { taskService: TransitionTaskToolService; getAuthenticatedUserId: () => string };

export function registerTransitionTaskTool(server: McpServer, dependencies: TransitionTaskToolDependencies): void {
  server.registerTool("transition_task", { title: "Transition one Task", description: "Apply one explicit Task action through the existing Task state machine. If the outcome is uncertain, perform a readback with get_task before deciding what to do next; never blindly repeat the same action.", inputSchema: transitionTaskInputSchema, outputSchema: transitionTaskOutputSchema, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }, async ({ id, action }) => invokeMcpWrite({
    toolName: "transition_task", getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
    operation: async ({ userId }) => {
      const data = await dependencies.taskService.transitionMcpTask({ userId }, { id, action });
      return { content: [{ type: "text", text: "Task transitioned." }], structuredContent: { success: true as const, data: { ...data, lifecycle_status: "active" as const } } };
    }, mapError: toSafeToolError,
  }));
}

function toSafeToolError(error: unknown) {
  if (error instanceof TransitionTaskAuthenticationError) return createMcpToolError("AUTHENTICATION_REQUIRED", "Authentication is required to transition Task.");
  if (error instanceof TaskDomainError) {
    const text = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND" ? "Task transitions are unavailable for the authenticated user." : error.code === "TASK_NOT_FOUND" ? "Task was not found." : error.code === "TASK_STATUS_CONFLICT" ? "Task status changed concurrently; read it again before retrying." : error.code === "INVALID_TASK_REOPEN_STATE" ? "Task cannot be reopened from its current state." : "The Task transition request is invalid.";
    return createMcpToolError(error.code, text);
  }
  console.error("transition_task failed", error instanceof Error ? error.name : "UnknownError");
  return createMcpToolError("INTERNAL_ERROR", "Task transition is temporarily unavailable.");
}

export class TransitionTaskAuthenticationError extends Error {
  constructor() { super("Authenticated MCP user context is unavailable."); this.name = "TransitionTaskAuthenticationError"; }
}
