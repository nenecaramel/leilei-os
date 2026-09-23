import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MCP_CONTENT_AUTHOR_DESCRIPTION, TASK_DOMAIN_BOUNDARY } from "../model-language.js";
import {
  TaskDomainError,
  type AuthenticatedTaskContext,
  type CreateTaskInput,
  type CreateTaskIdempotentResult,
} from "../../../domains/task/task-service.js";
import { invokeMcpWrite } from "../write-context.js";
import {
  createMcpToolError,
  mcpErrorRecoveryHint,
  mcpToolErrorDetailsSchema,
} from "../error-contract.js";
import { formatMcpDetailPointer, joinMcpContentLines, quoteMcpText } from "../content-contract.js";
import { mcpIdempotencyKeySchema } from "../idempotency-contract.js";
import {
  mcpMutationReceipt,
  mcpMutationReceiptFields,
} from "../mutation-contract.js";

const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const taskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
const contentAuthorSchema = z.enum(["L", "G", "C"]);

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
    author: contentAuthorSchema.describe(MCP_CONTENT_AUTHOR_DESCRIPTION),
    idempotency_key: mcpIdempotencyKeySchema,
  })
  .strict();

const createTaskDataSchema = z.object({
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
    author: contentAuthorSchema.nullable(),
  }),
  ...mcpMutationReceiptFields,
});

const createTaskOutputSchema = z.object({
  success: z.boolean(),
  data: createTaskDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface CreateTaskToolService {
  createTaskIdempotently(
    context: AuthenticatedTaskContext,
    input: CreateTaskInput,
    idempotencyKey: string,
  ): Promise<CreateTaskIdempotentResult>;
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
        TASK_DOMAIN_BOUNDARY + " Create one personal Task in Leilei OS as an idempotent write. Supply a stable idempotency_key to prevent duplicate creation on replay. The due time may be omitted or null; exact ISO instants remain supported and local date-times use the authenticated user's account timezone. The authenticated user and initial pending status are assigned by the server.",
      inputSchema: createTaskInputSchema,
      outputSchema: createTaskOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ title, description, due_time, timezone, priority, tags, author, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "create_task",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const data = await dependencies.taskService.createTaskIdempotently(
            { userId },
            {
              title,
              description,
              dueTime: due_time,
              timezone,
              priority,
              tags,
              author,
            },
            idempotency_key,
          );
          const result = {
            success: true as const,
            data: {
              task: data.task,
              ...mcpMutationReceipt({
                outcome: data.outcome,
                entity_type: "task",
                entity_id: data.task.id,
                revision: null,
                detail_tool: "get_task",
                detail_arguments: { id: data.task.id },
              }),
            },
          };

          return {
            content: [
              {
                type: "text",
                text: joinMcpContentLines([
                  `${data.outcome === "replayed" ? "Task replayed" : "Task created"}: ${quoteMcpText(data.task.title)} [id=${data.task.id}; status=${data.task.status}]`,
                  formatMcpDetailPointer("get_task", { id: data.task.id }),
                ]),
              },
            ],
            structuredContent: result,
          };
        },
        mapError: toSafeToolError,
      }),
  );
}

function toSafeToolError(error: unknown) {
  if (error instanceof CreateTaskAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to create a task.",
    );
  }

  if (error instanceof TaskDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Task creation is unavailable for the authenticated user."
        : error.code === "IDEMPOTENCY_CONFLICT"
          ? "This idempotency key was already used for a different task."
          : "The task request is invalid.";

    if (error.code === "IDEMPOTENCY_CONFLICT") {
      return createMcpToolError(
        error.code,
        message,
        message,
        mcpErrorRecoveryHint({
          retryable: false,
          reason: "idempotency_conflict",
        }),
      );
    }
    return createMcpToolError(error.code, message);
  }

  console.error(
    "create_task failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Task creation is temporarily unavailable.",
  );
}

export class CreateTaskAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "CreateTaskAuthenticationError";
  }
}
