import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHttpObservabilityMiddleware } from "../src/observability/http-observability.js";
import { createMcpRouter } from "../src/mcp/server/router.js";
import { createSafeLogger } from "../src/observability/logger.js";
import { McpSessionRegistry } from "../src/mcp/server/session-registry.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function sessionProbeRequest(method: string, url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    method,
    headers: {
      "content-type": "application/json",
      "x-test-mcp-user": USER_ID,
      ...(options.headers ?? {}),
    },
  });
}

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

test("MCP initialize does not invoke a retention cleanup callback", async () => {
  const lines: string[] = [];
  const logger = createSafeLogger({
    level: "debug",
    sink: (_level, line) => lines.push(line),
  });
  let cleanupCalls = 0;
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
  const routerOptions = {
    logger,
    onInitialize: async () => { cleanupCalls += 1; },
    createSessionServer: () => {
      throw Object.assign(new Error("provider secret must not appear"), {
        name: "ProviderError",
        code: "E_PROVIDER",
      });
    },
  };
  app.use("/mcp", createMcpRouter(routerOptions as never));

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
    await Promise.resolve();
    assert.equal(cleanupCalls, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("MCP session rejections emit safe structured reasons without changing responses", async () => {
  const lines: string[] = [];
  const logger = createSafeLogger({
    level: "debug",
    sink: (_level, line) => lines.push(line),
  });
  let now = 1_000;
  const registry = new McpSessionRegistry({
    now: () => now,
    absoluteTtlMs: 100,
  });
  const register = (sessionId: string, userId: string, namespace: "public" | "internal") =>
    registry.register({
      sessionId,
      userId,
      namespace,
      server: { close: () => undefined },
      transport: {},
    });
  register("known-public", USER_ID, "public");
  register("known-internal", USER_ID, "internal");
  register("expired-public", USER_ID, "public");

  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.mcpUserId = request.header("x-test-mcp-user") ?? undefined;
    next();
  });
  app.use("/mcp", createMcpRouter({ logger, registry }));
  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/mcp`;
  try {
    const missingHeader = await sessionProbeRequest("POST", url, {
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(missingHeader.status, 400);
    await missingHeader.text();

    const unknownSession = await sessionProbeRequest("POST", url, {
      headers: { "mcp-session-id": "unknown-session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    assert.equal(unknownSession.status, 404);
    await unknownSession.text();

    const namespaceMismatch = await sessionProbeRequest("GET", url, {
      headers: { "mcp-session-id": "known-internal" },
    });
    assert.equal(namespaceMismatch.status, 400);
    await namespaceMismatch.text();

    const identityMismatch = await sessionProbeRequest("POST", url, {
      headers: {
        "mcp-session-id": "known-public",
        "x-test-mcp-user": "00000000-0000-4000-8000-000000000002",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
    });
    assert.equal(identityMismatch.status, 403);
    await identityMismatch.text();

    now += 101;
    const unavailableSession = await sessionProbeRequest("GET", url, {
      headers: { "mcp-session-id": "expired-public" },
    });
    assert.equal(unavailableSession.status, 404);
    await unavailableSession.text();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  const rejectionLines = lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.event === "mcp_session_rejected");
  assert.deepEqual(
    rejectionLines.map(({ timestamp: _timestamp, ...line }) => line),
    [
      { level: "warn", event: "mcp_session_rejected", method: "POST", routeClass: "mcp", status: 400, reason: "missing_session_header" },
      { level: "warn", event: "mcp_session_rejected", method: "POST", routeClass: "mcp", status: 404, reason: "unknown_session" },
      { level: "warn", event: "mcp_session_rejected", method: "GET", routeClass: "mcp", status: 400, reason: "namespace_mismatch" },
      { level: "warn", event: "mcp_session_rejected", method: "POST", routeClass: "mcp", status: 403, reason: "identity_mismatch" },
      { level: "warn", event: "mcp_session_rejected", method: "GET", routeClass: "mcp", status: 404, reason: "session_unavailable" },
    ],
  );
  const serialized = JSON.stringify(rejectionLines);
  assert.equal(serialized.includes("known-public"), false);
  assert.equal(serialized.includes("known-internal"), false);
  assert.equal(serialized.includes("expired-public"), false);
  assert.equal(serialized.includes(USER_ID), false);
});
