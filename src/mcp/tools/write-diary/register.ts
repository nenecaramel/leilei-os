import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DiaryDomainError,
  type AuthenticatedDiaryContext,
  type CreateDiaryInput,
  type CreateDiaryResult,
} from "../../../domains/diary/diary-service.js";
import { invokeMcpWrite } from "../write-context.js";

const writeDiaryInputSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(200)
      .describe("A concise title for the diary entry."),
    content: z
      .string()
      .min(1)
      .max(20_000)
      .describe("The complete diary entry content."),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("The diary date in YYYY-MM-DD format; never use relative dates."),
    tags: z
      .array(z.string().min(1).max(50))
      .max(20)
      .describe("Organizational labels for the diary entry; use an empty array when none apply."),
    mood: z
      .string()
      .min(1)
      .max(50)
      .optional()
      .describe("An optional concise mood label."),
    idempotency_key: z
      .string()
      .min(16)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .describe("A stable unique key used to prevent duplicate diary creation."),
  })
  .strict();

const writeDiaryOutputSchema = z.object({
  success: z.literal(true),
  data: z.object({
    diary: z.object({
      id: z.string().uuid(),
      title: z.string(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      tags: z.array(z.string()),
      mood: z.string().nullable(),
      created_at: z.string().datetime(),
    }),
    metadata: z.object({
      created: z.boolean(),
      idempotent_replay: z.boolean(),
    }),
  }),
});

export interface WriteDiaryToolService {
  createMcpDiary(
    context: AuthenticatedDiaryContext,
    input: CreateDiaryInput,
  ): Promise<CreateDiaryResult>;
}

export type WriteDiaryToolDependencies = {
  diaryService: WriteDiaryToolService;
  getAuthenticatedUserId: () => string;
};

export function registerWriteDiaryTool(
  server: McpServer,
  dependencies: WriteDiaryToolDependencies,
): void {
  server.registerTool(
    "write_diary",
    {
      title: "Write a personal diary entry",
      description:
        "Create one personal diary entry in Leilei OS. This is a persistent write operation. Supply an exact YYYY-MM-DD date and a stable idempotency key. The authenticated user and source are assigned by the server and cannot be selected by tool input.",
      inputSchema: writeDiaryInputSchema,
      outputSchema: writeDiaryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ title, content, date, tags, mood, idempotency_key }) =>
      invokeMcpWrite({
        toolName: "write_diary",
        getAuthenticatedUserId: dependencies.getAuthenticatedUserId,
        operation: async ({ userId }) => {
          const data = await dependencies.diaryService.createMcpDiary(
            { userId },
            {
              title,
              content,
              date,
              tags,
              mood,
              idempotencyKey: idempotency_key,
            },
          );
          const result = { success: true as const, data };
          const message = data.metadata.idempotent_replay
            ? "The existing diary entry was returned without creating a duplicate."
            : "Diary entry created successfully.";

          return {
            content: [{ type: "text", text: message }],
            structuredContent: result,
          };
        },
        mapError: toSafeToolError,
      }),
  );
}

function toSafeToolError(error: unknown) {
  if (error instanceof WriteDiaryAuthenticationError) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: "Authentication is required to write a diary entry.",
        },
      ],
    };
  }

  if (error instanceof DiaryDomainError) {
    const message =
      error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
        ? "Diary writing is unavailable for the authenticated user."
        : error.code === "IDEMPOTENCY_CONFLICT"
          ? "This idempotency key was already used for different diary content."
          : "The diary request is invalid.";

    return {
      isError: true as const,
      content: [{ type: "text" as const, text: message }],
    };
  }

  console.error(
    "write_diary failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: "Diary writing is temporarily unavailable.",
      },
    ],
  };
}

export class WriteDiaryAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "WriteDiaryAuthenticationError";
  }
}
