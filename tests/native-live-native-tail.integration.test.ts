import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { rotateNativeWriterGeneration } from "../src/domains/bridge/turn/turn-repository/session-owner.js";
import { DrizzleNativeLiveBackendRelayRepository } from "../src/domains/bridge/relay/native-live-backend-relay.js";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, nativeLiveTurnPreparations, nativeLiveRuntimeListenerLeases } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { NativeLiveSilenceWakeService, silenceWakePreparationId } from "../src/domains/bridge/turn/native-live-silence-wake.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";

const enabled = process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST === "1";
async function fixture(t: test.TestContext) {
  const url = process.env.DATABASE_URL; assert.ok(url);
  const { isolatedPostgresTarget, verifyIsolatedPostgresTarget } = await import("../scripts/isolated-postgres-target.mjs");
  await verifyIsolatedPostgresTarget(isolatedPostgresTarget(url));
  const database = createDatabase(url, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `native-tail-${crypto.randomUUID()}@example.com`, displayName: "Synthetic tail" }).returning();
  t.after(async () => { try { await database.db.delete(nativeLiveRuntimeListenerLeases).where(eq(nativeLiveRuntimeListenerLeases.userId, user.id)); await database.db.delete(conversations).where(eq(conversations.userId, user.id)); await database.db.delete(users).where(eq(users.id, user.id)); } finally { await database.close(); } });
  const repository = new DrizzleNativeLiveConversationRepository(database.db);
  const conversation = await repository.createConversation({ userId: user.id });
  const port = new DrizzleNativeLiveBackendTurnPort(database.db), coordinator = new NativeLiveBackendTurnCoordinator(port);
  const initial = await coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: crypto.randomUUID(), operation: "send", conversation_id: conversation.id, expected_head_message_id: null, text: "synthetic" });
  assert.ok(initial.ok); if (!initial.ok) throw Error("prepare failed");
  const base = crypto.randomUUID(), next = crypto.randomUUID();
  const source = await coordinator.finalize(user.id, { protocol_version: 4, prepare_id: initial.command.prepare_id, request_id: initial.command.request_id, conversation_id: conversation.id, status: "success", provider_session_id: "synthetic-session", provider_checkpoint_id: base, effective_working_directory: "/synthetic", normalized_events: [{ type: "text", payload: { text: "synthetic" } }] });
  assert.ok(source.ok && source.outcome === "completed"); if (!source.ok || source.outcome !== "completed") throw Error("finalize failed");
  let now = new Date(); const silence = new NativeLiveSilenceWakeService(database.db, () => now);
  const schedule = await silence.readSchedule({ userId: user.id }); assert.ok(schedule); now = new Date(schedule.postTurnDueAt);
  assert.equal((await silence.fire({ userId: user.id, epochId: schedule.epochId, slot: "post_turn_idle" })).outcome, "queued");
  const prepareId = silenceWakePreparationId(schedule.epochId, "post_turn_idle");
  await database.db.update(nativeLiveTurnPreparations).set({ runtimeMode: "resume" }).where(eq(nativeLiveTurnPreparations.id, prepareId));
  const wake = await port.getPreparation({ userId: user.id, prepareId }); assert.ok(wake);
  const result = { protocol_version: 4, prepare_id: prepareId, request_id: wake.requestId, conversation_id: conversation.id, status: "success", provider_session_id: "synthetic-session", provider_checkpoint_id: next, effective_working_directory: "/synthetic", normalized_events: [{ type: "text", payload: { text: "<quiet />" } }] };
  const send = () => coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: crypto.randomUUID(), operation: "send", conversation_id: conversation.id, expected_head_message_id: source.assistantMessageId, text: "next synthetic" });
  const visibleCount = async () => (await database.db.select({ count: sql<number>`count(*)::int` }).from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id)))[0]!.count;
  const longWake = async () => {
    now = new Date(schedule.longIdleDueAt);
    assert.equal((await silence.fire({ userId: user.id, epochId: schedule.epochId, slot: "long_idle" })).outcome, "queued");
    const id = silenceWakePreparationId(schedule.epochId, "long_idle");
    await database.db.update(nativeLiveTurnPreparations).set({ runtimeMode: "resume" }).where(eq(nativeLiveTurnPreparations.id, id));
    const second = await port.getPreparation({ userId: user.id, prepareId: id }); assert.ok(second); return second;
  };
  return { database, user, repository, conversation, port, coordinator, source, base, next, wake, result, send, visibleCount, silence, schedule, longWake };
}

test("quiet same-session wake advances resume parent without rewriting canonical checkpoint or creating messages", { skip: !enabled }, async t => {
  const f = await fixture(t); const count = await f.visibleCount();
  const finalized = await f.coordinator.finalize(f.user.id, f.result);
  assert.ok(finalized.ok && finalized.outcome === "wake_quiet");
  assert.equal((finalized as { nativeResumeCheckpointId?: string }).nativeResumeCheckpointId, f.next);
  assert.equal(await f.visibleCount(), count);
  assert.equal((await f.repository.getConversation({ userId: f.user.id, conversationId: f.conversation.id }))!.currentHeadMessageId, f.source.assistantMessageId);
  const original = await f.repository.getProviderCheckpointForHead({ userId: f.user.id, conversationId: f.conversation.id, canonicalMessageId: f.source.assistantMessageId });
  assert.equal(original!.providerCheckpointId, f.base);
  const next = await f.send(); assert.ok(next.ok); if (!next.ok) throw Error("next failed");
  assert.equal(next.command.runtime_mode, "resume"); assert.equal(next.command.parent_provider_checkpoint_id, f.next);
});

for (const stale of ["foreground", "desktop", "checkpoint"] as const) test(`stale ${stale} quiet result cannot advance native resume parent`, { skip: !enabled }, async t => {
  const f = await fixture(t);
  if (stale === "foreground") assert.ok((await f.send()).ok);
  if (stale === "desktop") await f.database.db.execute(sql`UPDATE conversations SET provider_metadata = jsonb_set(provider_metadata, '{nativeSessionSource}', '{"owner":"desktop"}'::jsonb) WHERE id = ${f.conversation.id}::uuid`);
  if (stale === "checkpoint") await f.database.db.update(nativeLiveTurnPreparations).set({ parentProviderCheckpointId: crypto.randomUUID() }).where(eq(nativeLiveTurnPreparations.id, f.wake.prepareId));
  const finalized = await f.coordinator.finalize(f.user.id, f.result);
  assert.ok(finalized.ok); if (!finalized.ok) throw Error("finalize failed");
  assert.equal(finalized.outcome, "wake_stale"); assert.equal((finalized as { nativeResumeCheckpointId?: string }).nativeResumeCheckpointId, undefined);
  const cp = await f.repository.getProviderCheckpointForHead({ userId: f.user.id, conversationId: f.conversation.id, canonicalMessageId: f.source.assistantMessageId });
  assert.equal(cp!.runtimeMetadata?.native_live_resume_tail, undefined);
});

test("duplicate quiet submission never overwrites a later native tail", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.coordinator.finalize(f.user.id, f.result);
  const duplicate = await f.coordinator.finalize(f.user.id, { ...f.result, provider_checkpoint_id: crypto.randomUUID() });
  assert.equal(duplicate.ok, false); // Existing deleted-wake receipt path remains terminal, never replayed.
  const next = await f.send(); assert.ok(next.ok); if (!next.ok) throw Error("next failed");
  assert.equal(next.command.parent_provider_checkpoint_id, f.next);
});

for (const changed of ["owner-generation", "native-revision"] as const) test(`changed ${changed} cannot reactivate an old quiet-tail cursor`, { skip: !enabled }, async t => {
  const f = await fixture(t); await f.coordinator.finalize(f.user.id, f.result);
  if (changed === "owner-generation") await rotateNativeWriterGeneration(f.database.db, {userId:f.user.id,conversationId:f.conversation.id});
  else await f.database.db.execute(sql`UPDATE conversations SET provider_metadata = jsonb_set(provider_metadata, '{nativeSessionSource}', '{"owner":"leileios","revision":"changed"}'::jsonb) WHERE id = ${f.conversation.id}::uuid`);
  const next = await f.send(); assert.ok(next.ok); if (!next.ok) throw Error("next failed");
  assert.equal(next.command.parent_provider_checkpoint_id, f.base);
});


test("successive quiet wakes follow the committed native cursor while preserving the visible head", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.coordinator.finalize(f.user.id, f.result);
  const second = await f.longWake(); assert.equal(second.parentProviderCheckpointId, f.next);
  const tail = crypto.randomUUID();
  const finalized = await f.coordinator.finalize(f.user.id, { ...f.result, prepare_id: second.prepareId, request_id: second.requestId, provider_checkpoint_id: tail });
  assert.ok(finalized.ok && finalized.outcome === "wake_quiet");
  assert.equal((finalized as { nativeResumeCheckpointId?: string }).nativeResumeCheckpointId, tail);
  const next = await f.send(); assert.ok(next.ok); if (!next.ok) throw Error("send failed");
  assert.equal(next.command.parent_provider_checkpoint_id, tail);
});

test("a second wake prepared against the old cursor cannot overwrite a committed continuation", { skip: !enabled }, async t => {
  const f = await fixture(t); const second = await f.longWake(); assert.equal(second.parentProviderCheckpointId, f.base);
  await f.coordinator.finalize(f.user.id, f.result);
  const stale = await f.coordinator.finalize(f.user.id, { ...f.result, prepare_id: second.prepareId, request_id: second.requestId, provider_checkpoint_id: crypto.randomUUID() });
  assert.ok(stale.ok && stale.outcome === "wake_stale");
  const next = await f.send(); assert.ok(next.ok); if (!next.ok) throw Error("send failed");
  assert.equal(next.command.parent_provider_checkpoint_id, f.next);
});

test("next foreground reservation admits its captured cursor after presentation generation rotates", { skip: !enabled }, async t => {
  const f = await fixture(t); await f.coordinator.finalize(f.user.id, f.result);
  const next = await f.send(); assert.ok(next.ok); if (!next.ok) throw Error("send failed");
  const command = next.command, listenerInstanceId = crypto.randomUUID();
  const later = new Date(Date.now() + 60_000);
  await f.database.db.insert(nativeLiveRuntimeListenerLeases).values({ userId: f.user.id, dispatchTarget: "claude_code", listenerInstanceId, leaseExpiresAt: later });
  await f.database.db.update(nativeLiveTurnPreparations).set({ dispatchStatus: "executing", reservedBy: listenerInstanceId, reservedAt: new Date(), reservationExpiresAt: later, executionStartedAt: new Date() }).where(eq(nativeLiveTurnPreparations.id, command.prepare_id));
  // Mirror the existing activation contract; preparation itself creates a detached user.
  await f.database.db.update(conversations).set({ currentHeadMessageId: command.canonical_user_message_id, providerMetadata: { native_live_presentation_owner: { prepareId: command.prepare_id, anchorHeadMessageId: command.canonical_user_message_id } } }).where(eq(conversations.id, f.conversation.id));
  const admission = { userId: f.user.id, listenerInstanceId, reservationId: command.prepare_id, requestId: command.request_id, conversationId: command.conversation_id, runtimeMode: "resume" as const, canonicalUserMessageId: command.canonical_user_message_id, parentProviderSessionId: command.parent_provider_session_id, parentProviderCheckpointId: command.parent_provider_checkpoint_id! };
  const relay = new DrizzleNativeLiveBackendRelayRepository(f.database.db);
  assert.equal(await relay.checkExecutionAdmission(admission), true);
  assert.equal(await relay.checkExecutionAdmission({ ...admission, parentProviderCheckpointId: f.base }), false);
  await f.database.db.update(conversations).set({ providerMetadata: { nativeSessionSource: { owner: "desktop" } } }).where(eq(conversations.id, f.conversation.id));
  assert.equal(await relay.checkExecutionAdmission(admission), false);
});

test("a wake at the old base loses execution admission as soon as another quiet wake advances the tail", { skip: !enabled }, async t => {
  const f = await fixture(t), second = await f.longWake();
  const listenerInstanceId = crypto.randomUUID(), later = new Date(Date.now() + 60_000);
  await f.database.db.insert(nativeLiveRuntimeListenerLeases).values({ userId: f.user.id, dispatchTarget: "claude_code", listenerInstanceId, leaseExpiresAt: later });
  await f.database.db.update(nativeLiveTurnPreparations).set({ dispatchStatus: "executing", reservedBy: listenerInstanceId, reservedAt: new Date(), reservationExpiresAt: later, executionStartedAt: new Date() }).where(eq(nativeLiveTurnPreparations.id, second.prepareId));
  const relay = new DrizzleNativeLiveBackendRelayRepository(f.database.db);
  const admission = { userId: f.user.id, listenerInstanceId, reservationId: second.prepareId, requestId: second.requestId, conversationId: f.conversation.id, runtimeMode: "resume" as const, canonicalUserMessageId: null, parentProviderSessionId: second.parentProviderSessionId, parentProviderCheckpointId: second.parentProviderCheckpointId! };
  assert.equal(await relay.checkExecutionAdmission(admission), true);
  await f.coordinator.finalize(f.user.id, f.result);
  assert.equal(await relay.checkExecutionAdmission(admission), false);
});

for (const changed of ["owner-generation", "native-revision"] as const) test(`quiet result cannot adopt a ${changed} changed after preparation`, { skip: !enabled }, async t => {
  const f = await fixture(t);
  if (changed === "owner-generation") await rotateNativeWriterGeneration(f.database.db, {userId:f.user.id,conversationId:f.conversation.id});
  else await f.database.db.execute(sql`UPDATE conversations SET provider_metadata = jsonb_set(provider_metadata, '{nativeSessionSource}', '{"owner":"leileios","revision":"changed"}'::jsonb) WHERE id = ${f.conversation.id}::uuid`);
  const finalized = await f.coordinator.finalize(f.user.id, f.result);
  assert.ok(finalized.ok && finalized.outcome === "wake_stale");
});

test("quiet native tail survives superseded unstarted prepares", { skip: !enabled }, async t => {
  const f=await fixture(t);
  assert.ok((await f.coordinator.finalize(f.user.id,f.result)).ok);
  const first=await f.send();assert.ok(first.ok);if(!first.ok)throw Error("first prepare failed");
  assert.equal(first.command.parent_provider_checkpoint_id,f.next);
  const second=await f.send();assert.ok(second.ok);if(!second.ok)throw Error("second prepare failed");
  assert.equal(second.command.parent_provider_checkpoint_id,f.next,"turn slot replacement must not hide the native tail");
});

test("same-epoch Wake admits and finalizes after an unstarted retry only changed the slot", { skip: !enabled }, async t => {
  const f=await fixture(t), listener=crypto.randomUUID(), later=new Date(Date.now()+600000);
  const sourceUser=f.wake.wakeContext!.source_user_message_id as string;
  const retry=await f.coordinator.prepare(f.user.id,{dispatch_target:"claude_code",request_id:crypto.randomUUID(),
    conversation_id:f.conversation.id,operation:"retry",target_user_message_id:sourceUser});
  assert.ok(retry.ok);if(!retry.ok)throw Error("retry failed");
  await f.database.db.insert(nativeLiveRuntimeListenerLeases).values({userId:f.user.id,dispatchTarget:"claude_code",listenerInstanceId:listener,leaseExpiresAt:later});
  await f.database.db.update(nativeLiveTurnPreparations).set({dispatchStatus:"executing",reservedBy:listener,reservedAt:new Date(),executionStartedAt:new Date(),reservationExpiresAt:later})
    .where(eq(nativeLiveTurnPreparations.id,retry.command.prepare_id));
  const relay=new DrizzleNativeLiveBackendRelayRepository(f.database.db);
  assert.equal(await relay.rejectReservation({userId:f.user.id,listenerInstanceId:listener,reservationId:retry.command.prepare_id,code:"INVALID_COMMAND"}),"applied");
  await f.database.db.update(nativeLiveTurnPreparations).set({dispatchStatus:"executing",reservedBy:listener,reservedAt:new Date(),executionStartedAt:new Date(),reservationExpiresAt:later})
    .where(eq(nativeLiveTurnPreparations.id,f.wake.prepareId));
  const admission={userId:f.user.id,listenerInstanceId:listener,reservationId:f.wake.prepareId,requestId:f.wake.requestId,
    conversationId:f.conversation.id,runtimeMode:"resume" as const,canonicalUserMessageId:null,
    parentProviderSessionId:f.wake.parentProviderSessionId,parentProviderCheckpointId:f.wake.parentProviderCheckpointId!};
  assert.equal(await relay.checkExecutionAdmission(admission),true,"same line and same user epoch survive a slot-only change");
  const completed=await f.coordinator.finalize(f.user.id,{...f.result,normalized_events:[{type:"text",payload:{text:"synthetic visible Wake"}}]});
  assert.ok(completed.ok && completed.outcome==="completed",JSON.stringify(completed));
});

for (const valid of [true,false]) test(`legacy native tail ${valid ? "retains a backfilled" : "rejects a mismatched"} writer generation`, {skip:!enabled}, async t=>{
  const f=await fixture(t);await f.coordinator.finalize(f.user.id,f.result);
  const [stamp]=await f.database.db.execute<{owner:string}>(sql`SELECT
    runtime_metadata->'native_live_resume_tail'->>'presentation_owner_id' AS owner
    FROM conversation_provider_session_checkpoints WHERE user_id=${f.user.id}::uuid AND canonical_message_id=${f.source.assistantMessageId}::uuid`);
  await f.database.db.execute(sql`UPDATE conversation_provider_session_checkpoints
    SET runtime_metadata=runtime_metadata #- '{native_live_resume_tail,writer_generation}'
    WHERE user_id=${f.user.id}::uuid AND canonical_message_id=${f.source.assistantMessageId}::uuid`);
  await f.database.db.execute(sql`UPDATE native_live_session_owners SET writer_generation=${valid?stamp.owner:crypto.randomUUID()}::uuid
    WHERE user_id=${f.user.id}::uuid AND conversation_id=${f.conversation.id}::uuid`);
  const next=await f.send();assert.ok(next.ok);if(!next.ok)throw Error("send failed");
  assert.equal(next.command.parent_provider_checkpoint_id,valid?f.next:f.base);
});
