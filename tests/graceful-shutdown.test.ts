import assert from "node:assert/strict";
import test from "node:test";
import { SHUTDOWN_DEADLINE_MS, createGracefulShutdownController } from "../src/app/graceful-shutdown.js";

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
  let deadlineCallback: (() => void) | undefined;
  let deadlineMs: number | undefined;
  let exitCalls = 0;
  const shutdown = createGracefulShutdownController({
    server: fakeServer(events, { stuck: options.stuckHttp }),
    closeMcpSessions: async () => {
      events.push("mcp_close");
      if (options.mcpError) throw new Error("provider detail must stay private");
    },
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
  });
  return { shutdown, events, fireDeadline: () => deadlineCallback?.(), get deadlineMs() { return deadlineMs; }, get exitCalls() { return exitCalls; } };
}

test("graceful shutdown drains HTTP, MCP, background work, then database", async () => {
  const harness = createHarness();
  await harness.shutdown("SIGTERM");
  assert.deepEqual(harness.events, [
    "http_close_started",
    "mcp_close",
    "http_drained",
    "background_drain",
    "database_close",
    "deadline_clear",
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
  assert.deepEqual(harness.events, ["http_close_started", "mcp_close", "exit:1"]);
});
