import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { createMcpRouter } from "../src/mcp/server/router.js";
import { McpSessionRegistry } from "../src/mcp/server/session-registry.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const PROTOCOL_VERSION = "2025-06-18";

async function withServer(
  callback: (url: string) => Promise<void>,
  options: Parameters<typeof createMcpRouter>[0] = {},
  configure?: (app: express.Express) => void,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.mcpUserId = request.header("x-test-mcp-user") ?? undefined;
    next();
  });
  configure?.(app);
  app.use("/mcp", createMcpRouter(options));
  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await callback(`http://127.0.0.1:${port}/mcp`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function requestHeaders(userId = USER_ID, sessionId?: string): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": PROTOCOL_VERSION,
    "x-test-mcp-user": userId,
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
  };
}

async function post(url: string, body: unknown, headers: Record<string, string>) {
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

function toolsListRequest(id = 1) {
  return { jsonrpc: "2.0", id, method: "tools/list", params: {} };
}

function recoveryProbeCallRequest(id = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "recovery_probe", arguments: {} } };
}

function createRecoveryProbeServer(userId: string) {
  const server = createMcpServer({}, userId);
  server.registerTool(
    "recovery_probe",
    {
      title: "Recovery probe",
      description: "Test-only stateless recovery probe.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [{ type: "text" as const, text: "recovery probe ok" }],
    }),
  );
  return server;
}

function initializeRequest() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mcp-session-recovery", version: "1.0.0" },
    },
  };
}

test("authenticated public POST without a session recovers tools/list statelessly", async () => {
  const registry = new McpSessionRegistry();
  let factoryCalls = 0;
  await withServer(async (url) => {
    const response = await post(url, toolsListRequest(), requestHeaders());
    assert.equal(response.status, 200);
    assert.match(await response.text(), /tools/iu);
  }, {
    registry,
    createSessionServer: (userId) => {
      factoryCalls += 1;
      return createMcpServer({}, userId);
    },
  });
  assert.equal(factoryCalls, 1);
  assert.equal(registry.size, 0);
  assert.equal(registry.capacitySize, 0);
});

test("authenticated public POST with an unknown session recovers tools/call statelessly", async () => {
  const registry = new McpSessionRegistry();
  let factoryCalls = 0;
  await withServer(async (url) => {
    const response = await post(url, recoveryProbeCallRequest(), requestHeaders(USER_ID, "stale-session"));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /recovery probe ok/iu);
  }, {
    registry,
    createSessionServer: (userId) => {
      factoryCalls += 1;
      return createRecoveryProbeServer(userId);
    },
  });
  assert.equal(factoryCalls, 1);
  assert.equal(registry.size, 0);
  assert.equal(registry.capacitySize, 0);
});

test("valid public sessions continue using the existing stateful transport", async () => {
  const registry = new McpSessionRegistry();
  let factoryCalls = 0;
  await withServer(async (url) => {
    const initialize = await post(url, initializeRequest(), requestHeaders());
    assert.equal(initialize.status, 200);
    const sessionId = initialize.headers.get("mcp-session-id");
    assert.ok(sessionId);

    const list = await post(url, toolsListRequest(2), requestHeaders(USER_ID, sessionId));
    assert.equal(list.status, 200);
    assert.match(await list.text(), /tools/iu);
    assert.equal(factoryCalls, 1);
    assert.equal(registry.size, 1);
  }, {
    registry,
    createSessionServer: (userId) => {
      factoryCalls += 1;
      return createMcpServer({}, userId);
    },
  });
});

test("recovery closes the fresh server and does not register a session", async () => {
  const registry = new McpSessionRegistry();
  let serverClosed = false;
  await withServer(async (url) => {
    const response = await post(url, toolsListRequest(), requestHeaders());
    assert.equal(response.status, 200);
    await response.text();
  }, {
    registry,
    createSessionServer: (userId) => {
      const server = createMcpServer({}, userId);
      const close = server.close.bind(server);
      server.close = async () => {
        serverClosed = true;
        await close();
      };
      return server;
    },
  });
  assert.equal(serverClosed, true);
  assert.equal(registry.size, 0);
});

test("recovery is public-POST-only and preserves hard rejection paths", async () => {
  const registry = new McpSessionRegistry();
  let factoryCalls = 0;
  registry.register({
    sessionId: "known-session",
    userId: USER_ID,
    namespace: "public",
    server: { close: () => undefined },
    transport: {},
  });
  await withServer(async (url) => {
    const missingGet = await fetch(url, { method: "GET", headers: requestHeaders() });
    assert.equal(missingGet.status, 400);
    const unknownDelete = await fetch(url, {
      method: "DELETE",
      headers: requestHeaders(USER_ID, "unknown-session"),
    });
    assert.equal(unknownDelete.status, 404);

    const identityMismatch = await post(url, toolsListRequest(), requestHeaders(OTHER_USER_ID, "known-session"));
    assert.equal(identityMismatch.status, 403);

    const namespaceMismatch = await post(
      url.replace("/mcp", "/internal/mcp"),
      toolsListRequest(),
      requestHeaders(USER_ID, "known-session"),
    );
    assert.equal(namespaceMismatch.status, 400);
  }, {
    registry,
    createSessionServer: (userId) => {
      factoryCalls += 1;
      return createMcpServer({}, userId);
    },
  }, (app) => {
    app.use("/internal/mcp", createMcpRouter({
      namespace: "internal",
      registry,
      createSessionServer: (userId) => {
        factoryCalls += 1;
        return createMcpServer({}, userId);
      },
    }));
  });
  assert.equal(factoryCalls, 0);
  assert.equal(registry.size, 1);
});

test("internal MCP POST without a session does not use public recovery", async () => {
  const registry = new McpSessionRegistry();
  let internalFactoryCalls = 0;
  await withServer(async (url) => {
    const response = await post(`${url.replace("/mcp", "/internal/mcp")}`, toolsListRequest(), requestHeaders());
    assert.equal(response.status, 400);
  }, {
    registry,
    createSessionServer: (userId, namespace) => {
      if (namespace === "internal") internalFactoryCalls += 1;
      return createMcpServer({}, userId);
    },
  }, (app) => {
    app.use("/internal/mcp", createMcpRouter({
      namespace: "internal",
      registry,
      createSessionServer: (userId, namespace) => {
        if (namespace === "internal") internalFactoryCalls += 1;
        return createMcpServer({}, userId);
      },
    }));
  });
  assert.equal(internalFactoryCalls, 0);
});

test("unauthenticated public POST remains 401 without recovery", async () => {
  const app = express();
  app.use(express.json());
  const registry = new McpSessionRegistry();
  let factoryCalls = 0;
  app.use("/mcp", createMcpRouter({
    registry,
    createSessionServer: (userId) => {
      factoryCalls += 1;
      return createMcpServer({}, userId);
    },
  }));
  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    const response = await post(`http://127.0.0.1:${port}/mcp`, toolsListRequest(), {
      ...requestHeaders(),
      "x-test-mcp-user": "",
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  assert.equal(factoryCalls, 0);
});


test("trusted internal MCP can recover a stale POST session after server restart", async () => {
  const registry = new McpSessionRegistry();
  let internalFactoryCalls = 0;
  await withServer(async (url) => {
    const internalUrl = url.replace("/mcp", "/internal/native-live-mcp");
    const response = await post(
      internalUrl,
      recoveryProbeCallRequest(),
      requestHeaders(USER_ID, "stale-after-deploy"),
    );
    assert.equal(response.status, 200);
    assert.match(await response.text(), /recovery probe ok/iu);
  }, {
    registry,
  }, (app) => {
    app.use(
      "/internal/native-live-mcp",
      createMcpRouter({
        namespace: "internal",
        registry,
        allowStatelessPostRecovery: true,
        createSessionServer: (userId) => {
          internalFactoryCalls += 1;
          return createRecoveryProbeServer(userId);
        },
      }),
    );
  });
  assert.equal(internalFactoryCalls, 1);
  assert.equal(registry.size, 0);
  assert.equal(registry.capacitySize, 0);
});
