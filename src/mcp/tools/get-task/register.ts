import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  TaskDomainError,
  type ReadTaskInput,
  type TaskEntryResult,
} from "../../../domains/task/task-service.js";
import { TaskReadAuthenticationError } from "../list-tasks/register.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const taskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const taskTimeBucketSchema = z.enum([
  "no_due_date",
  "overdue",
  "today",
  "next_7_days",
  "later",
]);
const taskActionSchema = z.enum(["start", "complete", "cancel", "reopen"]);
const dateTimeSchema = z.string().datetime();
const contentAuthorSchema = z.enum(["L", "G", "C"]);

const getTaskInputSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .describe("The exact Task id returned by list_tasks or global_search."),
    scope: z.enum(["active", "archived"]).default("active").optional().describe("Defaults to active. active reads only active records; archived reads only archived records."),
  })
  .strict();

const getTaskDataSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  due_time: dateTimeSchema.nullable(),
  timezone: z.string(),
  time_bucket: taskTimeBucketSchema,
  tags: z.array(z.string()),
  created_at: dateTimeSchema,
  updated_at: dateTimeSchema,
  completed_at: dateTimeSchema.nullable(),
  allowed_actions: z.array(taskActionSchema),
  lifecycle_status: z.enum(["active", "archived"]),
  author: contentAuthorSchema.nullable(),
});

const getTaskOutputSchema = z.object({
  success: z.boolean(),
  data: getTaskDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface GetTaskToolService {
  readTask(input: ReadTaskInput): Promise<TaskEntryResult>;
  readArchivedTask?(input: ReadTaskInput): Promise<TaskEntryResult>;
}

export type GetTaskToolDependencies = {
  taskService: GetTaskToolService;
  getAuthenticatedUserId: () => string;
};

export function registerGetTaskTool(
  server: McpServer,
  dependencies: GetTaskToolDependencies,
): void {
  server.registerTool(
    "get_task",
    {
      title: "Get one task",
      description:
        "Read the full detail of one authenticated Task after its exact ID is known from list_tasks, global_search, or another trusted result. scope defaults to active; scope=active and scope=archived each enforce exact-ID ownership and lifecycle boundaries.",
      inputSchema: getTaskInputSchema,
      outputSchema: getTaskOutputSchema,
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
          ? await dependencies.taskService.readArchivedTask?.({ userId, id }) ?? (() => { throw new Error("Archived Task reads are unavailable."); })()
          : await dependencies.taskService.readTask({ userId, id });
        const data = { ...detail, lifecycle_status: scope };
        return {
          content: [{
            type: "text",
            text: joinMcpContentLines([
              `Task ${quoteMcpText(data.title)} [id=${data.id}; status=${data.status}; lifecycle=${data.lifecycle_status}]`,
              data.description || "(empty)",
            ]),
          }],
          structuredContent: { success: true as const, data },
        };
      } catch (error) {
        return toSafeGetTaskError(error);
      }
    },
  );
}

function toSafeGetTaskError(error: unknown) {
  if (error instanceof TaskReadAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to read Task.",
    );
  }

  if (error instanceof TaskDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Task is unavailable for the authenticated user."
        : error.code === "TASK_NOT_FOUND"
          ? "Task was not found."
          : "The Task request is invalid.";
    return createMcpToolError(error.code, message);
  }

  console.error(
    "get_task failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Task is temporarily unavailable.",
  );
}
