import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalizeMcpWriteRequest,
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

test("canonical fingerprints sort object keys recursively and preserve array order", () => {
  const first = { z: { b: 2, a: 1 }, a: ["first", "second"] };
  const reordered = { a: ["first", "second"], z: { a: 1, b: 2 } };
  assert.equal(canonicalizeMcpWriteRequest(first), canonicalizeMcpWriteRequest(reordered));
  assert.equal(hashMcpWriteRequest(first), hashMcpWriteRequest(reordered));
  assert.notEqual(hashMcpWriteRequest(first), hashMcpWriteRequest({ ...reordered, a: ["second", "first"] }));
});

test("canonical fingerprints reject values outside the normalized JSON contract", () => {
  for (const value of [undefined, 1n, Number.NaN, Number.POSITIVE_INFINITY, new Date(), { value: undefined }, new Array(1)]) {
    assert.throws(() => hashMcpWriteRequest(value), /UNSUPPORTED_MCP_FINGERPRINT_VALUE/);
  }
});

test("canonical MCP fingerprint golden values are version locked", () => {
  assert.equal(hashMcpWriteRequest({ title: "Task", description: "Body", status: "pending", priority: "normal", due_time: null, timezone: "Asia/Shanghai", tags: ["one", "two"], completed_at: null }), "0ae47c2446d85ceaca11cd37a44d93bb004b155b9121745cd7bf98bd31ef3048");
  assert.equal(hashMcpWriteRequest({ title: "Diary", content: "Entry", date: "2026-08-01", tags: ["x"], mood: null }), "9406fe0dc56ddd6c2797d98b8bb717f25a31c151aa4f6b36a24e182dd5b415c4");
  assert.equal(hashMcpWriteRequest({ action: "set", percent: 20 }), "017533b6c7ed83aabbbbc5424753b71e15a75a6784a1c0ab689d19376efc264a");
  assert.equal(hashMcpWriteRequest({ action: "stop" }), "eea27c47047334348ce10c6ea9a150bde77cc96fe70ffe92be35bdbc5dc7627f");
  assert.equal(hashMcpWriteRequest({ category: "goal", key: "ship", content: "Ship safely", tags: ["Phase 6"] }), "158e1a3099f8bec47f0194d8f8b082bea8e49caa88c80a321ad74dcfff86f84f");
});

test("migration 0013 only extends MCP idempotency checks for Memory", async () => {
  const sql = await readFile(new URL("../drizzle/0013_brief_shiver_man.sql", import.meta.url), "utf8");
  assert.match(sql, /'write_memory'/);
  assert.match(sql, /'memory'/);
  assert.doesNotMatch(sql, /CREATE TABLE|ADD COLUMN|UPDATE|DELETE|TRUNCATE/i);
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
