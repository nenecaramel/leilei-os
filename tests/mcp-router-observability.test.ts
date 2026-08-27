import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHttpObservabilityMiddleware } from "../src/observability/http-observability.js";
import { McpIdempotencyCleanupCoordinator } from "../src/mcp/server/idempotency-retention.js";
import { createMcpRouter } from "../src/mcp/server/router.js";
import { createSafeLogger } from "../src/observability/logger.js";
import { createMcpLifecycleObserver } from "../src/observability/runtime-observers.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

test("MCP router keeps safe 500 response and fingerprints handler failures", async () => {
  const lines: string[] = [];
  const logger = createSafeLogger({
    level: "debug",
    sink: (_level, line) => lines.push(line),
  });
  const app = express();
  app.use(express.json());
  app.use(createHttpObservabilityMiddleware({
    logger,
    generateRequestId: () => "router-request-id",
  }));
  app.use((request, _response, next) => {
    request.mcpUserId = request.header("x-test-mcp-user") ?? undefined;
    next();
  });
  app.use("/mcp", createMcpRouter({
    logger,
    createSessionServer: () => {
      throw Object.assign(new Error("provider secret must not appear"), {
        name: "ProviderError",
        code: "E_PROVIDER",
      });
    },
  }));

  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = (server.address() as AddressInfo).port;
  const originalConsoleError = console.error;
  const consoleOutput: unknown[] = [];
  console.error = (...args: unknown[]) => consoleOutput.push(args);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-mcp-user": USER_ID,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal server error." },
      id: null,
    });

    const failures = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.event === "mcp_request_failed");
    assert.equal(failures.length, 1);
    assert.deepEqual(
      (({ timestamp: _timestamp, ...failure }) => failure)(failures[0]!),
      {
        level: "error",
        event: "mcp_request_failed",
        requestId: "router-request-id",
        name: "ProviderError",
        code: "E_PROVIDER",
      },
    );
    assert.equal(JSON.stringify(lines).includes("provider secret must not appear"), false);
    assert.equal(JSON.stringify(consoleOutput).includes("provider secret must not appear"), false);
  } finally {
    console.error = originalConsoleError;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("initialize cleanup completion escapes the request context", async () => {
  const lines: string[] = [];
  const logger = createSafeLogger({
    level: "debug",
    sink: (_level, line) => lines.push(line),
  });
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator = new McpIdempotencyCleanupCoordinator({
    retentionMs: 1_000,
    intervalMs: 10_000,
    cleanup: async () => {
      await blocker;
      return 1;
    },
    observer: createMcpLifecycleObserver(logger),
  });
  const app = express();
  app.use(express.json());
  app.use(createHttpObservabilityMiddleware({
    logger,
    generateRequestId: () => "initialize-request-id",
  }));
  app.use((request, _response, next) => {
    request.mcpUserId = USER_ID;
    next();
  });
  app.use("/mcp", createMcpRouter({
    logger,
    onInitialize: () => coordinator.maybeCleanup(),
    createSessionServer: () => {
      throw Object.assign(new Error("provider secret must not appear"), {
        name: "ProviderError",
        code: "E_PROVIDER",
      });
    },
  }));

  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    });
    assert.equal(response.status, 500);
    release();
    await coordinator.drain();

    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const requestFailure = parsed.find((line) => line.event === "mcp_request_failed");
    const completed = parsed.find((line) => line.event === "mcp_idempotency_cleanup_completed");
    assert.equal(requestFailure?.requestId, "initialize-request-id");
    assert.ok(completed);
    assert.equal(completed.requestId, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
