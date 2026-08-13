import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalizeMcpWriteRequest,
  hashMcpWriteRequest,
  normalizeMcpIdempotencyKey,
} from "../src/domains/mcp-write/mcp-write-idempotency.js";
import { MCP_WRITE_TOOL_NAMES } from "../src/mcp/tools/write-context.js";

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

test("content author participates in the persistent write fingerprint", () => {
  const base = {
    category: "goal",
    key: "ship",
    content: "Ship safely",
    tags: ["Phase 6"],
  };
  assert.notEqual(
    hashMcpWriteRequest({ ...base, author: "L" }),
    hashMcpWriteRequest({ ...base, author: "G" }),
  );
});

test("canonical fingerprints reject values outside the normalized JSON contract", () => {
  for (const value of [undefined, 1n, Number.NaN, Number.POSITIVE_INFINITY, new Date(), { value: undefined }, new Array(1)]) {
    assert.throws(() => hashMcpWriteRequest(value), /UNSUPPORTED_MCP_FINGERPRINT_VALUE/);
  }
});

test("canonical MCP fingerprint golden values are version locked", () => {
  assert.equal(hashMcpWriteRequest({ title: "Task", description: "Body", status: "pending", priority: "normal", due_time: null, timezone: "Asia/Shanghai", tags: ["one", "two"], completed_at: null, author: "L" }), "8cad5e62c774d7e7039f746cf71bff916740abda42f3a9f36ca9659c6dafe3d9");
  assert.equal(hashMcpWriteRequest({ title: "Diary", content: "Entry", date: "2026-08-01", tags: ["x"], mood: null, author: "G" }), "3a016eac8e5c6f4afcdf745cfb5d978c42e1aeac767ca4a39a2cd8b8b2bbef3a");
  assert.equal(hashMcpWriteRequest({ action: "set", percent: 20 }), "017533b6c7ed83aabbbbc5424753b71e15a75a6784a1c0ab689d19376efc264a");
  assert.equal(hashMcpWriteRequest({ action: "stop" }), "eea27c47047334348ce10c6ea9a150bde77cc96fe70ffe92be35bdbc5dc7627f");
  assert.equal(hashMcpWriteRequest({ category: "goal", key: "ship", content: "Ship safely", tags: ["Phase 6"], author: "L" }), "5071e610b7eb8f3e5e009ebbe189991558ae3df4beebdab43511d4556b17fdb3");
  assert.equal(
    hashMcpWriteRequest({
      date: "2026-08-13",
      author: "L",
      revision: 3,
      entries: [
        { id: "a", kind: "pending", text: "First" },
        { id: "b", kind: "record", text: "Second" },
      ],
    }),
    "088c3e36b755947c59b938b4654845d346926fde71c6d0308459e6083d871aa2",
  );
});

test("Todo MCP tool and resource literals extend only the idempotency vocabulary", async () => {
  assert.ok(MCP_WRITE_TOOL_NAMES.includes("write_todo_paper" as never));
  const source = await readFile(
    new URL("../src/domains/mcp-write/mcp-write-idempotency.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /McpIdempotentToolName[\s\S]*\| "write_todo_paper"/);
  assert.match(source, /McpIdempotentResourceType[\s\S]*\| "todo_paper"/);
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
