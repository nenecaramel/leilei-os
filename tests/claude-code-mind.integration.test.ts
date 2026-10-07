import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, count } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, runtimeSubjectStates, mcpWriteIdempotency, runtimeContextManifests } from "../src/database/schema.js";
import { DrizzleMindProductRepository } from "../src/domains/runtime/mind/mind-product-repository.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";
import { ClaudeCodeMindRecallService } from "../src/domains/runtime/mind/claude-code-mind-recall.js";
import { DEFAULT_MIND_LOOP_CONFIG } from "../src/domains/runtime/mind/default-backend-mind-runtime.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { resolveMcpToolExposure } from "../src/mcp/server/tool-profiles.js";

const url = process.env.DATABASE_URL;
const enabled = process.env.RUN_CLAUDE_CODE_MIND_DATABASE_TEST === "1" && Boolean(url) &&
  ["127.0.0.1", "localhost"].includes(new URL(url!).hostname) && /test/.test(new URL(url!).pathname);

test("MCP concurrent retries commit one global confirmed memory; recall is a real pure DB read", {skip: !enabled}, async t => {
  const database = createDatabase(url!, {ssl: false}); const db = database.db;
  const userId = randomUUID();
  t.after(async () => {
    await db.delete(mcpWriteIdempotency).where(eq(mcpWriteIdempotency.userId, userId));
    await db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, userId));
    await db.delete(users).where(eq(users.id, userId)); await database.close();
  });
  await db.insert(users).values({id: userId, email: `claude-mind-${userId}@example.test`, displayName: "Claude Code Mind test"});
  const repository = new DrizzleMindProductRepository(db); let authorizations = 0;
  const server = createMcpServer({writeMemory: {repository, subjectId: "G", requireActiveUser: async () => {authorizations++; return userId;}}}, userId, resolveMcpToolExposure(["core"]));
  const client = new Client({name: "claude-mind-test", version: "1"}, {capabilities: {}});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => {await client.close(); await server.close();});
  const arguments_ = {text: "jasmine tea preference", occurred_at: "2026-10-01T00:00:00Z", note: "durable preference", idempotency_key: "claude-memory-one-logical-write"};
  const write = () => client.callTool({name: "write_memory", arguments: arguments_});
  const results = await Promise.all([write(), write(), write()]);
  const data = results.map(r => (r.structuredContent as {success: boolean; data: {memory_id: string; outcome: string}}));
  assert.ok(data.every(r => r.success));
  assert.equal(new Set(data.map(r => r.data.memory_id)).size, 1);
  assert.deepEqual(data.map(r => r.data.outcome).sort(), ["applied", "replayed", "replayed"]);
  assert.equal(authorizations, 3);
  const [total] = await db.select({count: count()}).from(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, userId)); assert.equal(total!.count, 1);
  const rows = await db.select().from(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, userId));
  const row = rows[0]!;
  assert.equal(row.scopeApplicability, "global"); assert.equal(row.settlementStatus, "settled");
  assert.equal(row.scopeConversationId, null); assert.equal(row.scopePathHeadMessageId, null); assert.equal(row.payload?.source, "claude_code");
  const service = new ClaudeCodeMindRecallService(new DrizzleSubjectStateRuntimePort(db), DEFAULT_MIND_LOOP_CONFIG, "G");
  const first = await service.recall({userId, sessionId: "not-a-postgres-uuid", query: "jasmine tea", excludeIds: []});
  assert.deepEqual(first.memory_ids, [row.id]);
  const excluded = await service.recall({userId, sessionId: "not-a-postgres-uuid", query: "jasmine tea", excludeIds: [row.id]}); assert.deepEqual(excluded.memory_ids, []);
  assert.deepEqual(await db.select().from(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, userId)), rows);
  const [manifestCount] = await db.select({count: count()}).from(runtimeContextManifests).where(eq(runtimeContextManifests.userId, userId)); assert.equal(manifestCount!.count, 0);
  const conflict = await client.callTool({name: "write_memory", arguments: {...arguments_, text: "different content"}});
  assert.equal(conflict.isError, true); assert.equal((conflict.structuredContent as {error: {code: string}}).error.code, "IDEMPOTENCY_CONFLICT");
  const countAfter = await db.select({count: count()}).from(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, userId)); assert.equal(countAfter[0]!.count, 1);
  // Simulate authorization becoming stale before the canonical write transaction.
  await db.update(users).set({status: "disabled"}).where(eq(users.id, userId));
  const disabled = await client.callTool({name: "write_memory", arguments: {...arguments_, idempotency_key: "claude-memory-after-disable"}});
  assert.equal(disabled.isError, true);
  const afterDisable = await db.select({count: count()}).from(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, userId));
  assert.equal(afterDisable[0]!.count, 1);
});

test("MCP write_memory requires active authentication before reaching the writer", async t => {
  let writes = 0;
  const server = createMcpServer({writeMemory: {subjectId: "G", repository: {insertMcpIdempotent: async () => {writes++; return {memoryId: randomUUID(), replayed: false};}}, requireActiveUser: async () => {throw new Error("disabled");}}});
  const client = new Client({name: "claude-mind-disabled-test", version: "1"}, {capabilities: {}});
  const [c, s] = InMemoryTransport.createLinkedPair(); await server.connect(s); await client.connect(c);
  t.after(async () => {await client.close(); await server.close();});
  const result = await client.callTool({name: "write_memory", arguments: {text: "tea", idempotency_key: "claude-memory-disabled-test"}});
  assert.equal(result.isError, true); assert.equal(writes, 0);
});
