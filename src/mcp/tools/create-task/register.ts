import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  TaskDomainError,
  type AuthenticatedTaskContext,
  type CreateTaskInput,
  type CreateTaskResult,
} from "../../../domains/task/task-service.js";

const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const taskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

const createTaskInputSchema = z
  .object({
    title: z.string().min(1).max(200).describe("A concise task title."),
    description: z
      .string()
      .min(1)
      .max(5_000)
      .describe("The complete task description."),
    due_time: z
      .string()
      .min(1)
      .max(64)
      .nullable()
      .optional()
      .describe(
        "An exact ISO 8601 timestamp with Z or an explicit UTC offset. Relative times such as tomorrow afternoon are not allowed.",
      ),
    timezone: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("The IANA timezone used to interpret and display the task."),
    priority: taskPrioritySchema.describe(
      "Task priority: low, normal, high, or urgent.",
    ),
    tags: z
      .array(z.string().min(1).max(50))
      .max(20)
      .describe("Organizational labels; use an empty array when none apply."),
  })
  .strict();

const createTaskOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    task: z.object({
      id: z.string().uuid(),
      title: z.string(),
      description: z.string(),
      status: taskStatusSchema,
      priority: taskPrioritySchema,
      due_time: z.string().datetime().nullable(),
      timezone: z.string(),
      time_bucket: z.enum([
        "no_due_date",
        "overdue",
        "today",
        "next_7_days",
        "later",
      ]),
      tags: z.array(z.string()),
      created_at: z.string().datetime(),
      updated_at: z.string().datetime(),
      completed_at: z.string().datetime().nullable(),
    }),
  }),
});

export interface CreateTaskToolService {
  createTask(
    context: AuthenticatedTaskContext,
    input: CreateTaskInput,
  ): Promise<CreateTaskResult>;
}

export type CreateTaskToolDependencies = {
  taskService: CreateTaskToolService;
  getAuthenticatedUserId: () => string;
};

export function registerCreateTaskTool(
  server: McpServer,
  dependencies: CreateTaskToolDependencies,
): void {
  server.registerTool(
    "create_task",
    {
      title: "Create a personal task",
      description:
        "Create one personal task in Leilei OS. This is a persistent, non-idempotent write operation. The due time may be omitted or null. Exact ISO instants remain supported; local date-times are interpreted only in the authenticated user's account timezone. The authenticated user and initial pending status are assigned by the server.",
      inputSchema: createTaskInputSchema,
      outputSchema: createTaskOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, description, due_time, timezone, priority, tags }) => {
      try {
        const userId = dependencies.getAuthenticatedUserId();
        const data = await dependencies.taskService.createTask(
          { userId },
          {
            title,
            description,
            dueTime: due_time,
            timezone,
            priority,
            tags,
          },
        );
        const result = { success: true as const, data };

        return {
          content: [
            {
              type: "text",
              text: "Task created successfully.",
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return toSafeToolError(error);
      }
    },
  );
}

function toSafeToolError(error: unknown) {
  if (error instanceof CreateTaskAuthenticationError) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: "Authentication is required to create a task.",
        },
      ],
    };
  }

  if (error instanceof TaskDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Task creation is unavailable for the authenticated user."
        : "The task request is invalid.";

    return {
      isError: true as const,
      content: [{ type: "text" as const, text: message }],
    };
  }

  console.error(
    "create_task failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: "Task creation is temporarily unavailable.",
      },
    ],
  };
}

export class CreateTaskAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "CreateTaskAuthenticationError";
  }
}
