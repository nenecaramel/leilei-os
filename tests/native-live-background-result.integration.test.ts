import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, nativeLiveTurnPreparations, nativeLiveRuntimeEvents, nativeLiveRuntimeListenerLeases, conversationProviderSessionCheckpoints } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveBackendRelayRepository } from "../src/domains/bridge/relay/native-live-backend-relay.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";
import { NativeLiveSilenceWakeService, silenceWakePreparationId } from "../src/domains/bridge/turn/native-live-silence-wake.js";

const enabled = process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST === "1";
async function fixture(t: test.TestContext) {
  const url = process.env.DATABASE_URL; assert.ok(url);
  const { isolatedPostgresTarget, verifyIsolatedPostgresTarget } = await import("../scripts/isolated-postgres-target.mjs");
  await verifyIsolatedPostgresTarget(isolatedPostgresTarget(url));
  const database = createDatabase(url, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `background-receipt-${crypto.randomUUID()}@example.com`, displayName: "Synthetic background" }).returning();
  t.after(async () => { try { await database.db.delete(nativeLiveRuntimeListenerLeases).where(eq(nativeLiveRuntimeListenerLeases.userId, user.id)); await database.db.delete(conversations).where(eq(conversations.userId, user.id)); await database.db.delete(users).where(eq(users.id, user.id)); } finally { await database.close(); } });
  const canonical = new DrizzleNativeLiveConversationRepository(database.db), conversation = await canonical.createConversation({ userId: user.id });
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  const source = await coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: crypto.randomUUID(), conversation_id: conversation.id, operation: "send", expected_head_message_id: null, text: "synthetic" });
  assert.ok(source.ok); if (!source.ok) throw Error("source prepare failed");
  const listenerInstanceId = crypto.randomUUID(), generationId = crypto.randomUUID(), receiptId = crypto.randomUUID(), base = crypto.randomUUID(), next = crypto.randomUUID();
  const deadline = new Date(Date.now() + 600_000);
  await database.db.insert(nativeLiveRuntimeListenerLeases).values({ userId: user.id, listenerInstanceId, dispatchTarget: "claude_code", leaseExpiresAt: deadline });
  await database.db.update(nativeLiveTurnPreparations).set({ reservedBy: listenerInstanceId, reservedAt: new Date(), reservationExpiresAt: deadline, executionStartedAt: new Date(), dispatchStatus: "executing" }).where(eq(nativeLiveTurnPreparations.id, source.command.prepare_id));
  const completed = await coordinator.finalize(user.id, { protocol_version: 4, prepare_id: source.command.prepare_id, request_id: source.command.request_id, conversation_id: conversation.id, status: "success", provider_session_id: "synthetic-session", provider_checkpoint_id: base, effective_working_directory: "/synthetic", normalized_events: [{ type: "text", payload: { text: "foreground synthetic" } }] });
  assert.ok(completed.ok && completed.outcome === "completed"); if (!completed.ok || completed.outcome !== "completed") throw Error("source completion failed");
  const repository = new DrizzleNativeLiveBackendRelayRepository(database.db);
  await repository.markCompleted({ userId: user.id, listenerInstanceId, reservationId: source.command.prepare_id });
  const prepare = { userId: user.id, sourcePrepareId: source.command.prepare_id, listenerInstanceId, generationId, receiptId, parentProviderCheckpointId: base };
  const result = { protocol_version: 4 as const, prepare_id: source.command.prepare_id, request_id: source.command.request_id, conversation_id: conversation.id, status: "success" as const, provider_session_id: "synthetic-session", provider_checkpoint_id: next, effective_working_directory: "/synthetic", normalized_events: [{ type: "text", payload: { text: "background synthetic" } }] };
  const submit = { userId: user.id, sourcePrepareId: source.command.prepare_id, listenerInstanceId, generationId, receiptId, result };
  const parent = async () => {
    const active = await canonical.getConversation({ userId: user.id, conversationId: conversation.id });
    const prepared = await coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: crypto.randomUUID(), conversation_id: conversation.id, operation: "send", expected_head_message_id: active!.currentHeadMessageId, text: "next synthetic" });
    assert.ok(prepared.ok); if (!prepared.ok) throw Error("send failed"); return prepared.command.parent_provider_checkpoint_id;
  };
  return { database, user, canonical, coordinator, conversation, repository, source, completed, base, next, prepare, submit, parent };
}


test("foreground commit advances owner anchor to its canonical assistant in the same transaction", { skip: !enabled }, async t => {
  const f=await fixture(t);
  const [head] = await f.database.db.execute<{ owner: string | null; anchor: string | null; current: string | null }>(sql`
    SELECT provider_metadata->'native_live_presentation_owner'->>'prepareId' AS owner,
      provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId' AS anchor,
      current_head_message_id::text AS current
    FROM conversations WHERE user_id=${f.user.id}::uuid AND id=${f.conversation.id}::uuid
  `);
  assert.equal(head?.owner,f.source.command.prepare_id);
  assert.equal(head?.anchor,f.completed.assistantMessageId);
  assert.equal(head?.current,f.completed.assistantMessageId);
  // Idle Cron B must be able to append on top of H immediately, even when
  // no new foreground preparation rotated the owner.
  await f.repository.prepareBackgroundResult(f.prepare);
  assert.equal((await f.repository.submitBackgroundResult(f.submit)).outcome,"committed");
  const [advanced] = await f.database.db.execute<{ anchor: string | null }>(sql`
    SELECT provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId' AS anchor
    FROM conversations WHERE user_id=${f.user.id}::uuid AND id=${f.conversation.id}::uuid
  `);
  assert.equal(advanced?.anchor,f.prepare.receiptId);
});


for (const legacy of [false, true] as const) test(`visible Silence Wake followed by Cron succeeds after ${legacy ? "legacy anchor repair" : "new anchor commit"}`, { skip: !enabled }, async t => {
  const f = await fixture(t);
  let now = new Date();
  const silence = new NativeLiveSilenceWakeService(f.database.db, () => now);
  const schedule = await silence.readSchedule({ userId: f.user.id });
  assert.ok(schedule);
  now = new Date(schedule.postTurnDueAt);
  assert.equal((await silence.fire({
    userId: f.user.id, epochId: schedule.epochId, slot: "post_turn_idle",
  })).outcome, "queued");

  const wakeId = silenceWakePreparationId(schedule.epochId, "post_turn_idle");
  const wake = await new DrizzleNativeLiveBackendTurnPort(f.database.db)
    .getPreparation({ userId: f.user.id, prepareId: wakeId });
  assert.ok(wake);
  const deadline = new Date(Date.now() + 600_000);
  await f.database.db.update(nativeLiveTurnPreparations).set({
    runtimeMode: "resume", reservedBy: f.prepare.listenerInstanceId,
    reservedAt: new Date(), reservationExpiresAt: deadline,
    executionStartedAt: new Date(), dispatchStatus: "executing",
  }).where(eq(nativeLiveTurnPreparations.id, wakeId));

  const wakeCheckpoint = crypto.randomUUID();
  const result = await f.coordinator.finalize(f.user.id, {
    protocol_version: 4, prepare_id: wakeId, request_id: wake.requestId,
    conversation_id: f.conversation.id, status: "success",
    provider_session_id: "synthetic-session", provider_checkpoint_id: wakeCheckpoint,
    effective_working_directory: "/synthetic",
    normalized_events: [{ type: "text", payload: { text: "Visible Wake reply" } }],
  });
  assert.equal(result.ok, true);
  if (!result.ok || result.outcome !== "completed")
    throw Error("visible same-session Wake must have a canonical assistant head");
  assert.equal(await f.repository.markCompleted({
    userId: f.user.id, listenerInstanceId: f.prepare.listenerInstanceId, reservationId: wakeId,
  }), "applied");

  const [surface] = await f.database.db.execute<{
    owner: string | null; anchor: string | null; head: string | null;
  }>(sql`
    SELECT provider_metadata->'native_live_presentation_owner'->>'prepareId' AS owner,
      provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId' AS anchor,
      current_head_message_id::text AS head
    FROM conversations WHERE user_id=${f.user.id}::uuid AND id=${f.conversation.id}::uuid
  `);
  assert.equal(surface.owner, f.source.command.prepare_id,
    "Wake must NOT steal the original SDK writer/Cron owner");
  assert.equal(surface.head, result.assistantMessageId);
  assert.equal(surface.anchor, result.assistantMessageId,
    "background CAS must use Wake's current head, not the previous foreground head");

  if (legacy) {
    // Simulate the bad production history from before this fix: visible Wake
    // already moved the canonical head, but the source owner still anchors H.
    await f.database.db.execute(sql`
      UPDATE conversations SET provider_metadata = jsonb_set(
        provider_metadata, '{native_live_presentation_owner,anchorHeadMessageId}',
        to_jsonb(${f.completed.assistantMessageId}::text))
      WHERE user_id=${f.user.id}::uuid AND id=${f.conversation.id}::uuid
    `);
  }
  const receiptId = crypto.randomUUID();
  const background = {
    ...f.prepare, sourcePrepareId: wakeId, receiptId,
    parentProviderCheckpointId: wakeCheckpoint,
  };
  const nextResult = {
    ...f.submit.result, prepare_id: wakeId, request_id: wake.requestId,
    provider_checkpoint_id: crypto.randomUUID(),
    normalized_events: [{ type: "text", payload: { text: "Cron test: still running after Wake" } }],
  };
  assert.equal((await f.repository.prepareBackgroundResult(background)).receiptId, receiptId);
  const commit = await f.repository.submitBackgroundResult({
    ...f.submit, sourcePrepareId: wakeId, receiptId, result: nextResult,
  });
  assert.equal(commit.outcome, "committed",
    "the real regression was prepare HTTP 200 followed by result HTTP 409");
  const [after] = await f.database.db.execute<{ head: string | null; anchor: string | null }>(sql`
    SELECT current_head_message_id::text AS head,
      provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId' AS anchor
    FROM conversations WHERE user_id=${f.user.id}::uuid AND id=${f.conversation.id}::uuid
  `);
  assert.equal(after.head, receiptId);
  assert.equal(after.anchor, receiptId);
});


async function strandedRejectedWake(t: test.TestContext, intermediate = false) {
  const f = await fixture(t);
  let preWakeHead = f.completed.assistantMessageId;
  if (intermediate) {
    // A real earlier Cron B advances H -> B within the same SDK generation.
    // The later visible Wake is sourced from B, not from the original H.
    await f.repository.prepareBackgroundResult(f.prepare);
    assert.equal((await f.repository.submitBackgroundResult(f.submit)).outcome, "committed");
    preWakeHead = f.prepare.receiptId;
  }
  let now = new Date();
  const silence = new NativeLiveSilenceWakeService(f.database.db, () => now);
  const schedule = await silence.readSchedule({ userId: f.user.id });
  assert.ok(schedule);
  now = new Date(schedule.postTurnDueAt);
  assert.equal((await silence.fire({
    userId: f.user.id, epochId: schedule.epochId, slot: "post_turn_idle",
  })).outcome, "queued");
  const wakeId = silenceWakePreparationId(schedule.epochId, "post_turn_idle");
  const wake = await new DrizzleNativeLiveBackendTurnPort(f.database.db)
    .getPreparation({ userId: f.user.id, prepareId: wakeId });
  assert.ok(wake);
  const deadline = new Date(Date.now() + 600_000);
  await f.database.db.update(nativeLiveTurnPreparations).set({
    runtimeMode: "resume", reservedBy: f.prepare.listenerInstanceId,
    reservedAt: new Date(), reservationExpiresAt: deadline,
    executionStartedAt: new Date(), dispatchStatus: "executing",
  }).where(eq(nativeLiveTurnPreparations.id, wakeId));
  const wakeCheckpoint = crypto.randomUUID();
  const final = await f.coordinator.finalize(f.user.id, {
    protocol_version: 4, prepare_id: wakeId, request_id: wake.requestId,
    conversation_id: f.conversation.id, status: "success",
    provider_session_id: "synthetic-session", provider_checkpoint_id: wakeCheckpoint,
    effective_working_directory: "/synthetic",
    normalized_events: [{ type: "text", payload: { text: "Visible Wake W" } }],
  });
  assert.ok(final.ok && final.outcome === "completed");
  if (!final.ok || final.outcome !== "completed") throw Error("Wake not completed");
  assert.equal(await f.repository.markCompleted({
    userId: f.user.id, listenerInstanceId: f.prepare.listenerInstanceId, reservationId: wakeId,
  }), "applied");

  // Old deployed Wake advanced source -> W but left its inherited
  // anchor at source; source may be an earlier Cron (not original H).
  await f.database.db.execute(sql`
    UPDATE conversations SET provider_metadata=jsonb_set(
      provider_metadata, '{native_live_presentation_owner,anchorHeadMessageId}',
      to_jsonb(${preWakeHead}::text))
    WHERE user_id=${f.user.id}::uuid AND id=${f.conversation.id}::uuid
  `);
  const receiptId = crypto.randomUUID();
  const prepare = {
    ...f.prepare, sourcePrepareId: wakeId, receiptId,
    parentProviderCheckpointId: wakeCheckpoint,
  };
  const submit = {
    ...f.submit, sourcePrepareId: wakeId, receiptId,
    result: {
      ...f.submit.result, prepare_id: wakeId, request_id: wake.requestId,
      provider_checkpoint_id: crypto.randomUUID(),
      normalized_events: [{ type: "text" as const, payload: { text: "Preexisting Cron B" } }],
    },
  };
  await f.repository.prepareBackgroundResult(prepare);
  await assert.rejects(f.repository.submitBackgroundResult(submit),
    { code: "BACKGROUND_CONFLICT" }, "original HTTP 409 must be reproduced first");

  const rejected = await f.coordinator.prepare(f.user.id, {
    dispatch_target: "claude_code", request_id: crypto.randomUUID(),
    conversation_id: f.conversation.id, operation: "send",
    expected_head_message_id: final.assistantMessageId, text: "send blocked by recovery",
  });
  assert.ok(rejected.ok);
  if (!rejected.ok) throw Error("failed foreground could not prepare");
  assert.equal(rejected.command.runtime_mode, "resume");
  await f.database.db.update(nativeLiveTurnPreparations).set({
    reservedBy: f.prepare.listenerInstanceId, dispatchStatus: "executing",
    reservationExpiresAt: deadline, executionStartedAt: new Date(),
  }).where(eq(nativeLiveTurnPreparations.id, rejected.command.prepare_id));
  assert.equal(await f.repository.rejectReservation({
    userId: f.user.id, listenerInstanceId: f.prepare.listenerInstanceId,
    reservationId: rejected.command.prepare_id, code: "INVALID_COMMAND",
  }), "applied");

  // Same receipt is now beyond its old transport lease: this reproduces
  // Mac restart's background-results/prepare HTTP 409 after the Failed alert.
  await f.database.db.execute(sql`
    UPDATE native_live_runtime_events SET payload=jsonb_set(
      payload, '{expiresAt}', to_jsonb('2000-01-01T00:00:00.000Z'::text))
    WHERE user_id=${f.user.id}::uuid AND id=${receiptId}::uuid
  `);
  return { ...f, wakeId, wakeHead: final.assistantMessageId, preWakeHead,
    prepare, submit, rejectedId: rejected.command.prepare_id, receiptId };
}

test("expired Cron receipt reclaims only a rejected unstarted send owner after legacy Wake 409", { skip: !enabled }, async t => {
  const f = await strandedRejectedWake(t);
  const [before] = await f.database.db.execute<{ owner: string; anchor: string }>(sql`
    SELECT provider_metadata->'native_live_presentation_owner'->>'prepareId' AS owner,
      provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId' AS anchor
    FROM conversations WHERE id=${f.conversation.id}::uuid
  `);
  assert.equal(before.owner, f.rejectedId);
  assert.equal(before.anchor, f.wakeHead);
  assert.equal((await f.repository.prepareBackgroundResult(f.prepare)).receiptId, f.receiptId);
  const committed = await f.repository.submitBackgroundResult(f.submit);
  assert.equal(committed.outcome, "committed");
  assert.equal(committed.providerCheckpointId, f.submit.result.provider_checkpoint_id);
  const [after] = await f.database.db.execute<{ owner: string; anchor: string; head: string }>(sql`
    SELECT provider_metadata->'native_live_presentation_owner'->>'prepareId' AS owner,
      provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId' AS anchor,
      current_head_message_id::text AS head
    FROM conversations WHERE id=${f.conversation.id}::uuid
  `);
  assert.equal(after.owner, f.source.command.prepare_id,
    "rejected foreground may not steal the recovered persistent SDK owner");
  assert.equal(after.anchor, f.receiptId);
  assert.equal(after.head, f.receiptId);
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit),
    { outcome: "committed", duplicate: true, providerCheckpointId: f.submit.result.provider_checkpoint_id });
});


test("historical Wake sourced from a prior canonical Cron recovers the stranded original owner", { skip: !enabled }, async t => {
  const f = await strandedRejectedWake(t, true);
  assert.notEqual(f.preWakeHead, f.completed.assistantMessageId,
    "reproduce the production wakeSourceMatches=false without forging session ancestry");
  const [old] = await f.database.db.execute<{ wakeSource: string; initialOwnerAssistant: string }>(sql`
    SELECT w.wake_context->>'source_head_message_id' AS "wakeSource",
      owner.assistant_message_id::text AS "initialOwnerAssistant"
    FROM native_live_turn_preparations w
    JOIN native_live_turn_preparations owner
      ON owner.id=${f.source.command.prepare_id}::uuid
    WHERE w.id=${f.wakeId}::uuid
  `);
  assert.equal(old.wakeSource, f.preWakeHead);
  assert.equal(old.initialOwnerAssistant, f.completed.assistantMessageId);
  assert.notEqual(old.wakeSource, old.initialOwnerAssistant);
  assert.equal((await f.repository.prepareBackgroundResult(f.prepare)).receiptId, f.receiptId,
    "renew the saved original receipt without running Claude again");
  assert.equal((await f.repository.submitBackgroundResult(f.submit)).outcome, "committed");
  const [state] = await f.database.db.execute<{ head: string; owner: string; anchor: string }>(sql`
    SELECT current_head_message_id::text AS head,
      provider_metadata->'native_live_presentation_owner'->>'prepareId' AS owner,
      provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId' AS anchor
    FROM conversations WHERE id=${f.conversation.id}::uuid
  `);
  assert.equal(state.head, f.receiptId);
  assert.equal(state.anchor, f.receiptId);
  assert.equal(state.owner, f.source.command.prepare_id);
});

for (const tamper of ["not actual Wake parent", "previous Cron changed generation"] as const)
  test(`multi-hop Wake recovery refuses ${tamper}`, { skip: !enabled }, async t => {
    const f = await strandedRejectedWake(t, true);
    if (tamper === "not actual Wake parent") {
      await f.database.db.execute(sql`
        UPDATE native_live_turn_preparations
        SET wake_context=jsonb_set(wake_context,'{source_head_message_id}',
          to_jsonb(${f.completed.assistantMessageId}::text))
        WHERE id=${f.wakeId}::uuid
      `);
    } else {
      await f.database.db.execute(sql`
        UPDATE conversation_provider_session_checkpoints
        SET runtime_metadata=jsonb_set(runtime_metadata,
          '{native_live_generation,presentation_owner_id}',
          to_jsonb(${crypto.randomUUID()}::text))
        WHERE user_id=${f.user.id}::uuid
          AND conversation_id=${f.conversation.id}::uuid
          AND canonical_message_id=${f.preWakeHead}::uuid
      `);
    }
    await assert.rejects(f.repository.prepareBackgroundResult(f.prepare),
      { code: "BACKGROUND_CONFLICT" });
    const [state] = await f.database.db.execute<{ head: string; owner: string }>(sql`
      SELECT current_head_message_id::text AS head,
        provider_metadata->'native_live_presentation_owner'->>'prepareId' AS owner
      FROM conversations WHERE id=${f.conversation.id}::uuid
    `);
    assert.equal(state.head, f.wakeHead);
    assert.equal(state.owner, f.rejectedId, "failed lineage proof cannot seize ownership");
  });

for (const mutated of ["started input", "runtime evidence", "changed revision", "competing foreground"] as const)
  test(`recovery refuses ${mutated} after rejected foreground`, { skip: !enabled }, async t => {
    const f = await strandedRejectedWake(t);
    if (mutated === "started input") {
      await f.database.db.execute(sql`
        UPDATE native_live_turn_preparations
        SET runtime_metadata=jsonb_set(coalesce(runtime_metadata,'{}'::jsonb),
          '{native_live_input_binding}', '{"started":true}'::jsonb)
        WHERE id=${f.rejectedId}::uuid
      `);
    } else if (mutated === "runtime evidence") {
      await f.database.db.execute(sql`
        INSERT INTO native_live_runtime_events
          (id,user_id,prepare_id,sequence,event_type,provider_session_id,payload)
        VALUES (${crypto.randomUUID()}::uuid,${f.user.id}::uuid,
          ${f.rejectedId}::uuid,1,'runtime',NULL,'{}'::jsonb)
      `);
    } else if (mutated === "changed revision") {
      await f.database.db.execute(sql`
        UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata,
          '{nativeSessionSource,revision}',to_jsonb(${crypto.randomUUID()}::text))
        WHERE id=${f.conversation.id}::uuid
      `);
    } else {
      const competitor = await f.coordinator.prepare(f.user.id, {
        dispatch_target: "claude_code", request_id: crypto.randomUUID(),
        conversation_id: f.conversation.id, operation: "send",
        expected_head_message_id: f.wakeHead, text: "live competing foreground",
      });
      assert.equal(competitor.ok, true);
    }
    await assert.rejects(f.repository.prepareBackgroundResult(f.prepare), { code: "BACKGROUND_CONFLICT" });
    const [after] = await f.database.db.execute<{ head: string; anchor: string }>(sql`
      SELECT current_head_message_id::text AS head,
        provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId' AS anchor
      FROM conversations WHERE id=${f.conversation.id}::uuid
    `);
    assert.equal(after.head, f.wakeHead, "unsafe recovery cannot append an old B");
    assert.equal(after.anchor, f.wakeHead, "unsafe recovery cannot change the presentation anchor");
  });

test("committed background reply is one canonical descendant through reopen and pagination", { skip: !enabled }, async t => {
  const f = await fixture(t), reader = new DrizzleNativeLiveCurrentPathReader(f.database.db);
  const read = (options: { afterMessageId?: string; beforeMessageId?: string } = {}) =>
    reader.readCurrentPath({ userId: f.user.id, conversationId: f.conversation.id, limit: 100, ...options });
  await f.repository.prepareBackgroundResult(f.prepare);
  assert.equal((await read())!.messages.length, 2, "uncommitted background is not a chat message");
  assert.equal((await f.repository.submitBackgroundResult(f.submit)).outcome, "committed");
  const first = (await read())!;
  assert.equal(first.messages.length, 3);
  assert.equal(first.currentHeadMessageId, f.prepare.receiptId);
  assert.equal(first.messages.at(-1)!.id, f.prepare.receiptId);
  assert.equal(first.messages.at(-1)!.parentMessageId, f.completed.assistantMessageId);
  const delta = (await read({ afterMessageId: f.completed.assistantMessageId }))!;
  assert.deepEqual(delta.messages.map(row => row.id), [f.prepare.receiptId], "delta contains the canonical append");
  assert.equal((await read({ beforeMessageId: f.completed.assistantMessageId }))!.messages.some(row => row.id === f.prepare.receiptId), false);
  assert.equal((await f.repository.submitBackgroundResult(f.submit)).duplicate, true);
  assert.deepEqual((await read())!.messages.map(row => row.id), first.messages.map(row => row.id), "reopen cannot duplicate the same receipt");
  const [source] = await f.database.db.select({ parent: conversationMessages.parentMessageId })
    .from(conversationMessages).where(eq(conversationMessages.id, f.completed.assistantMessageId));
  assert.ok(source?.parent);
  await f.database.db.update(conversations).set({ currentHeadMessageId: source.parent })
    .where(eq(conversations.id, f.conversation.id));
  assert.equal((await read())!.messages.some(row => row.id === f.prepare.receiptId), false, "retired branch must not leak the reply");
});

test("background commit has its own durable receipt and does not rewrite canonical foreground history", { skip: !enabled }, async t => {
  const f = await fixture(t);
  const sourceBefore = await f.database.db.select().from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, f.prepare.sourcePrepareId));
  const prepared = await f.repository.prepareBackgroundResult(f.prepare); assert.equal(prepared.receiptId, f.prepare.receiptId);
  const committed = await f.repository.submitBackgroundResult(f.submit);
  assert.deepEqual(committed, { outcome: "committed", duplicate: false, providerCheckpointId: f.next });
  assert.deepEqual(await f.database.db.select().from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, f.prepare.sourcePrepareId)), sourceBefore);
  const messages = await f.database.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, f.conversation.id)); assert.equal(messages.length, 3);
  assert.equal((await f.canonical.getConversation({ userId: f.user.id, conversationId: f.conversation.id }))!.currentHeadMessageId, f.prepare.receiptId);
  const [owner] = await f.database.db.execute<{ anchor: string | null }>(sql`
    SELECT provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId' AS anchor
    FROM conversations WHERE user_id=${f.user.id}::uuid AND id=${f.conversation.id}::uuid`);
  assert.equal(owner!.anchor, f.prepare.receiptId,
    "canonical background head and next-turn presentation anchor must advance atomically");
  const cp = await f.canonical.getProviderCheckpointForHead({ userId: f.user.id, conversationId: f.conversation.id, canonicalMessageId: f.completed.assistantMessageId }); assert.equal(cp!.providerCheckpointId, f.base);
  assert.deepEqual(cp!.runtimeMetadata?.native_live_generation, { presentation_owner_id: f.prepare.sourcePrepareId, source_revision: null }, "checkpoint must carry the current server generation");
  const receipt = await f.database.db.select().from(nativeLiveRuntimeEvents).where(eq(nativeLiveRuntimeEvents.id, f.prepare.receiptId)); assert.equal(receipt.length, 1); assert.equal(receipt[0]!.eventType, "runtime");
  assert.equal(await f.parent(), f.next);
});

test("lost responses can retry preparation and commit without advancing twice", { skip: !enabled }, async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.repository.prepareBackgroundResult(f.prepare), await f.repository.prepareBackgroundResult(f.prepare));
  await f.repository.submitBackgroundResult(f.submit);
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit), { outcome: "committed", duplicate: true, providerCheckpointId: f.next });
  await assert.rejects(f.repository.submitBackgroundResult({ ...f.submit, result: { ...f.submit.result, provider_checkpoint_id: crypto.randomUUID() } }), { code: "BACKGROUND_CONFLICT" });
  assert.equal(await f.parent(), f.next);
});

for (const mutation of ["foreground", "desktop", "head", "generation", "revision", "expired-listener"] as const) test(`background receipt cannot commit after ${mutation} changes`, { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  if (mutation === "foreground") assert.equal(await f.parent(), f.base);
  else if (mutation === "expired-listener") await f.database.db.update(nativeLiveRuntimeListenerLeases).set({ leaseExpiresAt: new Date(0) }).where(eq(nativeLiveRuntimeListenerLeases.userId, f.user.id));
  else if (mutation === "head") await f.database.db.update(conversations).set({ currentHeadMessageId: null }).where(eq(conversations.id, f.conversation.id));
  else await f.database.db.execute(mutation === "generation"
    ? sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata, '{native_live_presentation_owner}', jsonb_build_object('prepareId', ${crypto.randomUUID()}::text)) WHERE id=${f.conversation.id}::uuid`
    : mutation === "revision" ? sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata, '{nativeSessionSource}', '{"owner":"leileios","revision":"changed"}'::jsonb) WHERE id=${f.conversation.id}::uuid`
      : sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata, '{nativeSessionSource}', '{"owner":"desktop"}'::jsonb) WHERE id=${f.conversation.id}::uuid`);
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit), { outcome: "stale", duplicate: false, providerCheckpointId: null });
  const [receipt] = await f.database.db.select().from(nativeLiveRuntimeEvents).where(eq(nativeLiveRuntimeEvents.id, f.prepare.receiptId));
  assert.equal(receipt!.payload?.result, undefined, "stale background content must be discarded, not attached to a retired branch");
  const cp = await f.canonical.getProviderCheckpointForHead({ userId: f.user.id, conversationId: f.conversation.id, canonicalMessageId: f.completed.assistantMessageId }); assert.equal(cp!.runtimeMetadata?.native_live_resume_tail, undefined);
  assert.equal((await f.canonical.getConversation({ userId: f.user.id, conversationId: f.conversation.id }))!.currentHeadMessageId,
    mutation === "head" ? null : f.completed.assistantMessageId,
    "stale background result must not write a canonical message or advance the head");
});

test("another user's or another listener's receipt is never accessible", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  await assert.rejects(f.repository.submitBackgroundResult({ ...f.submit, userId: crypto.randomUUID() }), { code: "BACKGROUND_NOT_FOUND" });
  await assert.rejects(f.repository.submitBackgroundResult({ ...f.submit, listenerInstanceId: crypto.randomUUID() }), { code: "BACKGROUND_CONFLICT" });
  await assert.rejects(f.repository.submitBackgroundResult({ ...f.submit, generationId: crypto.randomUUID() }), { code: "BACKGROUND_CONFLICT" });
});

test("parallel identical completion commits at most once", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  const results = await Promise.all([f.repository.submitBackgroundResult(f.submit), f.repository.submitBackgroundResult(f.submit)]);
  assert.equal(results.filter(value => !value.duplicate).length, 1); assert.ok(results.every(value => value.outcome === "committed"));
  assert.equal(await f.parent(), f.next);
});

test("a second receipt from the old parent cannot overwrite the first committed result", { skip: !enabled }, async t => {
  const f = await fixture(t), second = crypto.randomUUID();
  await f.repository.prepareBackgroundResult(f.prepare); await f.repository.prepareBackgroundResult({ ...f.prepare, receiptId: second });
  await f.repository.submitBackgroundResult(f.submit);
  assert.equal((await f.repository.submitBackgroundResult({ ...f.submit, receiptId: second, result: { ...f.submit.result, provider_checkpoint_id: crypto.randomUUID() } })).outcome, "stale");
  assert.equal(await f.parent(), f.next);
});

test("failed background result is recorded idempotently without advancing native cursor", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  const input = { ...f.submit, result: { protocol_version: 4 as const, prepare_id: f.prepare.sourcePrepareId, request_id: f.source.command.request_id, conversation_id: f.conversation.id, status: "failure" as const, error_code: "CLAUDE_PROCESS_FAILED" as const } };
  assert.deepEqual(await f.repository.submitBackgroundResult(input), { outcome: "failed", duplicate: false, providerCheckpointId: null });
  assert.deepEqual(await f.repository.submitBackgroundResult(input), { outcome: "failed", duplicate: true, providerCheckpointId: null });
  assert.equal(await f.parent(), f.base);
});

test("wrong session, cwd, attachment or source identity cannot be committed", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  for (const patch of [{ provider_session_id: "wrong" }, { effective_working_directory: "/wrong" }, { prepare_id: crypto.randomUUID() }, { output_attachment_ids: [crypto.randomUUID()] }]) await assert.rejects(f.repository.submitBackgroundResult({ ...f.submit, result: { ...f.submit.result, ...patch } }));
  assert.equal((await f.repository.submitBackgroundResult(f.submit)).outcome, "committed");
});

test("authenticated HTTP background preparation and submission return the durable independent receipt", { skip: !enabled }, async t => {
  const f = await fixture(t);
  const { withServer } = await import("./helpers/native-live-http-relay-fixtures.js");
  const { createNativeLiveRelayInternalRouter } = await import("../src/web-api/native-live-relay-internal-router.js");
  const { NativeLiveBackendRelayService } = await import("../src/domains/bridge/relay/native-live-backend-relay.js");
  const notifications: Array<{ userId: string; kind: string; prepareId: string }> = [];
  const service = new NativeLiveBackendRelayService(f.repository, f.coordinator, {
    async notify(input) { if (input.kind === "turn_terminal") notifications.push(input); },
  });
  await withServer(app => {
    app.use((request, _response, next) => { request.mcpUserId = f.user.id; next(); });
    app.use("/relay", createNativeLiveRelayInternalRouter({ relayService: service }));
  }, async baseUrl => {
    const prepare = await fetch(`${baseUrl}/relay/reservations/${f.prepare.sourcePrepareId}/background-results/prepare`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt_id: f.prepare.receiptId, listener_instance_id: f.prepare.listenerInstanceId, generation_id: f.prepare.generationId, parent_provider_checkpoint_id: f.base }),
    });
    assert.equal(prepare.status, 200); assert.equal((await prepare.json() as { data: { receiptId: string } }).data.receiptId, f.prepare.receiptId);
    const url = `${baseUrl}/relay/reservations/${f.prepare.sourcePrepareId}/background-results/${f.prepare.receiptId}/result`;
    const body = JSON.stringify({ listener_instance_id: f.submit.listenerInstanceId, generation_id: f.submit.generationId, result: f.submit.result });
    const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(first.status, 200); assert.deepEqual((await first.json() as { data: unknown }).data, { outcome: "committed", duplicate: false, providerCheckpointId: f.next });
    const retry = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(retry.status, 200); assert.deepEqual((await retry.json() as { data: unknown }).data, { outcome: "committed", duplicate: true, providerCheckpointId: f.next });
  });
  assert.deepEqual(notifications, [{
    userId: f.user.id, kind: "turn_terminal", prepareId: f.prepare.sourcePrepareId,
  }], "iOS head long-poll wakes only on the first canonical commit, not an idempotent retry");
});


test("temporary iOS wake notification failure does not undo a committed ordinary background message", { skip: !enabled }, async t => {
  const f=await fixture(t);
  const { NativeLiveBackendRelayService } = await import("../src/domains/bridge/relay/native-live-backend-relay.js");
  const service=new NativeLiveBackendRelayService(f.repository,f.coordinator,{
    async notify() { throw new Error("notification transport temporarily unavailable"); },
  });
  await service.prepareBackgroundResult(f.prepare);
  const ack=await service.submitBackgroundResult(f.submit);
  assert.deepEqual(ack,{outcome:"committed",duplicate:false,providerCheckpointId:f.next});
  assert.equal((await f.canonical.getConversation({
    userId:f.user.id,conversationId:f.conversation.id,
  }))!.currentHeadMessageId,f.prepare.receiptId);
});

test("a prepared receipt expires closed, while committed receipt retries preserve their original outcome", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  await f.database.db.execute(sql`UPDATE native_live_runtime_events SET payload=jsonb_set(payload,'{expiresAt}','"2000-01-01T00:00:00.000Z"'::jsonb) WHERE id=${f.prepare.receiptId}::uuid`);
  assert.equal((await f.repository.submitBackgroundResult(f.submit)).outcome, "stale");
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit), { outcome: "stale", duplicate: true, providerCheckpointId: null });
  assert.equal(await f.parent(), f.base);
});

test("retrying an expired prepared receipt renews only with unchanged lease, source and head", { skip: !enabled }, async t => {
  const f=await fixture(t);
  await f.repository.prepareBackgroundResult(f.prepare);
  await f.database.db.execute(sql`
    UPDATE native_live_runtime_events
    SET payload=jsonb_set(payload,'{expiresAt}','"2000-01-01T00:00:00.000Z"'::jsonb)
    WHERE user_id=${f.user.id}::uuid AND id=${f.prepare.receiptId}::uuid
  `);
  const renewed=await f.repository.prepareBackgroundResult(f.prepare);
  assert.ok(new Date(renewed.expiresAt).getTime()>Date.now(),
    "original durable receipt gains a new bounded transport deadline without regenerating provider output");
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit),
    {outcome:"committed",duplicate:false,providerCheckpointId:f.next});
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit),
    {outcome:"committed",duplicate:true,providerCheckpointId:f.next});
});

test("expired prepared receipt cannot be renewed after the owner lease expires", { skip: !enabled }, async t => {
  const f=await fixture(t);
  await f.repository.prepareBackgroundResult(f.prepare);
  await f.database.db.execute(sql`
    UPDATE native_live_runtime_events
    SET payload=jsonb_set(payload,'{expiresAt}','"2000-01-01T00:00:00.000Z"'::jsonb)
    WHERE user_id=${f.user.id}::uuid AND id=${f.prepare.receiptId}::uuid
  `);
  await f.database.db.update(nativeLiveRuntimeListenerLeases).set({
    leaseExpiresAt:new Date(0),
  }).where(eq(nativeLiveRuntimeListenerLeases.userId,f.user.id));
  await assert.rejects(f.repository.prepareBackgroundResult(f.prepare),{code:"BACKGROUND_CONFLICT"});
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit),
    {outcome:"stale",duplicate:false,providerCheckpointId:null});
});

test("terminal receipt remains idempotent after head and lease changes without rewriting cursor", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare); await f.repository.submitBackgroundResult(f.submit);
  await f.parent(); await f.database.db.update(nativeLiveRuntimeListenerLeases).set({ leaseExpiresAt: new Date(0) }).where(eq(nativeLiveRuntimeListenerLeases.userId, f.user.id));
  const before = await f.database.db.select().from(conversationProviderSessionCheckpoints).where(eq(conversationProviderSessionCheckpoints.conversationId, f.conversation.id));
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit), { outcome: "committed", duplicate: true, providerCheckpointId: f.next });
  assert.deepEqual(await f.database.db.select().from(conversationProviderSessionCheckpoints).where(eq(conversationProviderSessionCheckpoints.conversationId, f.conversation.id)), before);
});

test("a source without server generation evidence cannot acquire a new background receipt", { skip: !enabled }, async t => {
  const f = await fixture(t);
  await f.database.db.execute(sql`UPDATE conversation_provider_session_checkpoints SET runtime_metadata=runtime_metadata-'native_live_generation' WHERE conversation_id=${f.conversation.id}::uuid`);
  await assert.rejects(f.repository.prepareBackgroundResult(f.prepare), { code: "BACKGROUND_CONFLICT" });
  assert.equal((await f.database.db.select().from(nativeLiveRuntimeEvents).where(eq(nativeLiveRuntimeEvents.id, f.prepare.receiptId))).length, 0);
});

// Observe a real PostgreSQL lock boundary instead of assuming a timer overlaps
// the commit transaction. Each connection is named only for this synthetic test.
for (const competitor of ["lease takeover", "head rotation", "second receipt"] as const) test(`background commit fences overlapping ${competitor}`, { skip: !enabled }, async t => {
  const f = await fixture(t); await f.repository.prepareBackgroundResult(f.prepare);
  const otherReceipt = crypto.randomUUID(), otherCheckpoint = crypto.randomUUID();
  if (competitor === "second receipt") await f.repository.prepareBackgroundResult({ ...f.prepare, receiptId: otherReceipt });
  const { default: postgres } = await import("postgres");
  const prefix = `bg-${crypto.randomUUID()}`;
  const named = (suffix: string) => createDatabase(process.env.DATABASE_URL!, {
    createClient: url => postgres(url, { max: 1, ssl: false, prepare: false, connection: { application_name: `${prefix}-${suffix}` } }),
  });
  const committing = named("commit"), competing = named("compete");
  t.after(async () => { await committing.close(); await competing.close(); });
  let release!: () => void, locked!: () => void;
  const releaseGate = new Promise<void>(resolve => { release = resolve; });
  const lockedGate = new Promise<void>(resolve => { locked = resolve; });
  const blocker = f.database.db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM conversation_provider_session_checkpoints WHERE conversation_id=${f.conversation.id}::uuid FOR UPDATE`);
    locked(); await releaseGate;
  });
  const waitForLock = async (suffix: string) => {
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      const rows = await f.database.db.execute(sql`SELECT 1 FROM pg_stat_activity WHERE application_name=${`${prefix}-${suffix}`} AND wait_event_type='Lock'`);
      if (rows.length) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`expected ${suffix} to reach an observable database lock`);
  };
  let commit: Promise<unknown> | undefined, competingWork: Promise<unknown> | undefined;
  try {
    await lockedGate;
    commit = new DrizzleNativeLiveBackendRelayRepository(committing.db).submitBackgroundResult(f.submit);
    await waitForLock("commit");
    competingWork = competitor === "lease takeover"
      ? competing.db.update(nativeLiveRuntimeListenerLeases).set({ listenerInstanceId: crypto.randomUUID() }).where(eq(nativeLiveRuntimeListenerLeases.userId, f.user.id)).execute()
      : competitor === "head rotation"
        ? competing.db.update(conversations).set({ currentHeadMessageId: null }).where(eq(conversations.id, f.conversation.id)).execute()
        : new DrizzleNativeLiveBackendRelayRepository(competing.db).submitBackgroundResult({ ...f.submit, receiptId: otherReceipt, result: { ...f.submit.result, provider_checkpoint_id: otherCheckpoint } });
    await waitForLock("compete");
    release(); await blocker;
    assert.deepEqual(await commit, { outcome: "committed", duplicate: false, providerCheckpointId: f.next });
    const other = await competingWork;
    if (competitor === "second receipt") assert.deepEqual(other, { outcome: "stale", duplicate: false, providerCheckpointId: null });
    // A visible B is a durable canonical assistant with its OWN checkpoint,
    // not a resume_tail mutation on H's provider checkpoint. All competitors
    // must preserve that completed receipt even when the subsequent head or
    // listener lease is rotated.
    const [message] = await f.database.db.select({
      id: conversationMessages.id, parent: conversationMessages.parentMessageId,
      role: conversationMessages.role,
    }).from(conversationMessages).where(eq(conversationMessages.id, f.prepare.receiptId));
    assert.equal(message?.id, f.prepare.receiptId);
    assert.equal(message?.role, "assistant");
    assert.equal(message?.parent, f.completed.assistantMessageId);
    const [cp] = await f.database.db.select().from(conversationProviderSessionCheckpoints)
      .where(eq(conversationProviderSessionCheckpoints.canonicalMessageId, f.prepare.receiptId));
    assert.ok(cp, "committed B must retain its own durable checkpoint through competing mutations");
    assert.equal(cp.providerCheckpointId, f.next);
    assert.equal((cp.runtimeMetadata?.native_live_background_receipt as { phase?: string } | undefined)?.phase, "committed");
    const [head] = await f.database.db.select({ head: conversations.currentHeadMessageId })
      .from(conversations).where(eq(conversations.id, f.conversation.id));
    assert.equal(head?.head, competitor === "head rotation" ? null : f.prepare.receiptId,
      "only an explicitly later head rotation may move the canonical head away from B");
    if (competitor === "second receipt") {
      const [otherMessage] = await f.database.db.select({ id: conversationMessages.id })
        .from(conversationMessages).where(eq(conversationMessages.id, otherReceipt));
      assert.equal(otherMessage, undefined, "a stale sibling B cannot create another canonical message");
    }
    assert.deepEqual(await f.repository.submitBackgroundResult(f.submit), { outcome: "committed", duplicate: true, providerCheckpointId: f.next });
  } finally {
    release(); await blocker;
    await Promise.allSettled([commit, competingWork].filter((value): value is Promise<unknown> => Boolean(value)));
  }
});

// Durable-delivery acceptance: an overlay sourced from operational events cannot
// satisfy these checks. Exercise the real write and current-path readers.
test("pre-start native B queues and later publishes H -> U -> F -> B without reparenting U", { skip: !enabled }, async t => {
  const f=await fixture(t);
  const foreground=await f.coordinator.prepare(f.user.id,{
    dispatch_target:"claude_code",request_id:crypto.randomUUID(),conversation_id:f.conversation.id,
    operation:"send",expected_head_message_id:f.completed.assistantMessageId,text:"accepted foreground U",
  });
  assert.ok(foreground.ok);
  if(!foreground.ok)throw Error("foreground reservation missing");
  const command=foreground.command,deadline=new Date(Date.now()+600_000);
  await f.database.db.update(nativeLiveTurnPreparations).set({
    reservedBy:f.prepare.listenerInstanceId,reservedAt:new Date(),reservationExpiresAt:deadline,
    executionStartedAt:new Date(),dispatchStatus:"executing",
  }).where(eq(nativeLiveTurnPreparations.id,command.prepare_id));
  const originalParent=f.completed.assistantMessageId;
  const userId=command.canonical_user_message_id!;
  const parent=async()=>{
    const [user]=await f.database.db.select({parent:conversationMessages.parentMessageId})
      .from(conversationMessages).where(eq(conversationMessages.id,userId));
    return user?.parent;
  };
  assert.equal(await parent(),originalParent);
  const binding={
    userId:f.user.id,listenerInstanceId:f.prepare.listenerInstanceId,reservationId:command.prepare_id,
    requestId:command.request_id,conversationId:f.conversation.id,runtimeMode:"resume" as const,
    canonicalUserMessageId:userId,parentProviderSessionId:command.parent_provider_session_id,
    parentProviderCheckpointId:command.parent_provider_checkpoint_id,
  };
  assert.equal((await f.repository.bindInput({...binding,phase:"queued"}))?.parentProviderCheckpointId,f.base);
  const prestart={...f.prepare,executionStart:true as const,deferred:true as const};
  await f.repository.prepareBackgroundResult(prestart);
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit),{
    outcome:"queued",duplicate:false,providerCheckpointId:null,
  });
  assert.equal((await f.canonical.getConversation({
    userId:f.user.id,conversationId:f.conversation.id,
  }))!.currentHeadMessageId,originalParent,
  "B cannot become canonical before accepted U/F");
  const started=await f.repository.bindInput({...binding,phase:"started"});
  assert.equal(started?.parentProviderCheckpointId,f.next,
    "native F must resume the queued B producer checkpoint, not stale canonical H");
  assert.equal(await f.repository.checkExecutionAdmission({
    ...binding,parentProviderCheckpointId:f.next,
  }),true,"started F tools must be admitted against B's durable producer cursor");
  assert.equal(await f.repository.renewExecutionLease({
    ...binding,parentProviderCheckpointId:f.next,
  }),true,"lease renewal must follow F's started native cursor without rewriting U");
  assert.equal(await f.repository.checkExecutionAdmission(binding),false,
    "F's old prepared checkpoint is no longer authorized once native B has advanced");
  assert.equal(await parent(),originalParent,"accepted U's parent is immutable");
  const covering=crypto.randomUUID();
  const finished=await f.coordinator.finalize(f.user.id,{
    protocol_version:4,prepare_id:command.prepare_id,request_id:command.request_id,
    conversation_id:f.conversation.id,status:"success",provider_session_id:"synthetic-session",
    provider_checkpoint_id:covering,effective_working_directory:"/synthetic",
    normalized_events:[{type:"text",payload:{text:"foreground F"}}],
  });
  assert.ok(finished.ok&&finished.outcome==="completed");
  if(!finished.ok||finished.outcome!=="completed")throw Error("foreground did not commit");
  assert.equal(await parent(),originalParent);
  await f.repository.markCompleted({userId:f.user.id,
    listenerInstanceId:f.prepare.listenerInstanceId,reservationId:command.prepare_id});
  assert.deepEqual(await f.repository.submitBackgroundResult({...f.submit,coveringCheckpointId:covering}),{
    outcome:"committed",duplicate:false,providerCheckpointId:covering,
  });
  const snapshot=(await new DrizzleNativeLiveCurrentPathReader(f.database.db).readCurrentPath({
    userId:f.user.id,conversationId:f.conversation.id,limit:100,
  }))!;
  assert.deepEqual(snapshot.messages.map(x=>x.id),[
    f.source.command.canonical_user_message_id!,originalParent,userId,finished.assistantMessageId,f.prepare.receiptId,
  ]);
  assert.equal(snapshot.messages.at(-1)!.parentMessageId,finished.assistantMessageId);
  assert.equal((await f.canonical.getProviderCheckpointForHead({
    userId:f.user.id,conversationId:f.conversation.id,canonicalMessageId:f.prepare.receiptId,
  }))!.providerCheckpointId,covering);
  assert.equal(await parent(),originalParent);
});

test("started foreground commits before queued autonomous output, with F covering B's earlier producer checkpoint", { skip: !enabled }, async t => {
  const f = await fixture(t);
  // Canonical source H is finalized. Stage U/F on the same native session and
  // bind the exact native input start rather than fabricating source ownership.
  const foreground = await f.coordinator.prepare(f.user.id, {
    dispatch_target: "claude_code", request_id: crypto.randomUUID(), conversation_id: f.conversation.id,
    operation: "send", expected_head_message_id: f.completed.assistantMessageId, text: "foreground while timer runs",
  });
  assert.ok(foreground.ok);
  if (!foreground.ok) throw Error("foreground reservation unavailable");
  const command = foreground.command, deadline = new Date(Date.now() + 600_000);
  await f.database.db.update(nativeLiveTurnPreparations).set({
    reservedBy: f.prepare.listenerInstanceId, reservedAt: new Date(), reservationExpiresAt: deadline,
    executionStartedAt: new Date(), dispatchStatus: "executing",
  }).where(eq(nativeLiveTurnPreparations.id, command.prepare_id));
  const binding = {
    userId: f.user.id, listenerInstanceId: f.prepare.listenerInstanceId, reservationId: command.prepare_id,
    requestId: command.request_id, conversationId: f.conversation.id,
    runtimeMode: "resume" as const, canonicalUserMessageId: command.canonical_user_message_id,
    parentProviderSessionId: command.parent_provider_session_id,
    parentProviderCheckpointId: command.parent_provider_checkpoint_id,
  };
  assert.ok((await f.repository.bindInput({ ...binding, phase: "queued" }))?.userMessageId);
  assert.ok((await f.repository.bindInput({ ...binding, phase: "started" }))?.userMessageId);
  const background = { ...f.prepare, deferred: true as const };
  await f.repository.prepareBackgroundResult(background);
  const queued = await f.repository.submitBackgroundResult(f.submit);
  assert.deepEqual(queued, { outcome: "queued", duplicate: false, providerCheckpointId: null });
  const secondReceiptId = crypto.randomUUID(), secondProducer = crypto.randomUUID();
  const secondPrepare = { ...background, receiptId: secondReceiptId, parentProviderCheckpointId: f.next };
  await f.repository.prepareBackgroundResult(secondPrepare);
  const secondSubmit = { ...f.submit, receiptId: secondReceiptId, result: {
    ...f.submit.result, provider_checkpoint_id: secondProducer,
    normalized_events: [{ type: "text" as const, payload: { text: "second deferred background" } }],
  } };
  assert.deepEqual(await f.repository.submitBackgroundResult(secondSubmit),
    { outcome: "queued", duplicate: false, providerCheckpointId: null });
  const quietId = crypto.randomUUID(), quietProducer = crypto.randomUUID();
  const quietPrepare = { ...background, receiptId: quietId, parentProviderCheckpointId: secondProducer };
  await f.repository.prepareBackgroundResult(quietPrepare);
  const quietSubmit = { ...f.submit, receiptId: quietId, result: {
    ...f.submit.result, provider_checkpoint_id: quietProducer, normalized_events: [],
  } };
  assert.deepEqual(await f.repository.submitBackgroundResult(quietSubmit),
    { outcome: "queued", duplicate: false, providerCheckpointId: null });
  assert.equal((await f.canonical.getConversation({userId:f.user.id,conversationId:f.conversation.id}))!.currentHeadMessageId,
    f.completed.assistantMessageId, "queued does not advance the canonical head");
  const covering = crypto.randomUUID();
  assert.deepEqual(await f.repository.submitBackgroundResult({ ...f.submit, coveringCheckpointId: covering }),
    { outcome: "queued", duplicate: true, providerCheckpointId: null },
    "a proposed covering cursor cannot publish before F becomes canonical");
  const finished = await f.coordinator.finalize(f.user.id, {
    protocol_version: 4, prepare_id: command.prepare_id, request_id: command.request_id,
    conversation_id: f.conversation.id, status: "success", provider_session_id: "synthetic-session",
    provider_checkpoint_id: covering, effective_working_directory: "/synthetic",
    normalized_events: [{ type: "text", payload: { text: "foreground reply" } }],
  });
  assert.ok(finished.ok && finished.outcome === "completed");
  if (!finished.ok || finished.outcome !== "completed") throw Error("foreground completion unavailable");
  await f.repository.markCompleted({ userId: f.user.id,
    listenerInstanceId: f.prepare.listenerInstanceId, reservationId: command.prepare_id });
  assert.deepEqual(await f.repository.submitBackgroundResult({
    ...f.submit, coveringCheckpointId: crypto.randomUUID(),
  }), { outcome: "queued", duplicate: true, providerCheckpointId: null },
  "wrong covering checkpoint cannot be used to advance history");
  assert.deepEqual(await f.repository.submitBackgroundResult({ ...secondSubmit, coveringCheckpointId: covering }),
    { outcome: "queued", duplicate: true, providerCheckpointId: null },
    "B2 must not appear before its native predecessor B1 even if the network reorders publishes");
  const published = await f.repository.submitBackgroundResult({
    ...f.submit, coveringCheckpointId: covering,
  });
  assert.deepEqual(published, { outcome: "committed", duplicate: false, providerCheckpointId: covering });
  assert.deepEqual(await f.repository.submitBackgroundResult({ ...secondSubmit, coveringCheckpointId: covering }),
    { outcome: "committed", duplicate: false, providerCheckpointId: covering });
  const reader = new DrizzleNativeLiveCurrentPathReader(f.database.db);
  const snapshot = (await reader.readCurrentPath({userId:f.user.id,conversationId:f.conversation.id,limit:100}))!;
  assert.equal(snapshot.messages.length,6);
  assert.equal(snapshot.messages.at(-3)!.id, finished.assistantMessageId);
  assert.equal(snapshot.messages.at(-2)!.id, f.prepare.receiptId);
  assert.equal(snapshot.messages.at(-2)!.parentMessageId, finished.assistantMessageId);
  assert.equal(snapshot.messages.at(-1)!.id, secondReceiptId);
  assert.equal(snapshot.messages.at(-1)!.parentMessageId, f.prepare.receiptId);
  assert.equal(snapshot.currentHeadMessageId, secondReceiptId);
  const cp = await f.canonical.getProviderCheckpointForHead({
    userId:f.user.id,conversationId:f.conversation.id,canonicalMessageId:secondReceiptId,
  });
  assert.equal(cp!.providerCheckpointId, covering, "queued producer B never rolls the head back from F");
  assert.equal(cp!.runtimeMetadata?.native_live_background_producer_checkpoint_id, secondProducer);
  assert.deepEqual(await f.repository.submitBackgroundResult({ ...f.submit, coveringCheckpointId: covering }),
    { outcome: "committed", duplicate: true, providerCheckpointId: covering });
  assert.deepEqual(await f.repository.submitBackgroundResult({ ...secondSubmit, coveringCheckpointId: covering }),
    { outcome: "committed", duplicate: true, providerCheckpointId: covering });
  assert.equal((await f.repository.prepareBackgroundResult(secondPrepare)).parentProviderCheckpointId,
    f.next,"lost-ACK replay retains B2's original B1 parent, not the later F covering checkpoint");
  assert.deepEqual(await f.repository.submitBackgroundResult({ ...quietSubmit, coveringCheckpointId: covering }),
    { outcome: "committed", duplicate: false, providerCheckpointId: covering },
    "quiet provider activity is already covered by F and needs no empty bubble");
  assert.deepEqual(await f.repository.submitBackgroundResult({ ...quietSubmit, coveringCheckpointId: covering }),
    { outcome: "committed", duplicate: true, providerCheckpointId: covering },
    "retrying the quiet receipt cannot add a second provider turn");
  const afterQuiet = (await new DrizzleNativeLiveCurrentPathReader(f.database.db).readCurrentPath({
    userId:f.user.id,conversationId:f.conversation.id,limit:100,
  }))!;
  assert.deepEqual(afterQuiet.messages.map(x=>x.id),snapshot.messages.map(x=>x.id),
    "quiet native continuation must not appear as an empty ordinary chat bubble");

});

test("background reply is a permanent latest canonical message and next send inherits it", { skip: !enabled }, async t => {
  const f = await fixture(t);
  await f.repository.prepareBackgroundResult(f.prepare);
  assert.equal((await f.repository.submitBackgroundResult(f.submit)).outcome, "committed");
  const reader = new DrizzleNativeLiveCurrentPathReader(f.database.db);
  const read = () => reader.readCurrentPath({ userId: f.user.id, conversationId: f.conversation.id, limit: 100 });
  const snapshot = (await read())!;
  assert.equal(snapshot.messages.length, 3, "background output must be a real message, not a display overlay");
  const reply = snapshot.messages.at(-1)!;
  assert.equal(reply.role, "assistant");
  assert.equal(reply.parentMessageId, f.completed.assistantMessageId);
  assert.equal(snapshot.currentHeadMessageId, reply.id);
  assert.equal(reply.blocks.filter(b => b.kind === "text").map(b => b.text).join(""), "background synthetic");
  const nextSend = await f.coordinator.prepare(f.user.id, { dispatch_target: "claude_code", request_id: crypto.randomUUID(), conversation_id: f.conversation.id,
    operation: "send", expected_head_message_id: reply.id, text: "next synthetic" });
  assert.ok(nextSend.ok);
  if (!nextSend.ok) throw Error("next send failed");
  assert.equal(nextSend.command.parent_provider_checkpoint_id, f.next);
  // Operational retention is allowed to remove old preparations/events. Actual
  // chat history and its continuation checkpoint must be independent of them.
  await f.database.db.delete(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, f.prepare.sourcePrepareId));
  assert.deepEqual((await read())!.messages.map(m => [m.id, m.blocks]), snapshot.messages.map(m => [m.id, m.blocks]));
  assert.deepEqual(await f.repository.submitBackgroundResult(f.submit), { outcome: "committed", duplicate: true, providerCheckpointId: f.next });
});

test("consecutive autonomous replies advance durable history in commit order", { skip: !enabled }, async t => {
  const f = await fixture(t);
  await f.repository.prepareBackgroundResult(f.prepare);
  await f.repository.submitBackgroundResult(f.submit);
  const secondId = crypto.randomUUID(), secondCheckpoint = crypto.randomUUID();
  await f.repository.prepareBackgroundResult({ ...f.prepare, receiptId: secondId, parentProviderCheckpointId: f.next });
  const second = { ...f.submit, receiptId: secondId, result: { ...f.submit.result, provider_checkpoint_id: secondCheckpoint,
    normalized_events: [{ type: "text", payload: { text: "second background synthetic" } }] } };
  assert.equal((await f.repository.submitBackgroundResult(second)).outcome, "committed");
  const snapshot = (await new DrizzleNativeLiveCurrentPathReader(f.database.db).readCurrentPath({ userId: f.user.id, conversationId: f.conversation.id, limit: 100 }))!;
  assert.equal(snapshot.messages.length, 4);
  assert.equal(snapshot.messages.at(-1)!.parentMessageId, snapshot.messages.at(-2)!.id);
  assert.equal(snapshot.currentHeadMessageId, snapshot.messages.at(-1)!.id);
});
