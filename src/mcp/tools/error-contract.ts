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
    "Whether retrying the same request immediately, without an intervening read or input change, is appropriate.",
  ),
  reason: mcpErrorRecoveryReasonSchema.optional().describe(
    "Stable machine-readable recovery reason when the error has a concrete recovery path.",
  ),
  current_revision: z.number().int().nonnegative().nullable().optional().describe(
    "Current entity revision when known from the failed operation; null when recovery requires fresh readback or the domain has no entity revision.",
  ),
  recommended_tool: z.string().trim().min(1).max(100).nullable().optional().describe(
    "Tool to call next for authoritative recovery, or null when no tool call is recommended.",
  ),
  recommended_arguments: z.record(z.string(), z.unknown()).nullable().optional().describe(
    "Arguments for recommended_tool, or null when recommended_tool is null.",
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
