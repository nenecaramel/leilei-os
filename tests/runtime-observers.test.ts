import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpLifecycleObserver,
  createShutdownObserver,
  projectMcpLifecycleEvent,
} from "../src/observability/runtime-observers.js";

test("MCP lifecycle projection keeps approved diagnostics and drops private fields", () => {
  const projected = projectMcpLifecycleEvent({
    name: "mcp_session_created",
    diagnosticSessionOrdinal: 4,
    namespace: "public",
    activeSessionCount: 2,
    activeNamespaceCount: 2,
    userId: "private-user-id",
    secret: "provider secret must not appear",
  } as never);

  assert.deepEqual(projected, {
    diagnosticSessionOrdinal: 4,
    namespace: "public",
    activeSessionCount: 2,
    activeNamespaceCount: 2,
  });
  assert.equal(JSON.stringify(projected).includes("private-user-id"), false);
  assert.equal(JSON.stringify(projected).includes("provider secret"), false);
});

test("idempotency cleanup failures are warning logs and other lifecycle events are info logs", () => {
  const captured: Array<{ level: string; event: string; fields?: unknown }> = [];
  const observer = createMcpLifecycleObserver({
    debug: () => undefined,
    info: (event, fields) => captured.push({ level: "info", event, fields }),
    warn: (event, fields) => captured.push({ level: "warn", event, fields }),
    error: () => undefined,
  });

  observer({ name: "mcp_idempotency_cleanup_failed", durationMs: 12 });
  observer({ name: "mcp_idempotency_cleanup_completed", deletedRows: 2, durationMs: 4 });

  assert.deepEqual(captured, [
    { level: "warn", event: "mcp_idempotency_cleanup_failed", fields: { durationMs: 12 } },
    { level: "info", event: "mcp_idempotency_cleanup_completed", fields: { deletedRows: 2, durationMs: 4 } },
  ]);
});

test("shutdown observer maps lifecycle severity without leaking unapproved fields", () => {
  const captured: Array<{ level: string; event: string; fields?: unknown }> = [];
  const observer = createShutdownObserver({
    debug: () => undefined,
    info: (event, fields) => captured.push({ level: "info", event, fields }),
    warn: () => undefined,
    error: (event, fields) => captured.push({ level: "error", event, fields }),
  });

  observer({ name: "shutdown_started", signal: "SIGTERM" });
  observer({ name: "shutdown_stage_failed", stage: "database", durationMs: 4 });
  observer({ name: "shutdown_completed", success: false, durationMs: 8 });

  assert.deepEqual(captured, [
    { level: "info", event: "shutdown_started", fields: { signal: "SIGTERM" } },
    { level: "error", event: "shutdown_stage_failed", fields: { stage: "database", durationMs: 4 } },
    { level: "info", event: "shutdown_completed", fields: { success: false, durationMs: 8 } },
  ]);
});
