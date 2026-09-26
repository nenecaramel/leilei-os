import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BridgeDomainError, type BridgeService } from "../../../domains/bridge/bridge-service.js";
import { ActiveUserAuthorizationError } from "../../../domains/require-active-user.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { safeErrorFingerprint, type SafeLogger } from "../../../observability/logger.js";
import { joinMcpContentLines } from "../content-contract.js";

const inputSchema = z.object({ eventId: z.string().uuid() }).strict();
const processingDataSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "reserved", "host_sent", "delivery_unknown"]),
  createdAt: z.string().datetime(),
  processingStatus: z.enum(["unclaimed", "claimed", "completed"]),
  modelClaimedAt: z.string().datetime().nullable(),
  modelCompletedAt: z.string().datetime().nullable(),
  deliveryReconciledAt: z.string().datetime().nullable(),
}).strict();
const outputSchema = z.object({
  success: z.boolean(),
  data: processingDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type BridgeProcessingToolDependencies = {
  bridgeService: Pick<BridgeService, "claimEvent" | "completeEvent">;
  getAuthenticatedUserId: () => string;
  requireActiveUser?: () => Promise<string>;
  logger?: SafeLogger;
};

function compact(event: Awaited<ReturnType<BridgeService["claimEvent"]>>) {
  return {
    id: event.id,
    status: event.status,
    createdAt: event.createdAt.toISOString(),
    processingStatus: event.processingState,
    modelClaimedAt: event.modelClaimedAt?.toISOString() ?? null,
    modelCompletedAt: event.modelCompletedAt?.toISOString() ?? null,
    deliveryReconciledAt: event.deliveryReconciledAt?.toISOString() ?? null,
  };
}

function safeError(error: unknown, action: "claim" | "complete", logger?: SafeLogger) {
  if (error instanceof ActiveUserAuthorizationError) {
    return createMcpToolError("AUTHENTICATION_REQUIRED", "Authentication is required for Bridge processing.");
  }
  if (error instanceof BridgeDomainError) {
    if (error.code === "EVENT_NOT_FOUND") {
      return createMcpToolError("EVENT_NOT_FOUND", "Bridge event was not found.");
    }
    if (error.code === "PROCESSING_CONFLICT") {
      return createMcpToolError("PROCESSING_CONFLICT", `Bridge event cannot be ${action}ed in its current state.`);
    }
  }
  const { name, code } = safeErrorFingerprint(error);
  logger?.error("bridge_processing_tool_failed", { name, code });
  return createMcpToolError("INTERNAL_ERROR", "Bridge processing is temporarily unavailable.");
}

export function registerBridgeProcessingTools(
  server: McpServer,
  dependencies: BridgeProcessingToolDependencies,
): void {
  const register = (
    name: "bridge_event_claim" | "bridge_event_complete",
    action: "claim" | "complete",
    operation: (userId: string, eventId: string) => Promise<Awaited<ReturnType<BridgeService["claimEvent"]>>>,
  ) => {
    server.registerTool(name, {
      title: action === "claim" ? "Claim a Bridge event" : "Complete a Bridge event",
      description: action === "claim"
        ? "Claim a Bridge event before handling it."
        : "Complete a claimed Bridge event after its work finishes.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ eventId }) => {
      try {
        const userId = dependencies.requireActiveUser
          ? await dependencies.requireActiveUser()
          : dependencies.getAuthenticatedUserId();
        const event = await operation(userId, eventId);
        return {
          content: [{ type: "text" as const, text: joinMcpContentLines([
            `Bridge event ${compact(event).id} ${action === "claim" ? "claimed" : "completed"}; status=${compact(event).status}; processing=${compact(event).processingStatus}.`,
          ]) }],
          structuredContent: { success: true as const, data: compact(event) },
        };
      } catch (error) {
        return safeError(error, action, dependencies.logger);
      }
    });
  };
  register("bridge_event_claim", "claim", (userId, eventId) => dependencies.bridgeService.claimEvent(userId, eventId));
  register("bridge_event_complete", "complete", (userId, eventId) => dependencies.bridgeService.completeEvent(userId, eventId));
}
