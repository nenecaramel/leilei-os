import assert from "node:assert/strict";
import test from "node:test";
import { getMcpGovernanceConfig } from "../src/config/env.js";

test("MCP governance config applies bounded safe defaults", () => {
  assert.deepEqual(
    getMcpGovernanceConfig({}),
    {
      idleTtlSeconds: 7_200,
      absoluteTtlSeconds: 86_400,
      maxPerUser: 8,
      maxTotal: 32,
      idempotencyRetentionDays: 30,
      idempotencyCleanupIntervalHours: 24,
    },
  );
});

test("MCP governance config fails closed for unsafe relationships", () => {
  assert.throws(
    () => getMcpGovernanceConfig({ MCP_SESSION_IDLE_TTL_SECONDS: "100", MCP_SESSION_ABSOLUTE_TTL_SECONDS: "99" }),
    /MCP_SESSION_ABSOLUTE_TTL_SECONDS/,
  );
  assert.throws(
    () => getMcpGovernanceConfig({ MCP_SESSION_MAX_PER_USER: "9", MCP_SESSION_MAX_TOTAL: "8" }),
    /MCP_SESSION_MAX_TOTAL/,
  );
  assert.throws(
    () => getMcpGovernanceConfig({ MCP_SESSION_MAX_TOTAL: "0" }),
    /MCP_SESSION_MAX_TOTAL/,
  );
});
