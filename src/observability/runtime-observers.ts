import type { RetentionCoordinatorEvent } from "../domains/retention/retention-coordinator.js";
import type { McpSessionObserverEvent } from "../mcp/server/session-registry.js";
import type { SafeLogFields, SafeLogger } from "./logger.js";

type LegacyIdempotencyCleanupObserverEvent =
  | { name: "mcp_idempotency_cleanup_completed"; deletedRows: number; durationMs: number }
  | { name: "mcp_idempotency_cleanup_failed"; durationMs: number };

type McpLifecycleEvent = McpSessionObserverEvent | LegacyIdempotencyCleanupObserverEvent;

const MCP_OBSERVABLE_FIELDS = new Set([
  "namespace",
  "reason",
  "activeSessionCount",
  "activeNamespaceCount",
  "deletedRows",
  "durationMs",
  "diagnosticSessionOrdinal",
  "protocolVersion",
  "clientName",
  "clientVersion",
  "hadUnknownSessionHeader",
  "activeUserNamespaceCount",
  "idleUserNamespaceCount",
  "inFlightUserNamespaceCount",
  "oldestIdleAgeMs",
  "inFlightCountAtClose",
  "idleAgeMsAtClose",
]);

export function projectMcpLifecycleEvent(event: McpLifecycleEvent): SafeLogFields {
  const projected: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(event)) {
    if (!MCP_OBSERVABLE_FIELDS.has(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      projected[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      projected[key] = value;
    }
  }
  return projected;
}

export function createMcpLifecycleObserver(
  logger: SafeLogger,
): (event: McpLifecycleEvent) => void {
  return (event) => {
    const fields = projectMcpLifecycleEvent(event);
    if (event.name === "mcp_idempotency_cleanup_failed") {
      logger.warn(event.name, fields);
      return;
    }
    logger.info(event.name, fields);
  };
}

const RETENTION_OBSERVABLE_FIELDS = new Set([
  "policy",
  "deletedRows",
  "batches",
  "capped",
  "durationMs",
]);

export function projectRetentionEvent(event: RetentionCoordinatorEvent): SafeLogFields {
  const projected: Record<string, string | number | boolean | null> = {};
  for (const key of RETENTION_OBSERVABLE_FIELDS) {
    const value = event[key as keyof RetentionCoordinatorEvent];
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      projected[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      projected[key] = value;
    }
  }
  return projected;
}

export function createRetentionObserver(
  logger: SafeLogger,
): (event: RetentionCoordinatorEvent) => void {
  return (event) => {
    try {
      const fields = projectRetentionEvent(event);
      if (event.name.endsWith("_failed")) {
        logger.warn(event.name, fields);
      } else {
        logger.info(event.name, fields);
      }
    } catch {
      // Logging is observational and must never affect retention correctness.
    }
  };
}

export type ShutdownStage = "mcp_sessions" | "http_drain" | "background_work" | "database";

export type ShutdownObserverEvent =
  | { name: "shutdown_started"; signal: "SIGINT" | "SIGTERM" }
  | { name: "shutdown_stage_failed"; stage: ShutdownStage; durationMs: number }
  | { name: "shutdown_deadline_exceeded"; durationMs: number }
  | { name: "shutdown_completed"; success: boolean; durationMs: number };

export function createShutdownObserver(logger: SafeLogger): (event: ShutdownObserverEvent) => void {
  return (event) => {
    const { name, ...fields } = event;
    if (name === "shutdown_stage_failed" || name === "shutdown_deadline_exceeded") {
      logger.error(name, fields);
    } else {
      logger.info(name, fields);
    }
  };
}
