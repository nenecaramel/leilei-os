import assert from "node:assert/strict";
import test from "node:test";
import {
  requireOAuthConfig,
  type RuntimeEnv,
} from "../src/config/env.js";

const runtimeBase = {
  PORT: 3000,
  HOST: "0.0.0.0",
  LOG_LEVEL: "info",
  MCP_USER_ID: "00000000-0000-4000-8000-000000000001",
  MCP_SERVER_URL: "https://bridge.example.com",
  AUTH0_ISSUER: "https://tenant.example.com/",
  AUTH0_AUDIENCE: "https://bridge.example.com/mcp",
  AUTH0_JWKS_URI: "https://tenant.example.com/.well-known/jwks.json",
  AUTH0_REQUIRED_SCOPE: "mcp:access",
  AUTH0_ALLOWED_SUBJECT: "auth0|phase2-acceptance",
  MCP_SESSION_IDLE_TTL_SECONDS: 7_200,
  MCP_SESSION_ABSOLUTE_TTL_SECONDS: 86_400,
  MCP_SESSION_MAX_PER_USER: 8,
  MCP_SESSION_MAX_TOTAL: 32,
  MCP_IDEMPOTENCY_RETENTION_DAYS: 30,
  MCP_IDEMPOTENCY_CLEANUP_INTERVAL_HOURS: 24,
} satisfies RuntimeEnv;

test("requireOAuthConfig accepts the already-parsed ambiguity acceptance boolean", () => {
  for (const enabled of [true, false]) {
    const parsed = requireOAuthConfig({
      ...runtimeBase,
      BRIDGE_AMBIGUITY_ACCEPTANCE_ENABLED: enabled,
    });

    assert.equal(parsed.BRIDGE_AMBIGUITY_ACCEPTANCE_ENABLED, enabled);
  }
});
