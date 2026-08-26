import { z } from "zod";
import { UniverseServiceError } from "../../../domains/universe/universe-service.js";
import { createMcpToolError } from "../error-contract.js";

const universeWriteErrorCodes = [
  "USER_NOT_FOUND",
  "USER_DISABLED",
  "INVALID_UNIVERSE",
  "UNIVERSE_NOT_INITIALIZED",
  "NODE_NOT_FOUND",
  "NODE_CONFLICT",
  "RELATION_NOT_FOUND",
  "RELATION_INVALID",
  "RELATION_CONFLICT",
  "DIARY_SOURCE_NOT_FOUND",
  "DIARY_SOURCE_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "VERSION_CONFLICT",
  "UNIVERSE_FAILED",
] as const;

export const universeWriteErrorDetailsSchema = z.object({
  code: z.enum(universeWriteErrorCodes),
  message: z.string(),
}).strict();

export class UniverseAuthenticationError extends Error {
  constructor() {
    super("Authenticated MCP user context is unavailable.");
    this.name = "UniverseAuthenticationError";
  }
}

function safeUniverseServiceMessage(error: UniverseServiceError, notFoundMessage: string): string {
  if (error.code === "USER_DISABLED" || error.code === "USER_NOT_FOUND") {
    return "Universe is unavailable for the authenticated user.";
  }
  if (error.code === "UNIVERSE_NOT_INITIALIZED") return "Universe is not initialized.";
  if (error.code === "NODE_NOT_FOUND" || error.code === "RELATION_NOT_FOUND") return notFoundMessage;
  if (error.code === "VERSION_CONFLICT") return "Universe changed since expected_version; fresh-read before deciding whether to retry.";
  if (error.code === "RELATION_CONFLICT") return "That directional Universe relation already exists.";
  if (error.code === "DIARY_SOURCE_NOT_FOUND") return "That Universe Diary source binding was not found.";
  if (error.code === "DIARY_SOURCE_CONFLICT") return "That Diary is already attached to this Universe node.";
  if (error.code === "RELATION_INVALID") return "The Universe relation request is invalid.";
  if (error.code === "IDEMPOTENCY_CONFLICT") return "This idempotency key was already used for different Universe content.";
  return "The Universe request is invalid.";
}

export function safeUniverseError(error: unknown, notFoundMessage: string) {
  if (error instanceof UniverseAuthenticationError) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: "Authentication is required to access Universe." }],
    };
  }
  if (error instanceof UniverseServiceError) {
    const text = safeUniverseServiceMessage(error, notFoundMessage);
    return { isError: true as const, content: [{ type: "text" as const, text }] };
  }
  console.error("Universe MCP read failed", error instanceof Error ? error.name : "UnknownError");
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: "Universe is temporarily unavailable." }],
  };
}

export function safeUniverseReadError(error: unknown, notFoundMessage: string) {
  if (error instanceof UniverseAuthenticationError) {
    return createMcpToolError(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required to access Universe.",
    );
  }
  if (error instanceof UniverseServiceError) {
    const message = safeUniverseServiceMessage(error, notFoundMessage);
    return createMcpToolError(error.code, message);
  }
  console.error("Universe MCP read failed", error instanceof Error ? error.name : "UnknownError");
  return createMcpToolError(
    "INTERNAL_ERROR",
    "Universe is temporarily unavailable.",
  );
}

export function safeUniverseWriteError(error: unknown, notFoundMessage: string) {
  if (!(error instanceof UniverseServiceError)) {
    return safeUniverseError(error, notFoundMessage);
  }

  const message = safeUniverseServiceMessage(error, notFoundMessage);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `${error.code}: ${message}` }],
    structuredContent: {
      success: false as const,
      error: { code: error.code, message },
    },
  };
}
