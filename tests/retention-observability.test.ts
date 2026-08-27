import assert from "node:assert/strict";
import test from "node:test";
import {
  createRetentionCoordinator,
  type RetentionCoordinatorEvent,
} from "../src/domains/retention/retention-coordinator.js";
import { createSafeLogger } from "../src/observability/logger.js";
import { createRetentionObserver } from "../src/observability/runtime-observers.js";

function parseLines(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("retention observer emits safe completion and failure fields", () => {
  const lines: string[] = [];
  const logger = createSafeLogger({
    level: "debug",
    now: () => new Date("2026-08-28T00:00:00.000Z"),
    sink: (_level, line) => lines.push(line),
  });
  const observe = createRetentionObserver(logger);

  observe({
    name: "mcp_idempotency_cleanup_completed",
    policy: "mcp_write_idempotency",
    deletedRows: 12,
    batches: 3,
    capped: true,
    durationMs: 45,
    rowId: "row-secret",
    userId: "user-secret",
    resourceId: "resource-secret",
    idempotencyKey: "key-secret",
    hash: "hash-secret",
    importSummary: "summary-secret",
    sql: "select secret",
    url: "https://private.example",
    error: "raw error message",
    stack: "private stack",
    sentinel: "private sentinel",
  } as RetentionCoordinatorEvent & Record<string, unknown>);
  observe({
    name: "data_import_runs_cleanup_failed",
    policy: "data_import_runs",
    batches: 2,
    durationMs: 17,
    error: "raw error message",
    stack: "private stack",
    sentinel: "private sentinel",
  } as RetentionCoordinatorEvent & Record<string, unknown>);

  assert.deepEqual(parseLines(lines), [
    {
      timestamp: "2026-08-28T00:00:00.000Z",
      level: "info",
      event: "mcp_idempotency_cleanup_completed",
      policy: "mcp_write_idempotency",
      deletedRows: 12,
      batches: 3,
      capped: true,
      durationMs: 45,
    },
    {
      timestamp: "2026-08-28T00:00:00.000Z",
      level: "warn",
      event: "data_import_runs_cleanup_failed",
      policy: "data_import_runs",
      batches: 2,
      durationMs: 17,
    },
  ]);
  const serialized = lines.join("\n");
  for (const secret of [
    "row-secret", "user-secret", "resource-secret", "key-secret", "hash-secret",
    "summary-secret", "select secret", "https://private.example", "raw error message",
    "private stack", "private sentinel",
  ]) {
    assert.equal(serialized.includes(secret), false, `unexpected secret: ${secret}`);
  }
});

test("retention observer and sink failures never reject the retention runner", async () => {
  const logger = {
    debug: () => { throw new Error("observer failure"); },
    info: () => { throw new Error("observer failure"); },
    warn: () => { throw new Error("observer failure"); },
    error: () => { throw new Error("observer failure"); },
  };
  const observer = createRetentionObserver(logger);
  const coordinator = createRetentionCoordinator({
    intervalMs: 1_000,
    observe: observer,
    policies: [{
      policy: "mcp_write_idempotency",
      retentionMs: 1_000,
      deleteBatch: async () => 0,
    }],
  });

  await assert.doesNotReject(coordinator.runNow());
});
