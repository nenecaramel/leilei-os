import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  hashMcpWriteRequest,
  normalizeMcpIdempotencyKey,
} from "../src/domains/mcp-write/mcp-write-idempotency.js";

test("MCP idempotency keys are explicit bounded safe ASCII", () => {
  assert.equal(
    normalizeMcpIdempotencyKey("  task:client.request-0001  "),
    "task:client.request-0001",
  );
  for (const value of ["short", "contains space 0001", "非ASCII-key-00000001", "x".repeat(129)]) {
    assert.throws(() => normalizeMcpIdempotencyKey(value), /INVALID_MCP_IDEMPOTENCY_KEY/);
  }
});

test("canonical request fingerprints are stable and payload-free", () => {
  const input = { title: "private title", description: "private body", tags: ["x"] };
  const hash = hashMcpWriteRequest(input);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, hashMcpWriteRequest(input));
  assert.notEqual(hash, hashMcpWriteRequest({ ...input, tags: ["y"] }));
  assert.doesNotMatch(hash, /private/);
});

test("migration adds only scoped durable MCP idempotency persistence", async () => {
  const sql = await readFile(new URL("../drizzle/0012_unique_norman_osborn.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE "mcp_write_idempotency"/);
  assert.match(sql, /UNIQUE INDEX "mcp_write_idempotency_user_tool_key_unique_idx" ON "mcp_write_idempotency".*"user_id","tool_name","idempotency_key"/s);
  assert.match(sql, /request_hash/);
  assert.match(sql, /resource_type/);
  assert.match(sql, /resource_id/);
  assert.doesNotMatch(sql, /description|content|payload|response_snapshot/i);
  assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE|TRUNCATE|DROP)\b/im);
});
