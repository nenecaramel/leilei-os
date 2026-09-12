import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  TaskDomainError,
  type ListTasksInput,
  type ListTasksResult,
} from "../../../domains/task/task-service.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { formatMcpDetailPointer, joinMcpContentLines, quoteMcpText } from "../content-contract.js";

const taskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const taskDueSchema = z.enum([
  "no_due_date",
  "overdue",
  "today",
  "next_7_days",
  "custom",
]);
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

const listTasksInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    tag: z.string().trim().min(1).max(50).optional(),
    due: taskDueSchema.optional(),
    due_from: z.string().trim().min(1).max(64).optional(),
    due_to: z.string().trim().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(50).default(50).optional(),
  })
  .strict();

const taskListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
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
  author: contentAuthorSchema.nullable(),
  detail_tool: z.literal("get_task"),
  detail_arguments: z.object({ id: z.string() }).strict(),
});

const listTasksDataSchema = z.object({
  tasks: z.array(taskListItemSchema),
  metadata: z.object({ count: z.number().int().nonnegative() }),
});

const listTasksOutputSchema = z.object({
  success: z.boolean(),
  data: listTasksDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface ListTasksToolService {
  listTasks(input: ListTasksInput): Promise<ListTasksResult>;
}

export type ListTasksToolDependencies = {
  taskService: ListTasksToolService;
  getAuthenticatedUserId: () => string;
};

export function registerListTasksTool(
  server: McpServer,
  dependencies: ListTasksToolDependencies,
): void {
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Browse or search the authenticated user's Tasks with optional text, status, priority, exact-tag, and due-time filters. Results are compact and intentionally omit descriptions; use each item's get_task detail pointer for full task detail.",
      inputSchema: listTasksInputSchema,
      outputSchema: listTasksOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, status, priority, tag, due, due_from, due_to, limit }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const result = await dependencies.taskService.listTasks({
          userId,
          limit: limit ?? 50,
          query: {
            q: query,
            status,
            priority,
            tag,
            due,
            dueFrom: due_from,
            dueTo: due_to,
          },
        });
        const data = {
          tasks: result.tasks.map(
            ({
              id,
              title,
              status: taskStatus,
              priority: taskPriority,
              due_time,
              timezone,
              time_bucket,
              tags,
              created_at,
              updated_at,
              completed_at,
              allowed_actions,
              author,
            }) => ({
              id,
              title,
              status: taskStatus,
              priority: taskPriority,
              due_time,
              timezone,
              time_bucket,
              tags,
              created_at,
              updated_at,
              completed_at,
              allowed_actions,
              author,
              detail_tool: "get_task" as const,
              detail_arguments: { id },
            }),
          ),
          metadata: result.metadata,
        };

        return {
          content: [
            { type: "text", text: taskListContent(data) },
          ],
          structuredContent: { success: true as const, data },
        };
      } catch (error) {
        return toSafeListTasksError(error);
      }
    },
  );
}

function taskListContent(data: { tasks: Array<{ id: string; title: string; status: string }>; metadata: { count: number } }): string {
  const lines = [`Found ${data.metadata.count} tasks.`];
  for (const task of data.tasks) {
    const pointer = formatMcpDetailPointer("get_task", { id: task.id });
    lines.push(`${quoteMcpText(task.title)} [id=${task.id}; ${pointer}; status=${task.status}]`);
  }
  return joinMcpContentLines(lines);
}

function toSafeListTasksError(error: unknown) {
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
        : "The Task list request is invalid.";
    return createMcpToolError(error.code, message);
  }

  console.error(
    "list_tasks failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Task is temporarily unavailable.",
  );
}

export class TaskReadAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "TaskReadAuthenticationError";
  }
}
