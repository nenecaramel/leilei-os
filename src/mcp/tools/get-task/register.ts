import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  TaskDomainError,
  type ReadTaskInput,
  type TaskEntryResult,
} from "../../../domains/task/task-service.js";
import { TaskReadAuthenticationError } from "../list-tasks/register.js";

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

const getTaskOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
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
  }),
});

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
        "Read one authenticated, authorized Task by exact ID from list_tasks or global_search, including its full description. scope defaults to active. scope=active reads only active records and cannot read archived records; scope=archived reads only archived records and cannot read active records.",
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
          content: [{ type: "text", text: "Task retrieved." }],
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
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: "Authentication is required to read Task.",
        },
      ],
    };
  }

  if (error instanceof TaskDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Task is unavailable for the authenticated user."
        : error.code === "TASK_NOT_FOUND"
          ? "Task was not found."
          : "The Task request is invalid.";
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: message }],
    };
  }

  console.error(
    "get_task failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    isError: true as const,
    content: [
      { type: "text" as const, text: "Task is temporarily unavailable." },
    ],
  };
}
