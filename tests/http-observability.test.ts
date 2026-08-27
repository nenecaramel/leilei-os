import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import express, { type NextFunction, type Request, type Response } from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createSafeLogger, type SafeLogger } from "../src/observability/logger.js";
import { getCurrentRequestId } from "../src/observability/request-context.js";
import { createHttpObservabilityMiddleware } from "../src/observability/http-observability.js";

type FakeResponse = EventEmitter & {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
};

function createFakeResponse(): FakeResponse {
  const response = new EventEmitter() as FakeResponse;
  response.statusCode = 200;
  response.setHeader = () => undefined;
  return response;
}

function createLineLogger(lines: string[]): SafeLogger {
  return createSafeLogger({
    level: "debug",
    now: () => new Date("2026-08-27T16:00:00.000Z"),
    sink: (_level, line) => lines.push(line),
  });
}

test("request middleware uses a server id and emits one safe completion event", () => {
  const lines: string[] = [];
  const response = createFakeResponse();
  let responseRequestId = "";
  response.setHeader = (name, value) => {
    if (name.toLowerCase() === "x-request-id") responseRequestId = value;
  };
  const middleware = createHttpObservabilityMiddleware({
    logger: createLineLogger(lines),
    generateRequestId: () => "server-id",
    now: (() => {
      let value = 100;
      return () => (value += 5);
    })(),
  });
  const request = {
    method: "GET",
    path: "/api/v1/diary/private-id?token=do-not-log",
    header: (name: string) =>
      name.toLowerCase() === "x-request-id" ? "attacker-id" : undefined,
  } as unknown as Request;
  let nextRequestId: string | undefined;

  middleware(request, response as unknown as Response, (() => {
    nextRequestId = getCurrentRequestId();
  }) as NextFunction);

  response.emit("finish");
  response.emit("close");

  assert.equal(responseRequestId, "server-id");
  assert.equal(nextRequestId, "server-id");
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.deepEqual(parsed, {
    timestamp: "2026-08-27T16:00:00.000Z",
    level: "info",
    event: "http_request_completed",
    requestId: "server-id",
    method: "GET",
    routeClass: "web_api",
    status: 200,
    durationMs: 5,
  });
  assert.equal(lines[0]!.includes("private-id"), false);
  assert.equal(lines[0]!.includes("token=do-not-log"), false);
});

test("concurrent request contexts keep distinct server-generated ids", () => {
  const observed: string[] = [];
  const middleware = createHttpObservabilityMiddleware({
    logger: createLineLogger([]),
    generateRequestId: (() => {
      const ids = ["server-id-1", "server-id-2"];
      return () => ids.shift()!;
    })(),
  });

  for (const path of ["/mcp", "/internal/mcp"]) {
    const response = createFakeResponse();
    middleware(
      { method: "POST", path } as unknown as Request,
      response as unknown as Response,
      (() => observed.push(getCurrentRequestId() ?? "missing")) as NextFunction,
    );
  }

  assert.deepEqual(observed, ["server-id-1", "server-id-2"]);
});

test("invalid JSON still receives request identity and completion telemetry", async () => {
  const lines: string[] = [];
  const app = express();
  app.use(createHttpObservabilityMiddleware({
    logger: createLineLogger(lines),
    generateRequestId: () => "body-error-id",
  }));
  app.use(express.json());
  app.post("/api/v1/memory", (_request, response) => response.json({ success: true }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    assert.ok(error);
    response.status(400).json({ success: false });
  });

  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("x-request-id"), "body-error-id");
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(events.filter((event) => event.event === "http_request_completed").length, 1);
    assert.equal(events.at(-1)?.routeClass, "web_api");
    assert.equal(events.at(-1)?.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("createApp installs observability before the JSON parser", async () => {
  const environmentKeys = [
    "MCP_USER_ID",
    "MCP_SERVER_URL",
    "AUTH0_ISSUER",
    "AUTH0_AUDIENCE",
    "AUTH0_JWKS_URI",
    "AUTH0_REQUIRED_SCOPE",
    "AUTH0_ALLOWED_SUBJECT",
    "WEB_APP_ORIGIN",
    "WEB_AUTH0_AUDIENCE",
    "WEB_AUTH0_REQUIRED_SCOPE",
    "DATABASE_URL",
  ] as const;
  const previous = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, {
    MCP_USER_ID: "00000000-0000-4000-8000-000000000001",
    MCP_SERVER_URL: "https://mcp.example.test",
    AUTH0_ISSUER: "https://issuer.example.test/",
    AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
    AUTH0_JWKS_URI: "https://issuer.example.test/.well-known/jwks.json",
    AUTH0_REQUIRED_SCOPE: "mcp:access",
    AUTH0_ALLOWED_SUBJECT: "allowed-subject",
    WEB_APP_ORIGIN: "https://web.example.test",
    WEB_AUTH0_AUDIENCE: "https://web.example.test/api",
    WEB_AUTH0_REQUIRED_SCOPE: "web:access",
  });
  delete process.env.DATABASE_URL;

  try {
    const { createApp } = await import("../src/app/create-app.js");
    const lines: string[] = [];
    const app = createApp({
      logger: createLineLogger(lines),
      verifyAccessToken: async () => ({
        subject: "allowed-subject",
        issuer: "https://issuer.example.test/",
        audience: [],
        scopes: ["mcp:access"],
      }),
      verifyWebAccessToken: async () => ({
        subject: "allowed-subject",
        issuer: "https://issuer.example.test/",
        audience: [],
        scopes: ["web:access"],
      }),
      webMemoryService: {} as never,
      webDiaryService: {} as never,
      webTaskService: {} as never,
      webSystemService: {} as never,
      toyService: {} as never,
      webGlobalSearchService: {} as never,
      webTodoService: {} as never,
      webExportService: {} as never,
      webImportService: {} as never,
      webUniverseService: {} as never,
    });
    const server = await new Promise<import("node:http").Server>((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    const address = server.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
        headers: { "x-request-id": "attacker-id" },
      });
      assert.equal(response.status, 200);
      const requestId = response.headers.get("x-request-id");
      assert.ok(requestId);
      assert.notEqual(requestId, "attacker-id");
      const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.equal(events.filter((event) => event.event === "http_request_completed").length, 1);
      assert.equal(events[0]?.requestId, requestId);
      assert.equal(events[0]?.routeClass, "health");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  } finally {
    for (const key of environmentKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
