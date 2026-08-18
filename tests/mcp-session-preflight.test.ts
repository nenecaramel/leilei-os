import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpRouter } from "../src/mcp/server/router.js";

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

function openAndCloseSse(port: number, sessionId: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: "/mcp",
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

async function withMcpServer(callback: (port: number) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.mcpUserId = request.header("x-test-mcp-user") ?? undefined;
    next();
  });
  app.use("/mcp", createMcpRouter());
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
    assert.equal(afterDelete.status, 400);
  });
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
