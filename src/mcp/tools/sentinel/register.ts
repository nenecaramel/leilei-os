import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ActiveUserAuthorizationError } from "../../../domains/require-active-user.js";
import {
  SentinelDomainError,
  normalizeWakeContextCapsule,
  type SentinelService,
} from "../../../domains/sentinel/sentinel-service.js";
import type { SentinelWakeState } from "../../../domains/sentinel/sentinel-types.js";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";

const wakeIdSchema = z.string().uuid();
const wakeStateDataSchema = z.object({
  wakeId: z.string().uuid(),
  sentinelId: z.string().uuid(),
  controlRevision: z.number().int().nonnegative(),
  scheduledFor: z.string().datetime(),
  policyPrompt: z.string(),
  contextCapsule: z.string().nullable(),
  nextWakeAt: z.string().datetime().nullable(),
  lastValidWakeAt: z.string().datetime().nullable(),
  currentTime: z.string().datetime(),
  timezone: z.string(),
  limits: z.object({ minNextWakeSeconds: z.number().int(), maxNextWakeSeconds: z.number().int() }).strict(),
}).strict();
const stateOutputSchema = z.object({
  success: z.boolean(),
  data: wakeStateDataSchema.optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();
const contextCapsuleSchema = z.string().refine((value) => {
  try {
    normalizeWakeContextCapsule(value);
    return true;
  } catch {
    return false;
  }
}, { message: "Wake context capsule must be at most 1,024 Unicode code points." });
const completeInputSchema = z.object({
  wakeId: wakeIdSchema,
  decision: z.enum(["contact", "quiet"]),
  nextWakeAt: z.string().datetime(),
  contextCapsule: contextCapsuleSchema,
}).strict();
const completeOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    outcome: z.enum(["applied", "idempotent"]),
    wakeId: z.string().uuid(),
    decision: z.enum(["contact", "quiet"]),
    nextWakeAt: z.string().datetime(),
    finalizedAt: z.string().datetime(),
    controlRevision: z.number().int().nonnegative(),
    message: z.string().optional(),
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();
const claimOutputSchema = z.object({
  success: z.boolean(),
  data: z.object({
    outcome: z.enum(["applied", "idempotent"]),
    wakeId: z.string().uuid(),
    eventId: z.string().uuid(),
    sentinelId: z.string().uuid(),
    controlRevision: z.number().int().nonnegative(),
    claimedAt: z.string().datetime(),
    state: wakeStateDataSchema,
  }).strict().optional(),
  error: mcpToolErrorDetailsSchema.optional(),
}).strict();

export type SentinelMcpToolDependencies = {
  sentinelService: Pick<SentinelService, "getWakeState" | "completeWake" | "claimCurrentWake">;
  getAuthenticatedUserId: () => string;
  requireActiveUser?: () => Promise<string>;
};

async function authenticatedOwner(dependencies: SentinelMcpToolDependencies): Promise<string> {
  const userId = dependencies.getAuthenticatedUserId();
  if (dependencies.requireActiveUser) {
    const authorized = await dependencies.requireActiveUser();
    if (authorized !== userId) throw new ActiveUserAuthorizationError("USER_NOT_FOUND");
  }
  return userId;
}

function safeSentinelError(error: unknown) {
  if (error instanceof ActiveUserAuthorizationError) {
    return createMcpToolError("AUTHENTICATION_REQUIRED", "Authentication is required for Sentinel.");
  }
  if (error instanceof SentinelDomainError) {
    const message = error.code === "SENTINEL_WAKE_NOT_FOUND"
      ? "Sentinel wake was not found."
      : error.code === "NO_ACTIVE_WAKE"
        ? "No active Sentinel wake is available."
      : error.code === "SENTINEL_WAKE_CONFLICT"
        ? "Sentinel wake is no longer eligible."
        : error.message;
    return createMcpToolError(error.code, message);
  }
  return createMcpToolError("INTERNAL_ERROR", "Sentinel is temporarily unavailable.");
}

function stateData(state: SentinelWakeState) {
  return {
    wakeId: state.wakeId,
    sentinelId: state.sentinelId,
    controlRevision: state.controlRevision,
    scheduledFor: state.scheduledFor.toISOString(),
    policyPrompt: state.policyPrompt,
    contextCapsule: state.contextCapsule,
    nextWakeAt: state.nextWakeAt?.toISOString() ?? null,
    lastValidWakeAt: state.lastValidWakeAt?.toISOString() ?? null,
    currentTime: state.currentTime.toISOString(),
    timezone: state.timezone,
    limits: state.limits,
  };
}

export function registerSentinelTools(
  server: McpServer,
  dependencies: SentinelMcpToolDependencies,
): void {
  server.registerTool("sentinel_get_state", {
    title: "Read Sentinel wake state",
    description: "Read fresh owner-scoped Sentinel policy and wake state after claiming a wake. The authenticated session owns the wake; do not provide a user identity.",
    inputSchema: z.object({ wakeId: wakeIdSchema }).strict(),
    outputSchema: stateOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ wakeId }) => {
    try {
      const userId = await authenticatedOwner(dependencies);
      const state = await dependencies.sentinelService.getWakeState(userId, wakeId);
      return {
        content: [{ type: "text" as const, text: "Sentinel wake state retrieved." }],
        structuredContent: { success: true as const, data: stateData(state) },
      };
    } catch (error) {
      return safeSentinelError(error);
    }
  });

  server.registerTool("sentinel_claim_current_wake", {
    title: "Claim the current Sentinel wake",
    description: "Claim the authenticated owner's current active Sentinel wake using its server-owned active wake pointer and return a fresh policy/wake state from the same transaction. No wake identity is accepted or inferred from historical wakes; illegal or absent active state fails closed.",
    inputSchema: z.object({}).strict(),
    outputSchema: claimOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try {
      const userId = await authenticatedOwner(dependencies);
      const result = await dependencies.sentinelService.claimCurrentWake(userId);
      if (!("wake" in result)) {
        throw new SentinelDomainError(
          result.outcome === "no_active_wake" ? "NO_ACTIVE_WAKE" : "SENTINEL_WAKE_CONFLICT",
          result.outcome === "no_active_wake" ? "No active Sentinel wake is available." : "Sentinel wake is no longer eligible.",
        );
      }
      const claimedAt = result.wake.claimedAt;
      if (!(claimedAt instanceof Date) || !Number.isFinite(claimedAt.getTime())) {
        throw new SentinelDomainError("SENTINEL_WAKE_CONFLICT", "Sentinel wake claim did not return a valid timestamp.");
      }
      return {
        content: [{ type: "text" as const, text: result.outcome === "idempotent" ? "Sentinel wake was already claimed." : "Sentinel wake claimed." }],
        structuredContent: {
          success: true as const,
          data: {
            outcome: result.outcome,
            wakeId: result.wake.id,
            eventId: result.bridge.id,
            sentinelId: result.sentinel.id,
            controlRevision: result.sentinel.controlRevision,
            claimedAt: claimedAt.toISOString(),
            state: stateData(result.state),
          },
        },
      };
    } catch (error) {
      return safeSentinelError(error);
    }
  });

  server.registerTool("complete_sentinel_wake", {
    title: "Complete Sentinel wake",
    description: "Finalize one claimed Sentinel wake atomically. Choose contact or quiet, provide exactly one valid next wake, and replace the bounded context capsule (use an empty string to clear it). A successful quiet decision emits only 醒了一下，没事。; do not blindly retry uncertain outcomes.",
    inputSchema: completeInputSchema,
    outputSchema: completeOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ wakeId, decision, nextWakeAt, contextCapsule }) => {
    try {
      const userId = await authenticatedOwner(dependencies);
      const result = await dependencies.sentinelService.completeWake(userId, {
        wakeId,
        decision,
        nextWakeAt: new Date(nextWakeAt),
        contextCapsule,
      });
      if (!("wake" in result)) throw new SentinelDomainError("SENTINEL_WAKE_CONFLICT", "Sentinel wake is no longer active.");
      const message = decision === "quiet" ? "醒了一下，没事。" : undefined;
      return {
        content: [{ type: "text" as const, text: message ?? "Sentinel wake completed." }],
        structuredContent: {
          success: true as const,
          data: {
            outcome: result.outcome,
            wakeId: result.wake.id,
            decision: result.wake.decision!,
            nextWakeAt: result.wake.nextWakeAt!.toISOString(),
            finalizedAt: result.wake.finalizedAt!.toISOString(),
            controlRevision: result.sentinel.controlRevision,
            ...(message ? { message } : {}),
          },
        },
      };
    } catch (error) {
      return safeSentinelError(error);
    }
  });
}
