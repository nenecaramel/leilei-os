import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ToyDomainError,
} from "../../../domains/toy/toy-command-service.js";
import type {
  ToyCommandRecord,
  ToyCreateInput,
} from "../../../domains/toy/toy-command-types.js";
import { invokeMcpWrite } from "../write-context.js";
import {
  TOY_DEFAULT_DURATION_SECONDS,
  TOY_MAX_DURATION_SECONDS,
} from "../../../domains/toy/toy-command-types.js";
import { ActiveUserAuthorizationError } from "../../../domains/require-active-user.js";
import { createMcpToolError, mcpErrorRecoveryHint, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { joinMcpContentLines } from "../content-contract.js";
import { mcpIdempotencyKeySchema } from "../idempotency-contract.js";

const toyCommandStatusSchema = z.enum([
  "pending",
  "claimed",
  "completed",
  "failed",
  "expired",
]);

const toySetInputSchema = z
  .object({
    percent: z
      .number()
      .int()
      .min(1)
      .max(50)
      .describe("Toy intensity as an integer from 1 to 50."),
    duration_seconds: z
      .number()
      .int()
      .min(1)
      .max(TOY_MAX_DURATION_SECONDS)
      .default(TOY_DEFAULT_DURATION_SECONDS)
      .describe("How long the device may run after local execution, in seconds (1-1200)."),
    idempotency_key: mcpIdempotencyKeySchema,
  })
  .strict();

const toyStopInputSchema = z
  .object({
    idempotency_key: mcpIdempotencyKeySchema,
  })
  .strict();

const toySetDataSchema = z.object({
  command: z.object({
    id: z.string().uuid(),
    action: z.literal("set"),
    percent: z.number().int().min(1).max(50),
    duration_seconds: z.number().int().min(1).max(TOY_MAX_DURATION_SECONDS),
    status: toyCommandStatusSchema,
    created_at: z.string().datetime(),
    expires_at: z.string().datetime(),
  }),
});

const toySetOutputSchema = z.object({
  success: z.boolean(),
  data: toySetDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

const toyStopDataSchema = z.object({
  command: z.object({
    id: z.string().uuid(),
    action: z.literal("stop"),
    percent: z.null(),
    status: toyCommandStatusSchema,
    created_at: z.string().datetime(),
    expires_at: z.string().datetime(),
  }),
});

const toyStopOutputSchema = z.object({
  success: z.boolean(),
  data: toyStopDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export interface ToyCommandToolService {
  createIdempotently(
    userId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<ToyCommandRecord>;
}

export type ToyCommandToolDependencies = {
  toyCommandService: ToyCommandToolService;
  getAuthenticatedUserId: () => string;
};

export function registerToyCommandTools(
  server: McpServer,
  dependencies: ToyCommandToolDependencies,
): void {
  server.registerTool(
    "toy_set",
    {
      title: "Set toy intensity",
      description:
        "Set the bound toy's intensity and run duration.",
      inputSchema: toySetInputSchema,
      outputSchema: toySetOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ percent, duration_seconds, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "toy_set",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const command = await dependencies.toyCommandService.createIdempotently(
            userId,
            { action: "set", percent, durationSeconds: duration_seconds } satisfies ToyCreateInput,
            idempotency_key,
          );

          const result = {
            success: true as const,
            data: {
              command: {
                id: command.id,
                action: "set" as const,
                percent: command.percent as number,
                duration_seconds: command.durationSeconds as number,
                status: command.status,
                created_at: command.createdAt.toISOString(),
                expires_at: command.expiresAt.toISOString(),
              },
            },
          };

          return {
            content: [
              {
                type: "text",
                text: joinMcpContentLines([
                  `Toy intensity command ${command.id} queued successfully for ${duration_seconds} seconds; status=${command.status}.`,
                ]),
              },
            ],
            structuredContent: result,
          };
        },
        mapError: (error) => toSafeToolError(error, "set"),
      }),
  );

  server.registerTool(
    "toy_stop",
    {
      title: "Stop toy",
      description:
        "Stop the bound toy.",
      inputSchema: toyStopInputSchema,
      outputSchema: toyStopOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ idempotency_key }) =>
      invokeMcpWrite({
        toolName: "toy_stop",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const command = await dependencies.toyCommandService.createIdempotently(
            userId,
            { action: "stop" } satisfies ToyCreateInput,
            idempotency_key,
          );

          const result = {
            success: true as const,
            data: {
              command: {
                id: command.id,
                action: "stop" as const,
                percent: null,
                status: command.status,
                created_at: command.createdAt.toISOString(),
                expires_at: command.expiresAt.toISOString(),
              },
            },
          };

          return {
            content: [
              {
                type: "text",
                text: `Toy stop command ${command.id} queued successfully; status=${command.status}.`,
              },
            ],
            structuredContent: result,
          };
        },
        mapError: (error) => toSafeToolError(error, "stop"),
      }),
  );
}

function toSafeToolError(error: unknown, action: "set" | "stop") {
  if (error instanceof ToyCommandAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to control the toy.",
    );
  }

  if (error instanceof ActiveUserAuthorizationError) {
    return createMcpToolError(
      error.code,
      "Toy control is temporarily unavailable.",
    );
  }

  if (error instanceof ToyDomainError) {
    const message =
      error.code === "TOY_UNAVAILABLE"
        ? "Toy control is temporarily unavailable."
        : error.code === "TOY_FORBIDDEN"
          ? "Toy control is unavailable for the authenticated user."
          : error.code === "IDEMPOTENCY_CONFLICT"
            ? "This idempotency key was already used for a different toy command."
          : error.code === "INVALID_INPUT"
            ? "The toy command is invalid."
            : "The toy command could not be queued.";

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
    `toy_${action} failed`,
    error instanceof Error ? error.name : "UnknownError",
  );

  return createMcpToolError(
    "INTERNAL_ERROR",
    "Toy control is temporarily unavailable.",
  );
}

export class ToyCommandAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "ToyCommandAuthenticationError";
  }
}
