import { z } from "zod";

export const mcpErrorRecoveryReasonSchema = z.enum([
  "stale_revision",
  "stale_version",
  "ambiguous_match",
  "missing_match",
  "idempotency_conflict",
  "invalid_cursor",
  "uncertain_outcome",
  "status_conflict",
]);

export const mcpErrorRecoveryFields = {
  retryable: z.boolean().optional().describe(
    "Whether the same request can be retried immediately.",
  ),
  reason: mcpErrorRecoveryReasonSchema.optional().describe(
    "Machine-readable recovery reason.",
  ),
  current_revision: z.number().int().nonnegative().nullable().optional().describe(
    "Current entity revision when known; otherwise null.",
  ),
  recommended_tool: z.string().trim().min(1).max(100).nullable().optional().describe(
    "Recommended recovery tool, or null.",
  ),
  recommended_arguments: z.record(z.string(), z.unknown()).nullable().optional().describe(
    "Arguments for recommended_tool, or null.",
  ),
};

export const mcpToolErrorDetailsSchema = z.object({
  code: z.string().trim().min(1).max(100),
  message: z.string().min(1).max(1_000),
  ...mcpErrorRecoveryFields,
}).strict();

export const mcpToolErrorStructuredContentSchema = z.object({
  success: z.literal(false),
  error: mcpToolErrorDetailsSchema,
}).strict();

export type McpErrorRecoveryHint = {
  retryable: boolean;
  reason: z.infer<typeof mcpErrorRecoveryReasonSchema>;
  current_revision: number | null;
  recommended_tool: string | null;
  recommended_arguments: Record<string, unknown> | null;
};

export function mcpErrorRecoveryHint(input: {
  retryable: boolean;
  reason: z.infer<typeof mcpErrorRecoveryReasonSchema>;
  currentRevision?: number | null;
  recommendedTool?: string | null;
  recommendedArguments?: Record<string, unknown> | null;
}): McpErrorRecoveryHint {
  return {
    retryable: input.retryable,
    reason: input.reason,
    current_revision: input.currentRevision ?? null,
    recommended_tool: input.recommendedTool ?? null,
    recommended_arguments: input.recommendedArguments ?? null,
  };
}

export function createMcpToolError(
  code: string,
  message: string,
  text: string = message,
  recovery?: McpErrorRecoveryHint,
) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text }],
    structuredContent: {
      success: false as const,
      error: {
        code,
        message,
        ...(recovery ?? {}),
      },
    },
  };
}
