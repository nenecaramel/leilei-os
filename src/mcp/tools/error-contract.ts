import { z } from "zod";

export const mcpToolErrorDetailsSchema = z.object({
  code: z.string().trim().min(1).max(100),
  message: z.string().min(1).max(1_000),
}).strict();

export const mcpToolErrorStructuredContentSchema = z.object({
  success: z.literal(false),
  error: mcpToolErrorDetailsSchema,
}).strict();

export function createMcpToolError(
  code: string,
  message: string,
  text: string = message,
) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text }],
    structuredContent: {
      success: false as const,
      error: { code, message },
    },
  };
}
