import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpRouter } from "../src/mcp/server/router.js";
import { McpSessionRegistry } from "../src/mcp/server/session-registry.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PROTOCOL_VERSION = "2025-06-18";

type HttpResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

function requestSsePost(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    let settled = false;
    const request = http.request({
      host: "127.0.0.1",
      port,
      path,
      method: "POST",
      agent: false,
      headers: {
        connection: "close",
        ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}),
        ...headers,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      };
      response.once("data", (chunk: Buffer) => {
        chunks.push(chunk);
        response.destroy();
        finish();
      });
      response.once("end", finish);
      response.once("error", finish);
    });
    request.once("error", (error) => settled ? undefined : reject(error));
    if (payload) request.write(payload);
    request.end();
  });
}

function requestDelete(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path,
      method: "DELETE",
      agent: false,
      headers: { connection: "close", ...headers },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

function openAndCloseSse(
  port: number,
  sessionId: string,
  path = "/mcp",
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path,
      method: "GET",
      agent: false,
      headers: {
        accept: "text/event-stream",
        connection: "close",
        "mcp-session-id": sessionId,
        "mcp-protocol-version": PROTOCOL_VERSION,
        "x-test-mcp-user": USER_ID,
      },
    }, (response) => {
      const result = { status: response.statusCode ?? 0, headers: response.headers };
      response.once("error", () => resolve(result));
      response.once("end", () => resolve(result));
      // A GET keeps the SSE stream open by design. Receiving the headers is the
      // connection-establishment evidence; close this client connection before
      // issuing the next request on a fresh socket.
      response.destroy();
      resolve(result);
    });
    request.once("error", reject);
    request.end();
  });
}

async function withMcpServer(
  callback: (port: number) => Promise<void>,
  registry = new McpSessionRegistry(),
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.mcpUserId = request.header("x-test-mcp-user") ?? undefined;
    next();
  });
  app.use("/mcp", createMcpRouter({ registry }));
  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await callback(port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function initializeRequest() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mcp-session-preflight", version: "1.0.0" },
    },
  };
}

function toolsListRequest(id: number) {
  return { jsonrpc: "2.0", id, method: "tools/list", params: {} };
}

test("pinned Streamable HTTP sessions survive connection replacement and SSE disconnect until DELETE", async () => {
  const events: string[] = [];
  await withMcpServer(async (port) => {
    const initialize = await requestSsePost(port, "/mcp", initializeRequest(), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "x-test-mcp-user": USER_ID,
    });
    assert.equal(initialize.status, 200);
    const sessionId = initialize.headers["mcp-session-id"];
    assert.equal(typeof sessionId, "string");

    const firstList = await requestSsePost(port, "/mcp", toolsListRequest(2), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId as string,
      "x-test-mcp-user": USER_ID,
    });
    assert.equal(firstList.status, 200);
    assert.match(firstList.body, /tools/iu);

    const sse = await openAndCloseSse(port, sessionId as string);
    assert.equal(sse.status, 200);

    const secondList = await requestSsePost(port, "/mcp", toolsListRequest(3), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId as string,
      "x-test-mcp-user": USER_ID,
    });
    assert.equal(secondList.status, 200);
    assert.match(secondList.body, /tools/iu);

    const deleted = await requestDelete(port, "/mcp", {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId as string,
      "x-test-mcp-user": USER_ID,
    });
    assert.equal(deleted.status, 200);

    const afterDelete = await requestSsePost(port, "/mcp", toolsListRequest(4), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      "mcp-session-id": sessionId as string,
      "x-test-mcp-user": USER_ID,
    });
    assert.equal(afterDelete.status, 404);
  }, new McpSessionRegistry({ observer: (event) => events.push(`${event.name}:${event.reason ?? ""}`) }));
  assert.ok(events.includes("mcp_session_closed:client_close"));
});

test("pinned SDK transport.close invokes the actual onclose callback", async () => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => "preflight-close-session",
  });
  let closeCallbacks = 0;
  transport.onclose = () => {
    closeCallbacks += 1;
  };

  await transport.close();

  assert.equal(closeCallbacks, 1);
});

test("public and internal namespaces reject cross-use and enforce capacity", async () => {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.mcpUserId = request.header("x-test-mcp-user") ?? undefined;
    next();
  });
  const registry = new McpSessionRegistry({ maxPerUser: 1, maxTotal: 2 });
  app.use("/mcp", createMcpRouter({ namespace: "public", registry }));
  app.use("/internal/mcp", createMcpRouter({ namespace: "internal", registry }));
  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    const publicInit = await requestSsePost(port, "/mcp", initializeRequest(), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "x-test-mcp-user": USER_ID,
    });
    const publicSessionId = publicInit.headers["mcp-session-id"] as string;
    const internalInit = await requestSsePost(port, "/internal/mcp", initializeRequest(), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "x-test-mcp-user": USER_ID,
    });
    const internalSessionId = internalInit.headers["mcp-session-id"] as string;
    assert.equal(publicInit.status, 200);
    assert.equal(internalInit.status, 200);

    const crossPublic = await requestSsePost(port, "/internal/mcp", toolsListRequest(2), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "mcp-session-id": publicSessionId,
      "x-test-mcp-user": USER_ID,
    });
    assert.equal(crossPublic.status, 400);
    const crossInternal = await requestSsePost(port, "/mcp", toolsListRequest(3), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "mcp-session-id": internalSessionId,
      "x-test-mcp-user": USER_ID,
    });
    assert.equal(crossInternal.status, 400);

    const overCapacity = await requestSsePost(port, "/mcp", initializeRequest(), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "x-test-mcp-user": "00000000-0000-4000-8000-000000000002",
    });
    assert.equal(overCapacity.status, 429);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("concurrent HTTP initialize requests admit exactly one session at maxTotal one", async () => {
  const registry = new McpSessionRegistry({ maxPerUser: 8, maxTotal: 1 });
  await withMcpServer(async (port) => {
    const results = await Promise.all([
      requestSsePost(port, "/mcp", initializeRequest(), {
        "mcp-protocol-version": PROTOCOL_VERSION,
        accept: "application/json, text/event-stream",
        "x-test-mcp-user": USER_ID,
      }),
      requestSsePost(port, "/mcp", initializeRequest(), {
        "mcp-protocol-version": PROTOCOL_VERSION,
        accept: "application/json, text/event-stream",
        "x-test-mcp-user": "00000000-0000-4000-8000-000000000002",
      }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 429]);
    assert.equal(registry.capacitySize, 1);
  }, registry);
});

test("fresh initialize observes sanitized client metadata without exposing identifiers", async () => {
  const events: Array<Record<string, unknown>> = [];
  await withMcpServer(async (port) => {
    const request = initializeRequest();
    request.params.protocolVersion = "2025-06-18\u0000\n" + "p".repeat(140);
    request.params.clientInfo = {
      name: "client\u0001\t" + "n".repeat(140),
      version: "1.0\u007f" + "v".repeat(140),
    };
    const response = await requestSsePost(port, "/mcp", request, {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "x-test-mcp-user": USER_ID,
    });
    assert.equal(response.status, 200);
  }, new McpSessionRegistry({ observer: (event) => events.push(event) }));

  const event = events.find((candidate) => candidate.name === "mcp_initialize_observed");
  assert.ok(event);
  for (const key of ["protocolVersion", "clientName", "clientVersion"] as const) {
    const value = event[key];
    assert.equal(typeof value, "string");
    assert.ok((value as string).length <= 120);
    assert.equal(/[\u0000-\u001f\u007f]/u.test(value as string), false);
  }
  assert.equal(event.hadUnknownSessionHeader, false);
});

test("fresh initialize with an unknown session header is observable without changing the response", async () => {
  const events: Array<Record<string, unknown>> = [];
  await withMcpServer(async (port) => {
    const response = await requestSsePost(port, "/mcp", initializeRequest(), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "mcp-session-id": "unknown-session-header",
      "x-test-mcp-user": USER_ID,
    });
    assert.equal(response.status, 200);
  }, new McpSessionRegistry({ observer: (event) => events.push(event) }));

  const event = events.find((candidate) => candidate.name === "mcp_initialize_observed");
  assert.ok(event);
  assert.equal(event.hadUnknownSessionHeader, true);
});

test("HTTP capacity rejection reports exact user namespace idle and in-flight counts", async () => {
  const events: Array<Record<string, unknown>> = [];
  const registry = new McpSessionRegistry({
    maxPerUser: 2,
    maxTotal: 8,
    observer: (event) => events.push(event),
  });
  await withMcpServer(async (port) => {
    const headers = {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "x-test-mcp-user": USER_ID,
    };
    const first = await requestSsePost(port, "/mcp", initializeRequest(), headers);
    const second = await requestSsePost(port, "/mcp", initializeRequest(), headers);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const firstSessionId = first.headers["mcp-session-id"];
    const secondSessionId = second.headers["mcp-session-id"];
    assert.equal(typeof firstSessionId, "string");
    assert.equal(typeof secondSessionId, "string");
    const inFlight = await registry.acquire(firstSessionId as string, "public", USER_ID);
    assert.ok(inFlight);
    const secondInFlight = await registry.acquire(secondSessionId as string, "public", USER_ID);
    assert.ok(secondInFlight);

    const rejected = await requestSsePost(port, "/mcp", initializeRequest(), headers);
    assert.equal(rejected.status, 429);
  }, registry);

  const event = events.find((candidate) => candidate.name === "mcp_session_capacity_rejected");
  assert.ok(event);
  assert.equal(event.activeUserNamespaceCount, 2);
  assert.equal(event.idleUserNamespaceCount, 0);
  assert.equal(event.inFlightUserNamespaceCount, 2);
  assert.equal(event.oldestIdleAgeMs, null);
});

test("fresh initialize churn reclaims idle sessions without permanent capacity rejection", async () => {
  const events: Array<Record<string, unknown>> = [];
  const registry = new McpSessionRegistry({
    maxPerUser: 3,
    maxTotal: 8,
    observer: (event) => events.push(event),
  });
  await withMcpServer(async (port) => {
    const headers = {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "x-test-mcp-user": USER_ID,
    };
    for (let index = 0; index < 8; index += 1) {
      const response = await requestSsePost(port, "/mcp", initializeRequest(), headers);
      assert.equal(response.status, 200);
      assert.ok(registry.size <= 3);
    }
  }, registry);

  assert.equal(registry.size, 3);
  const reclaimed = events.filter(
    (event) => event.name === "mcp_session_closed" && event.reason === "capacity_reclaim",
  );
  assert.equal(reclaimed.length, 5);
  for (const event of reclaimed) assert.equal(event.inFlightCountAtClose, 0);
});

test("reclaimed session IDs return scoped 404 responses while missing headers stay 400", async () => {
  const registry = new McpSessionRegistry({ maxPerUser: 1, maxTotal: 8 });
  await withMcpServer(async (port) => {
    const headers = {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "x-test-mcp-user": USER_ID,
    };
    const first = await requestSsePost(port, "/mcp", initializeRequest(), headers);
    assert.equal(first.status, 200);
    const staleSessionId = first.headers["mcp-session-id"];
    assert.equal(typeof staleSessionId, "string");

    const replacement = await requestSsePost(port, "/mcp", initializeRequest(), headers);
    assert.equal(replacement.status, 200);
    assert.equal(registry.find(staleSessionId as string), null);

    const stalePost = await requestSsePost(port, "/mcp", toolsListRequest(2), {
      ...headers,
      "mcp-session-id": staleSessionId as string,
    });
    assert.equal(stalePost.status, 404);

    const staleGet = await openAndCloseSse(port, staleSessionId as string);
    assert.equal(staleGet.status, 404);

    const staleDelete = await requestDelete(port, "/mcp", {
      ...headers,
      "mcp-session-id": staleSessionId as string,
    });
    assert.equal(staleDelete.status, 404);

    const missingPost = await requestSsePost(port, "/mcp", toolsListRequest(3), headers);
    assert.equal(missingPost.status, 400);

    const fresh = await requestSsePost(port, "/mcp", initializeRequest(), {
      ...headers,
      "mcp-session-id": "arbitrary-unknown-session",
    });
    assert.equal(fresh.status, 200);
  }, registry);
});

test("existing session access keeps cross-user 403 behavior", async () => {
  await withMcpServer(async (port) => {
    const first = await requestSsePost(port, "/mcp", initializeRequest(), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "x-test-mcp-user": USER_ID,
    });
    assert.equal(first.status, 200);
    const sessionId = first.headers["mcp-session-id"];
    assert.equal(typeof sessionId, "string");

    const wrongUser = await requestSsePost(port, "/mcp", toolsListRequest(2), {
      "mcp-protocol-version": PROTOCOL_VERSION,
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId as string,
      "x-test-mcp-user": "00000000-0000-4000-8000-000000000002",
    });
    assert.equal(wrongUser.status, 403);
  });
});
