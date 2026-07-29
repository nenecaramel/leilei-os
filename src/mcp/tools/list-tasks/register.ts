import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  TaskDomainError,
  type ListTasksInput,
  type ListTasksResult,
} from "../../../domains/task/task-service.js";

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
const taskActionSchema = z.enum(["start", "complete", "cancel"]);
const dateTimeSchema = z.string().datetime();

const listTasksInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    tag: z.string().trim().min(1).max(50).optional(),
    due: taskDueSchema.optional(),
    due_from: z.string().trim().min(1).max(64).optional(),
    due_to: z.string().trim().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(50).optional(),
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
});

const listTasksOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    tasks: z.array(taskListItemSchema),
    metadata: z.object({ count: z.number().int().nonnegative() }),
  }),
});

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
        "List the authenticated user's tasks with optional text, status, priority, exact-tag, and due-time filters. Descriptions are intentionally omitted; use get_task for full detail.",
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
            }),
          ),
          metadata: result.metadata,
        };

        return {
          content: [
            { type: "text", text: `Found ${data.metadata.count} tasks.` },
          ],
          structuredContent: { success: true as const, data },
        };
      } catch (error) {
        return toSafeListTasksError(error);
      }
    },
  );
}

function toSafeListTasksError(error: unknown) {
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
        : "The Task list request is invalid.";
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: message }],
    };
  }

  console.error(
    "list_tasks failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    isError: true as const,
    content: [
      { type: "text" as const, text: "Task is temporarily unavailable." },
    ],
  };
}

export class TaskReadAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "TaskReadAuthenticationError";
  }
}
