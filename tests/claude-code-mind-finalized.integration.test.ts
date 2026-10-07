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

test("signed recall stays stateless until confirm, then materializes one idempotent finalized receipt", {skip: !enabled}, async t => {
  const database = createDatabase(url!, {ssl: false}); const db = database.db;
  const userId = randomUUID(), other = randomUUID();
  t.after(async () => {
    await db.execute(sql`DROP TRIGGER IF EXISTS mind_signed_test_count_effect ON runtime_subject_states`);
    await db.execute(sql`DROP FUNCTION IF EXISTS mind_signed_test_count_effect()`);
    await db.execute(sql`DROP TABLE IF EXISTS mind_signed_test_effects`);
    await db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, other));
    await database.close();
  });
  await db.insert(users).values([
    {id: userId, email: `${userId}@example.test`, displayName: "Signed Mind"},
    {id: other, email: `${other}@example.test`, displayName: "Signed Foreign"},
  ]);
  const port = new DrizzleSubjectStateRuntimePort(db);
  const receiptPort = new DrizzleClaudeCodeRecallReceipts(db, undefined, "s".repeat(64));
  const service = new ClaudeCodeMindRecallService(port, DEFAULT_MIND_LOOP_CONFIG, "G", receiptPort);
  const state = createMindState({
    id: randomUUID(), userId, subjectId: "G", kind: "memory", text: "osmanthus tea preference",
    source: {origin: "manual", occurredAt: null, note: null},
  });
  state.payload = {...state.payload, lifecycle_v1: {
    status: "active", salience: .5, protected: false,
    lastDecayedAt: new Date().toISOString(), lastRecalledAt: null,
    archivedAt: null, forgottenAt: null,
  }};
  await port.append({userId, subjectId: "G", states: [state]});
  const stored = async () => (await db.select().from(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, userId)))[0]!;
  const before = await stored();

  const result = await service.recall({
    userId, sessionId: "desktop-session", query: "osmanthus tea", excludeIds: [],
    contextEpoch: 3, receiptMode: "signed_v1",
  });
  assert.ok(result.recall_id); assert.ok(result.recall_token);
  assert.equal(result.context_sha256, createHash("sha256").update(result.context).digest("hex"));
  assert.equal((await db.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.userId, userId))).length, 0);
  assert.deepEqual(await stored(), before);

  const token = result.recall_token!;
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  const confirmation = {
    userId, recallId: result.recall_id!, recallToken: token,
    contextSha256: result.context_sha256!,
  };
  await assert.rejects(receiptPort.confirmSigned({...confirmation, recallToken: tampered}));
  await assert.rejects(receiptPort.confirmSigned({...confirmation, userId: other}));
  await assert.rejects(receiptPort.confirmSigned({...confirmation, recallId: randomUUID()}));
  await assert.rejects(receiptPort.confirmSigned({...confirmation, contextSha256: "0".repeat(64)}));
  assert.equal((await db.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.userId, userId))).length, 0);
  assert.deepEqual(await stored(), before);

  // Observe physical lifecycle UPDATEs, rather than inferring exactly-once from
  // an idempotent final payload that could hide repeated writes.
  await db.execute(sql`CREATE TABLE mind_signed_test_effects (id serial PRIMARY KEY)`);
  await db.execute(sql`CREATE FUNCTION mind_signed_test_count_effect() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO mind_signed_test_effects DEFAULT VALUES; RETURN NEW; END $$`);
  await db.execute(sql`CREATE TRIGGER mind_signed_test_count_effect AFTER UPDATE ON runtime_subject_states
    FOR EACH ROW EXECUTE FUNCTION mind_signed_test_count_effect()`);
  const effects = async () => Number((await db.execute<{count: string}>(sql`SELECT count(*) AS count FROM mind_signed_test_effects`))[0]!.count);
  // A deferred failure runs at COMMIT, after both receipt insertion and lifecycle
  // mutation. It must roll back the receipt, memory, and audit insert together.
  await db.execute(sql`CREATE FUNCTION mind_signed_test_abort() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'signed test abort at commit'; END $$`);
  await db.execute(sql`CREATE CONSTRAINT TRIGGER mind_signed_test_abort AFTER INSERT ON claude_code_recall_receipts
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mind_signed_test_abort()`);
  try {
    await assert.rejects(receiptPort.confirmSigned(confirmation));
    assert.deepEqual(await stored(), before);
    assert.equal((await db.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.id, result.recall_id!))).length, 0);
    assert.equal(await effects(), 0);
  } finally {
    await db.execute(sql`DROP TRIGGER mind_signed_test_abort ON claude_code_recall_receipts`);
    await db.execute(sql`DROP FUNCTION mind_signed_test_abort()`);
  }

  const outcomes = await Promise.all(Array.from({length: 12}, () => receiptPort.confirmSigned(confirmation)));
  assert.equal(outcomes.filter(value => value.outcome === "confirmed").length, 1);
  assert.equal(outcomes.filter(value => value.outcome === "replayed").length, 11);
  assert.equal(await effects(), 1);
  const [receipt] = await db.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.id, result.recall_id!));
  assert.ok(receipt?.confirmedAt);
  assert.equal(receipt?.contextEpoch, 3);
  assert.equal(receipt?.conversationId, "claude-code:desktop-session");
  const finalized = await stored();
  assert.equal(readSubjectStateLifecycle(finalized.payload)?.salience, .5);
  assert.deepEqual(readSubjectStateRecallContext(finalized.payload), {
    conversationId: "claude-code:desktop-session",
    epoch: 3,
    sourceMessageId: result.recall_id!,
    recalledAt: receipt!.recalledAt.toISOString(),
  });
  assert.equal(readSubjectStateLifecycle(finalized.payload)?.lastRecalledAt, receipt!.recalledAt.toISOString());
  assert.equal((await db.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.userId, userId))).length, 1);
  await assert.rejects(receiptPort.confirmSigned({...confirmation, userId: other}));
  // An ID collision is a replay only if every authoritative field matches.
  for (const mismatch of [
    {userId: other}, {subjectId: "foreign"}, {conversationId: "claude-code:foreign"},
    {contextEpoch: 9}, {stateIds: [randomUUID()]}, {contextSha256: "0".repeat(64)},
    {recalledAt: new Date(receipt!.recalledAt.getTime() + 1), expiresAt: new Date(receipt!.expiresAt.getTime() + 1)},
    {confirmedAt: null},
  ]) {
    await db.update(claudeCodeRecallReceipts).set(mismatch).where(eq(claudeCodeRecallReceipts.id, receipt!.id));
    await assert.rejects(receiptPort.confirmSigned(confirmation));
    assert.deepEqual(await stored(), finalized); assert.equal(await effects(), 1);
    await db.update(claudeCodeRecallReceipts).set(receipt!).where(eq(claudeCodeRecallReceipts.id, receipt!.id));
  }
  assert.deepEqual(await receiptPort.confirmSigned(confirmation), {outcome: "replayed"});
  assert.equal(await effects(), 1);

  const expired = await receiptPort.issueSigned({
    userId, subjectId: "G", conversationId: "claude-code:desktop-session",
    contextEpoch: 4, stateIds: [state.id!], contextSha256: "a".repeat(64),
    recalledAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  });
  await assert.rejects(receiptPort.confirmSigned({
    userId, recallId: expired.recall_id, recallToken: expired.recall_token,
    contextSha256: expired.context_sha256,
  }));
  assert.equal((await db.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.userId, userId))).length, 1);
  await db.update(users).set({status: "disabled"}).where(eq(users.id, userId));
  await assert.rejects(receiptPort.confirmSigned(confirmation));
  assert.deepEqual(await stored(), finalized); assert.equal(await effects(), 1);
});

test("signed loser waits for an uncommitted winner then replays; cleanup is bounded and skips locked expired rows", {skip: !enabled}, async t => {
  const database = createDatabase(url!, {ssl: false}); const db = database.db;
  const userId = randomUUID();
  t.after(async () => {await db.delete(users).where(eq(users.id, userId)); await database.close();});
  await db.insert(users).values({id: userId, email: `${userId}@example.test`, displayName: "Concurrent Signed"});
  const receipts = new DrizzleClaudeCodeRecallReceipts(db, undefined, "s".repeat(64));
  const issued = await receipts.issueSigned({userId, subjectId: "G", conversationId: "claude-code:concurrent",
    contextEpoch: 0, stateIds: [randomUUID()], contextSha256: "a".repeat(64), recalledAt: new Date().toISOString()});
  const input = {userId, recallId: issued.recall_id, recallToken: issued.recall_token, contextSha256: issued.context_sha256};
  const [isolation] = await db.execute<{transaction_isolation: string}>(sql`SHOW transaction_isolation`);
  assert.equal(isolation!.transaction_isolation, "read committed");
  let release!: () => void, ready!: () => void;
  const hold = new Promise<void>(resolve => {release = resolve;});
  const entered = new Promise<void>(resolve => {ready = resolve;});
  const pausedDb = {transaction: callback => db.transaction(async transaction => {
    const result = await callback(transaction); ready(); await hold; return result;
  })} as typeof db;
  const winner = new DrizzleClaudeCodeRecallReceipts(pausedDb, undefined, "s".repeat(64)).confirmSigned(input);
  await entered;
  let settled = false;
  const loser = receipts.confirmSigned(input).finally(() => {settled = true;});
  try {
    const deadline = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < deadline) {
      const [row] = await db.execute<{blocked: boolean}>(sql`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
        AND wait_event_type = 'Lock' AND query ILIKE '%insert into%claude_code_recall_receipts%'
      ) AS blocked`);
      if (row!.blocked) {blocked = true; break;}
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true); assert.equal(settled, false);
  } finally {release();}
  assert.deepEqual(await winner, {outcome: "confirmed"});
  assert.deepEqual(await loser, {outcome: "replayed"});

  const expiredIds = Array.from({length: 105}, () => randomUUID());
  const old = Date.now() - 3 * 86400000;
  await db.insert(claudeCodeRecallReceipts).values(expiredIds.map((id, index) => ({
    id, userId, subjectId: "G", conversationId: "claude-code:expired", contextEpoch: 0,
    stateIds: [randomUUID()], contextSha256: "b".repeat(64),
    recalledAt: new Date(old + index), expiresAt: new Date(old + index + 86400000), confirmedAt: null,
  })));
  let unlock!: () => void, locked!: () => void;
  const lockHold = new Promise<void>(resolve => {unlock = resolve;});
  const lockReady = new Promise<void>(resolve => {locked = resolve;});
  const locker = db.transaction(async transaction => {
    await transaction.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.id, expiredIds[0]!)).for("update");
    locked(); await lockHold;
  });
  await lockReady;
  try {
    assert.deepEqual(await receipts.confirmSigned(input), {outcome: "replayed"});
    const remaining = await db.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.userId, userId));
    assert.equal(remaining.length, 6); // Exactly 100 expired rows removed, plus 1 valid receipt retained.
    assert.ok(remaining.some(row => row.id === expiredIds[0]));
    assert.ok(remaining.some(row => row.id === issued.recall_id && row.confirmedAt));
  } finally {unlock(); await locker;}
});

test("signed confirm rechecks DB expiry after waiting on a concurrent receipt", {skip: !enabled}, async t => {
  const database = createDatabase(url!, {ssl: false}); const db = database.db;
  const userId = randomUUID();
  t.after(async () => {await db.delete(users).where(eq(users.id, userId)); await database.close();});
  await db.insert(users).values({id: userId, email: `${userId}@example.test`, displayName: "Expiring Signed"});
  const receipts = new DrizzleClaudeCodeRecallReceipts(db, undefined, "s".repeat(64));
  const [clock] = await db.execute<{now: Date}>(sql`SELECT clock_timestamp() AS now`);
  const issued = await receipts.issueSigned({userId, subjectId: "G", conversationId: "claude-code:expiry",
    contextEpoch: 0, stateIds: [randomUUID()], contextSha256: "a".repeat(64),
    recalledAt: new Date(new Date(clock!.now).getTime() - 86400000 + 500).toISOString()});
  const input = {userId, recallId: issued.recall_id, recallToken: issued.recall_token, contextSha256: issued.context_sha256};
  let release!: () => void, ready!: () => void;
  const hold = new Promise<void>(resolve => {release = resolve;});
  const entered = new Promise<void>(resolve => {ready = resolve;});
  const pausedDb = {transaction: callback => db.transaction(async transaction => {
    const result = await callback(transaction); ready(); await hold; return result;
  })} as typeof db;
  const winner = new DrizzleClaudeCodeRecallReceipts(pausedDb, undefined, "s".repeat(64)).confirmSigned(input);
  await entered;
  const loser = assert.rejects(receipts.confirmSigned(input), /RECALL_RECEIPT_UNAVAILABLE/);
  try {
    const deadline = Date.now() + 3000; let blocked = false;
    while (Date.now() < deadline) {
      const [row] = await db.execute<{blocked: boolean}>(sql`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
        AND wait_event_type = 'Lock' AND query ILIKE '%insert into%claude_code_recall_receipts%'
      ) AS blocked`);
      if (row!.blocked) {blocked = true; break;}
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(blocked);
    await db.execute(sql`SELECT pg_sleep(0.6)`);
  } finally {release();}
  await winner; await loser;
  assert.equal((await db.select().from(claudeCodeRecallReceipts).where(eq(claudeCodeRecallReceipts.userId, userId))).length, 1);
});
