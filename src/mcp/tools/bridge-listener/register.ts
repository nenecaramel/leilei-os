import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { BRIDGE_RESOURCE_URI } from "./listener-resource.js";
import type { BridgeEventRecord } from "../../../domains/bridge/bridge-event-types.js";
import type { BridgeService } from "../../../domains/bridge/bridge-service.js";

export type BridgeListenerToolDependencies = {
  bridgeService: Pick<BridgeService, "startListener" | "stopListener" | "reserveNext" | "markDispatchStarted" | "markHostSent" | "markDeliveryUnknown" | "release">;
  getAuthenticatedUserId: () => string;
  listenerInstanceId: string;
};

const eventIdSchema = z.object({ eventId: z.string().uuid() }).strict();
const errorSchema = z.object({ eventId: z.string().uuid(), safeErrorCode: z.string().trim().min(1).max(64) }).strict();
const outputSchema = { success: z.boolean(), data: z.record(z.unknown()).optional(), error: mcpToolErrorDetailsSchema.optional() };

function ok(data: Record<string, unknown> = {}) { return { content: [{ type: "text" as const, text: "Bridge listener operation completed." }], structuredContent: { success: true as const, data } }; }
function fail(error: unknown) {
  if (error instanceof Error && "code" in error && error.code === "LISTENER_BUSY") {
    return createMcpToolError("LISTENER_BUSY", "Bridge listener is already occupied.");
  }
  return createMcpToolError("BRIDGE_UNAVAILABLE", "Bridge listener is temporarily unavailable.");
}
function invoke(deps: BridgeListenerToolDependencies, operation: (userId: string) => Promise<Record<string, unknown>>) {
  return async () => { try { return ok(await operation(deps.getAuthenticatedUserId())); } catch (error) { return fail(error); } };
}

export function registerBridgeListenerTools(server: McpServer, deps: BridgeListenerToolDependencies): void {
  registerAppTool(server, "bridge_listener_open", { title: "Open LeileiOS Message Bridge", description: "Open the LeileiOS message bridge listener.", _meta: { ui: { resourceUri: BRIDGE_RESOURCE_URI, visibility: ["model"] } }, outputSchema }, async () => ok({ status: "idle", resource_uri: BRIDGE_RESOURCE_URI }));
  const appMeta = { ui: { visibility: ["app"] as ["app"] } };
  registerAppTool(server, "bridge_listener_start", { description: "Start the message bridge listener.", _meta: appMeta, outputSchema }, invoke(deps, async (userId) => ({ state: await deps.bridgeService.startListener(userId, deps.listenerInstanceId) })));
  registerAppTool(server, "bridge_listener_stop", { description: "Stop the message bridge listener.", _meta: appMeta, outputSchema }, invoke(deps, async (userId) => ({ stopped: await deps.bridgeService.stopListener(userId, deps.listenerInstanceId) })));
  registerAppTool(server, "bridge_listener_sync", { description: "Synchronize one queued bridge event.", _meta: appMeta, outputSchema }, async () => {
    try {
      const event = await deps.bridgeService.reserveNext(deps.getAuthenticatedUserId(), deps.listenerInstanceId);
      const result = ok({ event: event ? compactEvent(event) : null });
      return event ? { ...result, _meta: { bridgeEvent: event } } : result;
    } catch (error) {
      return fail(error);
    }
  });
  registerAppTool(server, "bridge_listener_dispatch_started", { inputSchema: eventIdSchema, description: "Mark a bridge event as dispatched.", _meta: appMeta, outputSchema }, async ({ eventId }) => invoke(deps, async (userId) => ({ event: compactEvent(await deps.bridgeService.markDispatchStarted(userId, deps.listenerInstanceId, eventId)) }))());
  registerAppTool(server, "bridge_listener_delivered", { inputSchema: eventIdSchema, description: "Acknowledge a delivered bridge event.", _meta: appMeta, outputSchema }, async ({ eventId }) => invoke(deps, async (userId) => ({ event: compactEvent(await deps.bridgeService.markHostSent(userId, deps.listenerInstanceId, eventId)) }))());
  registerAppTool(server, "bridge_listener_delivery_unknown", { inputSchema: errorSchema, description: "Quarantine an uncertain bridge delivery.", _meta: appMeta, outputSchema }, async ({ eventId, safeErrorCode }) => invoke(deps, async (userId) => ({ event: compactEvent(await deps.bridgeService.markDeliveryUnknown(userId, deps.listenerInstanceId, eventId, safeErrorCode)) }))());
  registerAppTool(server, "bridge_listener_release", { inputSchema: errorSchema, description: "Release a definitely rejected bridge event.", _meta: appMeta, outputSchema }, async ({ eventId, safeErrorCode }) => invoke(deps, async (userId) => ({ event: compactEvent(await deps.bridgeService.release(userId, deps.listenerInstanceId, eventId, safeErrorCode)) }))());
}

function compactEvent(event: BridgeEventRecord): Record<string, unknown> { return { id: event.id, status: event.status, createdAt: event.createdAt.toISOString() }; }
