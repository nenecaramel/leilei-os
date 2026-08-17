import { UniverseServiceError } from "../../../domains/universe/universe-service.js";

export class UniverseAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "UniverseAuthenticationError";
  }
}

export function safeUniverseError(error: unknown, notFoundMessage: string) {
  if (error instanceof UniverseAuthenticationError) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: "Authentication is required to access Universe." }],
    };
  }
  if (error instanceof UniverseServiceError) {
    const text = error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND"
      ? "Universe is unavailable for the authenticated user."
      : error.code === "UNIVERSE_NOT_INITIALIZED"
        ? "Universe is not initialized."
        : error.code === "NODE_NOT_FOUND" || error.code === "RELATION_NOT_FOUND"
          ? notFoundMessage
          : "The Universe request is invalid.";
    return { isError: true as const, content: [{ type: "text" as const, text }] };
  }
  console.error("Universe MCP read failed", error instanceof Error ? error.name : "UnknownError");
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: "Universe is temporarily unavailable." }],
  };
}
