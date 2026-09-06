import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMcpToolError, mcpToolErrorDetailsSchema } from "../error-contract.js";
import { BRIDGE_RESOURCE_URI, getSentinelWakeRoutingMetadata } from "./listener-resource.js";
import type { BridgeEventRecord } from "../../../domains/bridge/bridge-event-types.js";
import type { BridgeService } from "../../../domains/bridge/bridge-service.js";

export type BridgeListenerToolDependencies = {
  bridgeService: Pick<BridgeService, "startListener" | "stopListener" | "reserveNext" | "markDispatchStarted" | "markHostSent" | "markDeliveryUnknown" | "release">;
  getAuthenticatedUserId: () => string;
};

const listenerInstanceIdSchema = z.string().uuid();
const listenerSchema = z.object({ listenerInstanceId: listenerInstanceIdSchema }).strict();
const eventIdSchema = z.object({ listenerInstanceId: listenerInstanceIdSchema, eventId: z.string().uuid() }).strict();
const errorSchema = z.object({ listenerInstanceId: listenerInstanceIdSchema, eventId: z.string().uuid(), safeErrorCode: z.string().trim().min(1).max(64) }).strict();
const outputSchema = { success: z.boolean(), data: z.record(z.unknown()).optional(), error: mcpToolErrorDetailsSchema.optional() };

function ok(data: Record<string, unknown> = {}) {
  const details: string[] = [];
  if (typeof data.status === "string") details.push(`status=${data.status}`);
  if (typeof data.state === "string") details.push(`state=${data.state}`);
  if (typeof data.stopped === "boolean") details.push(`stopped=${data.stopped}`);
  if (typeof data.resource_uri === "string") details.push(`resource=${data.resource_uri}`);
  if (data.event && typeof data.event === "object" && !Array.isArray(data.event)) {
    const event = data.event as Record<string, unknown>;
    if (typeof event.id === "string") details.push(`event=${event.id}`);
    if (typeof event.status === "string") details.push(`event_status=${event.status}`);
  }
  return {
    content: [{ type: "text" as const, text: `Bridge listener operation completed${details.length ? `: ${details.join(", ")}` : "."}` }],
    structuredContent: { success: true as const, data },
  };
}
function fail(error: unknown) {
  if (error instanceof Error && "code" in error && error.code === "LISTENER_BUSY") {
    return createMcpToolError("LISTENER_BUSY", "Bridge listener is already occupied.");
  }
  return createMcpToolError("BRIDGE_UNAVAILABLE", "Bridge listener is temporarily unavailable.");
}
async function invoke(
  deps: BridgeListenerToolDependencies,
  listenerInstanceId: string,
  operation: (userId: string, listenerInstanceId: string) => Promise<Record<string, unknown>>,
) {
  try {
    return ok(await operation(deps.getAuthenticatedUserId(), listenerInstanceId));
  } catch (error) {
    return fail(error);
  }
}

export function registerBridgeListenerTools(server: McpServer, deps: BridgeListenerToolDependencies): void {
  registerAppTool(server, "bridge_listener_open", { title: "Open LeileiOS Message Bridge", description: "Open the LeileiOS message bridge listener.", _meta: { ui: { resourceUri: BRIDGE_RESOURCE_URI, visibility: ["model"] } }, outputSchema }, async () => ok({ status: "idle", resource_uri: BRIDGE_RESOURCE_URI }));
  const appMeta = { ui: { visibility: ["app"] as ["app"] } };
  registerAppTool(server, "bridge_listener_start", { inputSchema: listenerSchema, description: "Start the message bridge listener.", _meta: appMeta, outputSchema }, async ({ listenerInstanceId }) => invoke(deps, listenerInstanceId, async (userId, id) => ({ state: await deps.bridgeService.startListener(userId, id) })));
  registerAppTool(server, "bridge_listener_stop", { inputSchema: listenerSchema, description: "Stop the message bridge listener.", _meta: appMeta, outputSchema }, async ({ listenerInstanceId }) => invoke(deps, listenerInstanceId, async (userId, id) => ({ stopped: await deps.bridgeService.stopListener(userId, id) })));
  registerAppTool(server, "bridge_listener_sync", { inputSchema: listenerSchema, description: "Synchronize one queued bridge event.", _meta: appMeta, outputSchema }, async ({ listenerInstanceId }) => {
    try {
      const event = await deps.bridgeService.reserveNext(deps.getAuthenticatedUserId(), listenerInstanceId);
      const result = ok({ event: event ? compactEvent(event) : null });
      if (!event) return result;
      const wakeMetadata = getSentinelWakeRoutingMetadata(event);
      return {
        ...result,
        _meta: {
          bridgeEvent: event,
          ...(wakeMetadata ? { wakeMetadata } : {}),
        },
      };
    } catch (error) {
      return fail(error);
    }
  });
  registerAppTool(server, "bridge_listener_dispatch_started", { inputSchema: eventIdSchema, description: "Mark a bridge event as dispatched.", _meta: appMeta, outputSchema }, async ({ listenerInstanceId, eventId }) => invoke(deps, listenerInstanceId, async (userId, id) => ({ event: compactEvent(await deps.bridgeService.markDispatchStarted(userId, id, eventId)) })));
  registerAppTool(server, "bridge_listener_delivered", { inputSchema: eventIdSchema, description: "Acknowledge a delivered bridge event.", _meta: appMeta, outputSchema }, async ({ listenerInstanceId, eventId }) => invoke(deps, listenerInstanceId, async (userId, id) => ({ event: compactEvent(await deps.bridgeService.markHostSent(userId, id, eventId)) })));
  registerAppTool(server, "bridge_listener_delivery_unknown", { inputSchema: errorSchema, description: "Quarantine an uncertain bridge delivery.", _meta: appMeta, outputSchema }, async ({ listenerInstanceId, eventId, safeErrorCode }) => invoke(deps, listenerInstanceId, async (userId, id) => ({ event: compactEvent(await deps.bridgeService.markDeliveryUnknown(userId, id, eventId, safeErrorCode)) })));
  registerAppTool(server, "bridge_listener_release", { inputSchema: errorSchema, description: "Release a definitely rejected bridge event.", _meta: appMeta, outputSchema }, async ({ listenerInstanceId, eventId, safeErrorCode }) => invoke(deps, listenerInstanceId, async (userId, id) => ({ event: compactEvent(await deps.bridgeService.release(userId, id, eventId, safeErrorCode)) })));
}

function compactEvent(event: BridgeEventRecord): Record<string, unknown> { return { id: event.id, status: event.status, createdAt: event.createdAt.toISOString() }; }
