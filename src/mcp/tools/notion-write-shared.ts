import { z } from "zod";
import { NotionApiError, type NotionJsonObject } from "../../domains/notion/notion-transport.js";

export const notionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => !value.includes("://") && !value.includes("/") && !value.includes("\\"),
    "Notion resource IDs must not be URLs or paths.",
  );

export const notionBodySchema = z
  .record(z.string().max(200), z.any())
  .refine((value) => {
    try {
      return JSON.stringify(value).length <= 250_000;
    } catch {
      return false;
    }
  }, "Notion request body is too large.");

export const notionOutputSchema = z.object({
  success: z.literal(true),
  data: z.record(z.string(), z.any()),
}).strict();

export function notionSuccess(data: NotionJsonObject, text: string) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { success: true as const, data },
  };
}

export function notionWriteError(error: unknown): string {
  if (!(error instanceof NotionApiError)) {
    return "Notion is temporarily unavailable.";
  }

  switch (error.code) {
    case "NOT_CONFIGURED":
      return "Notion is not configured.";
    case "ACCESS_DENIED":
      return "Notion write access is unavailable.";
    case "NOT_FOUND":
      return "The Notion resource was not found or is not accessible.";
    case "CONFLICT":
      return "Notion could not apply the change because the resource changed or is busy.";
    case "RATE_LIMITED":
      return "Notion is temporarily rate limited.";
    case "VALIDATION":
      return "Notion rejected the requested change.";
    case "UPSTREAM":
      return "Notion is temporarily unavailable.";
  }
}

export function notionErrorResult(error: unknown) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: notionWriteError(error) }],
  };
}

export class NotionWriteAuthenticationError extends Error {
  constructor() {
    super("Notion write authentication is required.");
    this.name = "NotionWriteAuthenticationError";
  }
}

export function notionAuthErrorResult() {
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text: "Authentication is required to modify Notion.",
    }],
  };
}
