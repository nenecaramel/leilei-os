import assert from "node:assert/strict";
import test from "node:test";
import { SHUTDOWN_DEADLINE_MS, createGracefulShutdownController } from "../src/app/graceful-shutdown.js";
import type { ShutdownObserverEvent } from "../src/observability/runtime-observers.js";

function fakeServer(events: string[], options: { stuck?: boolean; error?: Error } = {}) {
  return {
    close(callback: (error?: Error) => void) {
      events.push("http_close_started");
      if (!options.stuck) {
        queueMicrotask(() => {
          events.push("http_drained");
          callback(options.error);
        });
      }
    },
  };
}

function createHarness(options: { stuckHttp?: boolean; mcpError?: boolean } = {}) {
  const events: string[] = [];
  const observed: ShutdownObserverEvent[] = [];
  let deadlineCallback: (() => void) | undefined;
  let deadlineMs: number | undefined;
  let exitCalls = 0;
  const shutdown = createGracefulShutdownController({
    server: fakeServer(events, { stuck: options.stuckHttp }),
    closeMcpSessions: async () => {
      events.push("mcp_close");
      if (options.mcpError) throw new Error("provider detail must stay private");
    },
    stopBackgroundWork: () => events.push("background_stop"),
    drainBackgroundWork: async () => events.push("background_drain"),
    closeDatabase: async () => events.push("database_close"),
    exit: (code) => {
      exitCalls += 1;
      events.push(`exit:${code}`);
    },
    setDeadline: (callback, milliseconds) => {
      deadlineCallback = callback;
      deadlineMs = milliseconds;
      return { deadline: true };
    },
    clearDeadline: () => events.push("deadline_clear"),
    observer: (event: ShutdownObserverEvent) => observed.push(event),
    now: () => 100,
  });
  return { shutdown, events, observed, fireDeadline: () => deadlineCallback?.(), get deadlineMs() { return deadlineMs; }, get exitCalls() { return exitCalls; } };
}

test("graceful shutdown stops admission in the server-close turn and drains retention before the database", async () => {
  const events: string[] = [];
  let completeHttp!: () => void;
  let releaseRetention!: () => void;
  const retentionBlocked = new Promise<void>((resolve) => { releaseRetention = resolve; });
  let retentionStarts = 1;
  let stopping = false;
  let stopCalls = 0;
  const runRetentionFromInterval = () => {
    if (!stopping) retentionStarts += 1;
  };
  const shutdown = createGracefulShutdownController({
    server: {
      close(callback) {
        events.push("server_close_started");
        completeHttp = () => {
          events.push("http_drain_completed");
          callback();
        };
      },
    },
    closeMcpSessions: async () => {
      events.push("mcp_sessions_started");
      events.push("mcp_sessions_completed");
    },
    stopBackgroundWork: () => {
      stopCalls += 1;
      stopping = true;
      events.push("background_stop");
    },
    drainBackgroundWork: async () => {
      events.push("background_work_started");
      await retentionBlocked;
      events.push("retention_run_completed");
      events.push("background_work_completed");
    },
    closeDatabase: async () => {
      events.push("database_closed");
    },
    exit: (code) => events.push(`exit:${code}`),
    observer: (event) => {
      if (event.name === "shutdown_started") events.push("shutdown_started");
    },
  });

  const first = shutdown("SIGTERM");
  const second = shutdown("SIGINT");
  assert.strictEqual(first, second);
  runRetentionFromInterval();
  assert.equal(retentionStarts, 1);
  assert.equal(stopCalls, 1);
  assert.deepEqual(events.slice(0, 5), [
    "shutdown_started",
    "server_close_started",
    "background_stop",
    "mcp_sessions_started",
    "mcp_sessions_completed",
  ]);

  completeHttp();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(events.includes("database_closed"), false);
  assert.equal(events.includes("background_work_started"), true);
  releaseRetention();
  await first;

  assert.deepEqual(events, [
    "shutdown_started",
    "server_close_started",
    "background_stop",
    "mcp_sessions_started",
    "mcp_sessions_completed",
    "http_drain_completed",
    "background_work_started",
    "retention_run_completed",
    "background_work_completed",
    "database_closed",
    "exit:0",
  ]);
});

test("duplicate shutdown signals share one execution", async () => {
  const harness = createHarness();
  const first = harness.shutdown("SIGTERM");
  const second = harness.shutdown("SIGINT");
  assert.strictEqual(first, second);
  await first;
  assert.equal(harness.events.filter((event) => event === "mcp_close").length, 1);
  assert.equal(harness.exitCalls, 1);
});

test("MCP close failure still drains every resource and exits one", async () => {
  const harness = createHarness({ mcpError: true });
  await harness.shutdown("SIGTERM");
  assert.deepEqual(harness.events, [
    "http_close_started",
    "background_stop",
    "mcp_close",
    "http_drained",
    "background_drain",
    "database_close",
    "deadline_clear",
    "exit:1",
  ]);
});

test("deadline exits once when HTTP close is stuck", async () => {
  const harness = createHarness({ stuckHttp: true });
  const draining = harness.shutdown("SIGTERM");
  assert.equal(harness.deadlineMs, SHUTDOWN_DEADLINE_MS);
  harness.fireDeadline();
  await draining;
  assert.equal(harness.exitCalls, 1);
  assert.deepEqual(harness.events, ["http_close_started", "background_stop", "mcp_close", "exit:1"]);
  assert.deepEqual(harness.observed.map((event) => event.name), [
    "shutdown_started",
    "shutdown_deadline_exceeded",
  ]);
});

test("shutdown observer reports completion and typed stage failures", async () => {
  const success = createHarness();
  await success.shutdown("SIGTERM");
  assert.deepEqual(success.observed.map((event) => event.name), [
    "shutdown_started",
    "shutdown_completed",
  ]);
  assert.equal(success.observed.at(-1)?.name, "shutdown_completed");
  assert.equal((success.observed.at(-1) as { success: boolean }).success, true);

  const failure = createHarness({ mcpError: true });
  await failure.shutdown("SIGTERM");
  assert.deepEqual(failure.observed.map((event) => event.name), [
    "shutdown_started",
    "shutdown_stage_failed",
    "shutdown_completed",
  ]);
  const stage = failure.observed.find((event) => event.name === "shutdown_stage_failed");
  assert.equal(stage && "stage" in stage ? stage.stage : undefined, "mcp_sessions");
  assert.equal(stage && "durationMs" in stage ? Number.isFinite(stage.durationMs) : false, true);
  assert.equal((failure.observed.at(-1) as { success: boolean }).success, false);
});

test("observer failures are non-fatal and deadline-first shutdown has no late completion", async () => {
  const observed: ShutdownObserverEvent[] = [];
  const deadlineHarness = createGracefulShutdownController({
    server: fakeServer([], { stuck: true }),
    closeMcpSessions: async () => undefined,
    drainBackgroundWork: async () => undefined,
    closeDatabase: async () => undefined,
    exit: () => undefined,
    observer: (event: ShutdownObserverEvent) => {
      observed.push(event);
      throw new Error("observer must not affect shutdown");
    },
    setDeadline: (callback) => { callback(); return {}; },
  });
  await deadlineHarness("SIGTERM");
  assert.deepEqual(observed.map((event) => event.name), [
    "shutdown_started",
    "shutdown_deadline_exceeded",
  ]);
});
