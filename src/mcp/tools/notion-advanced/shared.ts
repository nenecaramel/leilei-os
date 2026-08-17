import { NotionIntegrationError } from "../../../domains/notion/notion-read-integration.js";

export class NotionAdvancedAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "NotionAdvancedAuthenticationError";
  }
}

export function safeNotionAdvancedError(error: unknown) {
  if (error instanceof NotionAdvancedAuthenticationError) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: "Authentication is required to access Notion." }],
    };
  }
  if (error instanceof NotionIntegrationError) {
    const text = error.code === "NOT_CONFIGURED"
      ? "Notion is not configured."
      : error.code === "ACCESS_DENIED"
        ? "Notion access was denied."
        : error.code === "NOT_FOUND"
          ? "The Notion resource was not found or is inaccessible."
          : error.code === "RATE_LIMITED"
            ? "Notion is temporarily rate limited."
            : error.code === "INVALID_INPUT"
              ? "The Notion read request is invalid."
              : error.code === "MALFORMED_RESPONSE"
                ? "Notion returned an unsupported response."
                : "Notion is temporarily unavailable.";
    return { isError: true as const, content: [{ type: "text" as const, text }] };
  }
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: "Notion is temporarily unavailable." }],
  };
}

export const readOnlyNotionAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;
