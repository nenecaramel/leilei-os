import assert from "node:assert/strict";
import test from "node:test";
import { createSafeLogger } from "../src/observability/logger.js";
import { classifyRoute } from "../src/observability/request-context.js";

test("OAuth routes are classified without recording query parameters", () => {
  assert.equal(classifyRoute("/oauth/authorize"), "oauth_metadata");
  assert.equal(classifyRoute("/oauth/token"), "oauth_metadata");
  assert.equal(classifyRoute("/oauth/callback?code=private-code"), "oauth_metadata");
});

test("CIMD identifiers and OAuth values are rejected by the safe logger", () => {
  const lines: string[] = [];
  const logger = createSafeLogger({
    level: "debug",
    sink: (_level, line) => lines.push(line),
  });
  logger.warn("oauth_cimd_resolution_failed", {
    clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
    redirectUri: "https://claude.ai/oauth/callback",
    authorizationCode: "authorization-code",
    accessToken: "access-token",
    refreshToken: "private-refresh-token",
    refreshTokenKey: "private-encryption-key",
    verifier: "pkce-verifier",
    reason: "metadata fetch failed",
  });

  assert.equal(lines.length, 1);
  const line = lines[0]!;
  assert.equal(line.includes("claude.ai"), false);
  assert.equal(line.includes("authorization-code"), false);
  assert.equal(line.includes("access-token"), false);
  assert.equal(line.includes("private-refresh-token"), false);
  assert.equal(line.includes("private-encryption-key"), false);
  assert.equal(line.includes("pkce-verifier"), false);
  assert.match(line, /metadata fetch failed/u);
});
