import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, runtimeSubjectStates, claudeCodeRecallReceipts } from "../src/database/schema.js";
import { createMindState } from "../src/domains/runtime/mind/mind-writer.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";
import { DrizzleClaudeCodeRecallReceipts } from "../src/domains/runtime/mind/claude-code-recall-receipts.js";
import { ClaudeCodeMindRecallService } from "../src/domains/runtime/mind/claude-code-mind-recall.js";
import { DEFAULT_MIND_LOOP_CONFIG } from "../src/domains/runtime/mind/default-backend-mind-runtime.js";
import { readSubjectStateLifecycle, readSubjectStateRecallContext } from "../src/domains/runtime/lifecycle/memory-lifecycle.js";

const url = process.env.DATABASE_URL;
const enabled = process.env.RUN_CLAUDE_CODE_MIND_DATABASE_TEST === "1" && !!url && ["localhost", "127.0.0.1"].includes(new URL(url!).hostname) && /test|regression|ci/.test(new URL(url!).pathname);

test("durable pending→confirm is atomic, zero-boost, idempotent, identity/expiry fenced and shares Native Live lifecycle", {skip: !enabled}, async t => {
  const database = createDatabase(url!, {ssl: false}); const db = database.db;
  const userId = randomUUID(), other = randomUUID();
  t.after(async () => {await db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, userId));
    await db.delete(users).where(eq(users.id, userId)); await db.delete(users).where(eq(users.id, other)); await database.close();});
  await db.insert(users).values([{id: userId, email: `${userId}@example.test`, displayName: "Mind V2"}, {id: other, email: `${other}@example.test`, displayName: "Foreign user"}]);
  const port = new DrizzleSubjectStateRuntimePort(db); const receiptPort = new DrizzleClaudeCodeRecallReceipts(db);
  const service = new ClaudeCodeMindRecallService(port, {...DEFAULT_MIND_LOOP_CONFIG, breathCooldownHours: 2}, "G", receiptPort);
  const state = createMindState({id: randomUUID(), userId, subjectId: "G", kind: "memory", text: "jasmine tea preference", source: {origin: "manual", occurredAt: null, note: null}});
  state.payload = {...state.payload, lifecycle_v1: {status: "active", salience: .5, protected: false, lastDecayedAt: new Date().toISOString(), lastRecalledAt: null, archivedAt: null, forgottenAt: null}};
  await port.append({userId, subjectId: "G", states: [state]});
  const stored = async () => (await db.select().from(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, userId)))[0]!;
  const before = await stored(); const input = {userId, sessionId: "session", query: "jasmine tea", excludeIds: [], contextEpoch: 7};
  const first = await service.recall(input); assert.ok(first.recall_id); assert.equal(first.context_sha256, createHash("sha256").update(first.context).digest("hex"));
  const second = await service.recall({...input, semanticCandidates: first.semantic_candidates, semanticScores: new Map(first.semantic_candidates.map(c => [c.stateId, .99]))});
  assert.ok(second.recall_id); assert.notEqual(first.recall_id, second.recall_id); assert.deepEqual(await stored(), before);
  const receipts = await db.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.userId, userId)); assert.equal(receipts.length, 2);
  const r = receipts.find(r => r.id === second.recall_id)!;
  assert.deepEqual(r.stateIds, [state.id]); assert.equal(r.contextEpoch, 7); assert.equal(r.conversationId, "claude-code:session");
  assert.equal(r.expiresAt.getTime() - r.recalledAt.getTime(), 86400000); assert.equal(r.confirmedAt, null);
  for (const key of ["query", "prompt", "context", "transcript", "reply"]) assert.ok(!(key in r));
  const confirm = {userId, recallId: second.recall_id!, contextSha256: second.context_sha256!};
  for (const invalid of [{...confirm, userId: other}, {...confirm, recallId: randomUUID()}, {...confirm, contextSha256: "0".repeat(64)}]) await assert.rejects(receiptPort.confirm(invalid));
  assert.deepEqual(await stored(), before);
  // Inject failure after memory mutation but before the receipt update; both must roll back.
  await db.execute(sql`CREATE FUNCTION mind_v2_test_fail_confirm() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test abort'; END $$`);
  await db.execute(sql`CREATE TRIGGER mind_v2_test_fail_confirm BEFORE UPDATE ON claude_code_recall_receipts FOR EACH ROW EXECUTE FUNCTION mind_v2_test_fail_confirm()`);
  try {await assert.rejects(receiptPort.confirm(confirm)); assert.deepEqual(await stored(), before);
    const [pending] = await db.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.id, r.id)); assert.equal(pending!.confirmedAt, null);
  } finally {await db.execute(sql`DROP TRIGGER mind_v2_test_fail_confirm ON claude_code_recall_receipts`); await db.execute(sql`DROP FUNCTION mind_v2_test_fail_confirm()`);}
  const outcomes = await Promise.all([receiptPort.confirm(confirm), receiptPort.confirm(confirm), receiptPort.confirm(confirm)]);
  assert.deepEqual(outcomes.map(r => r.outcome).sort(), ["confirmed", "replayed", "replayed"]);
  const finalized = await stored();
  assert.equal(readSubjectStateLifecycle(finalized.payload)?.salience, .5);
  assert.equal(readSubjectStateLifecycle(finalized.payload)?.lastRecalledAt, r.recalledAt.toISOString());
  assert.deepEqual(readSubjectStateRecallContext(finalized.payload), {conversationId: "claude-code:session", epoch: 7, sourceMessageId: r.id, recalledAt: r.recalledAt.toISOString()});
  const [unused] = await db.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.id, first.recall_id!)); assert.equal(unused!.confirmedAt, null);
  await receiptPort.confirm(confirm); assert.deepEqual(await stored(), finalized);
  const sameEpoch = await service.recall(input); assert.equal(sameEpoch.context, ""); assert.equal(sameEpoch.recall_id, undefined);
  const afterCompact = await service.recall({...input, contextEpoch: 8}); assert.deepEqual(afterCompact.memory_ids, [state.id]);
  await db.update(claudeCodeRecallReceipts).set({recalledAt: new Date(Date.now() - 2 * 86400000), expiresAt: new Date(Date.now() - 86400000)})
    .where(eq(claudeCodeRecallReceipts.id, afterCompact.recall_id!));
  await assert.rejects(receiptPort.confirm({...confirm, recallId: afterCompact.recall_id!, contextSha256: afterCompact.context_sha256!}));
  assert.deepEqual(await stored(), finalized);
  // Native Live wrapper still rejects nonexistent canonical sources.
  await port.recordBreathRecall({userId, subjectId: "G", conversationId: randomUUID(), contextEpoch: 8, stateIds: [state.id!], recalledAt: new Date().toISOString(), salienceBoost: .1, sourceMessageId: randomUUID()});
  assert.deepEqual(await stored(), finalized);
  await db.update(users).set({status: "disabled"}).where(eq(users.id, userId));
  await assert.rejects(receiptPort.confirm(confirm)); assert.deepEqual(await stored(), finalized);
});
