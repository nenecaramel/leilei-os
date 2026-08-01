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
  MCP_IDEMPOTENCY_KEY_MAX_LENGTH,
  MCP_IDEMPOTENCY_KEY_MIN_LENGTH,
  MCP_IDEMPOTENCY_KEY_PATTERN,
} from "../../../domains/mcp-write/mcp-write-idempotency.js";

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
      .max(40)
      .describe("Toy intensity as an integer from 1 to 40."),
    idempotency_key: z
      .string()
      .min(MCP_IDEMPOTENCY_KEY_MIN_LENGTH)
      .max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH)
      .regex(MCP_IDEMPOTENCY_KEY_PATTERN)
      .describe("A stable unique key used to prevent duplicate toy commands."),
  })
  .strict();

const toyStopInputSchema = z
  .object({
    idempotency_key: z
      .string()
      .min(MCP_IDEMPOTENCY_KEY_MIN_LENGTH)
      .max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH)
      .regex(MCP_IDEMPOTENCY_KEY_PATTERN)
      .describe("A stable unique key used to prevent duplicate stop commands."),
  })
  .strict();

const toySetOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    command: z.object({
      id: z.string().uuid(),
      action: z.literal("set"),
      percent: z.number().int().min(1).max(40),
      status: toyCommandStatusSchema,
      created_at: z.string().datetime(),
      expires_at: z.string().datetime(),
    }),
  }),
});

const toyStopOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    command: z.object({
      id: z.string().uuid(),
      action: z.literal("stop"),
      percent: z.null(),
      status: toyCommandStatusSchema,
      created_at: z.string().datetime(),
      expires_at: z.string().datetime(),
    }),
  }),
});

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
        "Queue one short-lived toy intensity command in Leilei OS. Percent must be an integer from 1 to 40. The authenticated user and device binding are assigned by the server. This tool never accepts BLE bytes, URLs, scripts, or arbitrary payloads.",
      inputSchema: toySetInputSchema,
      outputSchema: toySetOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ percent, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "toy_set",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const command = await dependencies.toyCommandService.createIdempotently(
            userId,
            { action: "set", percent } satisfies ToyCreateInput,
            idempotency_key,
          );

          const result = {
            success: true as const,
            data: {
              command: {
                id: command.id,
                action: "set" as const,
                percent: command.percent as number,
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
                text: `Toy intensity command ${percent} queued successfully.`,
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
        "Queue one short-lived stop command for the bound toy in Leilei OS. This tool accepts no parameters and never accepts BLE bytes, URLs, scripts, or arbitrary payloads.",
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
                text: "Toy stop command queued successfully.",
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
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: "Authentication is required to control the toy.",
        },
      ],
    };
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

    return {
      isError: true as const,
      content: [{ type: "text" as const, text: message }],
    };
  }

  console.error(
    `toy_${action} failed`,
    error instanceof Error ? error.name : "UnknownError",
  );

  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: "Toy control is temporarily unavailable.",
      },
    ],
  };
}

export class ToyCommandAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "ToyCommandAuthenticationError";
  }
}
