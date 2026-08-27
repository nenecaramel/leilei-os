import assert from "node:assert/strict";
import test from "node:test";
import {
  createSafeLogger,
  safeErrorFingerprint,
  type LogLevel,
} from "../src/observability/logger.js";
import {
  classifyRoute,
  getCurrentRequestId,
  runWithRequestContext,
} from "../src/observability/request-context.js";

test("safe logger filters levels and emits structured JSON", () => {
  const lines: Array<{ level: LogLevel; line: string }> = [];
  const logger = createSafeLogger({
    level: "warn",
    now: () => new Date("2026-08-27T16:00:00.000Z"),
    sink: (level, line) => lines.push({ level, line }),
  });

  logger.info("below_threshold", { status: 200 });
  logger.warn("visible", { status: 503, code: "DATABASE_UNAVAILABLE" });

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!.line), {
    timestamp: "2026-08-27T16:00:00.000Z",
    level: "warn",
    event: "visible",
    status: 503,
    code: "DATABASE_UNAVAILABLE",
  });
});

test("route classification uses the frozen route classes", () => {
  assert.equal(classifyRoute("/health"), "health");
  assert.equal(classifyRoute("/ready"), "ready");
  assert.equal(classifyRoute("/api/v1/diary/private-id?token=secret"), "web_api");
  assert.equal(classifyRoute("/mcp"), "mcp_public");
  assert.equal(classifyRoute("/mcp/session/private"), "mcp_public");
  assert.equal(classifyRoute("/internal/mcp"), "mcp_internal");
  assert.equal(
    classifyRoute("/.well-known/oauth-protected-resource/mcp"),
    "oauth_metadata",
  );
  assert.equal(classifyRoute("/oauth"), "oauth_metadata");
  assert.equal(classifyRoute("/private/path"), "other");
});

test("logger attaches the server request id from async request context", () => {
  const lines: string[] = [];
  const logger = createSafeLogger({
    level: "debug",
    now: () => new Date("2026-08-27T16:00:00.000Z"),
    sink: (_level, line) => lines.push(line),
  });

  runWithRequestContext({ requestId: "server-id" }, () => {
    assert.equal(getCurrentRequestId(), "server-id");
    logger.info("inside_request", { routeClass: "web_api" });
  });

  assert.deepEqual(JSON.parse(lines[0]!), {
    timestamp: "2026-08-27T16:00:00.000Z",
    level: "info",
    event: "inside_request",
    requestId: "server-id",
    routeClass: "web_api",
  });
});

test("logger drops non-allowlisted secret-bearing fields and nested values", () => {
  const lines: string[] = [];
  const logger = createSafeLogger({
    level: "debug",
    sink: (_level, line) => lines.push(line),
  });

  logger.error("unsafe_fields", {
    Authorization: "Bearer attacker-token",
    token: "attacker-token",
    DATABASE_URL: "postgres://user:password@private.example/db",
    sql: "select secret from private_table",
    stack: "Error: private stack",
    requestBody: "private body",
    providerPayload: "private provider response",
    nested: { private: "nested secret" },
    status: 500,
  });

  assert.equal(lines.length, 1);
  const serialized = lines[0]!;
  assert.equal(serialized.includes("attacker-token"), false);
  assert.equal(serialized.includes("postgres://"), false);
  assert.equal(serialized.includes("select secret"), false);
  assert.equal(serialized.includes("private stack"), false);
  assert.equal(serialized.includes("private body"), false);
  assert.equal(serialized.includes("private provider response"), false);
  assert.equal(serialized.includes("nested secret"), false);
  assert.deepEqual(JSON.parse(serialized).status, 500);
});

test("safe error fingerprint reads only bounded name and code", () => {
  const error = Object.assign(new Error("private error message"), {
    name: "PostgresError",
    code: "57P03",
    stack: "private stack",
  });
  assert.deepEqual(safeErrorFingerprint(error), {
    name: "PostgresError",
    code: "57P03",
  });
  assert.deepEqual(
    safeErrorFingerprint(Object.assign(new Error("secret"), { name: "bad name!", code: "bad-code" })),
    { name: "UNKNOWN", code: "UNKNOWN" },
  );
  assert.deepEqual(safeErrorFingerprint(new Error("secret")), {
    name: "Error",
    code: "UNKNOWN",
  });
});

test("logger and sink failures are non-fatal", () => {
  const logger = createSafeLogger({
    level: "debug",
    sink: () => {
      throw new Error("sink failure");
    },
  });
  assert.doesNotThrow(() => logger.error("sink_failure", { code: "TEST" }));
});
