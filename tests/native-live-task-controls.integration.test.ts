import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, nativeLiveTurnPreparations, nativeLiveRuntimeEvents, nativeLiveRuntimeListenerLeases, conversationProviderSessionCheckpoints } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveBackendRelayRepository } from "../src/domains/bridge/relay/native-live-backend-relay.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";

import { DrizzleNativeLiveRuntimeControlRepository } from "../src/domains/bridge/runtime-interaction/native-live-runtime-control.js";
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
    const prepared = await coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: crypto.randomUUID(), conversation_id: conversation.id, operation: "send", expected_head_message_id: completed.assistantMessageId, text: "next synthetic" });
    assert.ok(prepared.ok); if (!prepared.ok) throw Error("send failed"); return prepared.command.parent_provider_checkpoint_id;
  };
  return { database, user, canonical, coordinator, conversation, repository, source, completed, base, next, prepare, submit, parent };
}

const request = (f: Awaited<ReturnType<typeof fixture>>, action = "list") => ({ userId: f.user.id, prepareId: f.prepare.sourcePrepareId, controlId: crypto.randomUUID(), kind: "task" as const, payload: { action } });
test("completed source accepts a task control exactly once and legacy turn pump cannot consume it", { skip: !enabled }, async t => {
  const f = await fixture(t), repo = new DrizzleNativeLiveRuntimeControlRepository(f.database.db), input = request(f);
  const created = await repo.createForUser(input);
  assert.equal(created.outcome, "created");
  assert.equal((await repo.createForUser(input)).outcome, "idempotent");
  const control = await repo.reserveTaskForListener({ userId: f.user.id, listenerInstanceId: f.prepare.listenerInstanceId, bindings: [{ conversationId: f.conversation.id, providerSessionId: "synthetic-session", generationId: f.prepare.generationId }] });
  assert.equal(control?.controlId, input.controlId);
  assert.equal(control?.payload.providerSessionId, "synthetic-session");
  assert.equal(await repo.reserveTaskForListener({ userId: f.user.id, listenerInstanceId: f.prepare.listenerInstanceId, bindings: [{ conversationId: f.conversation.id, providerSessionId: "synthetic-session", generationId: f.prepare.generationId }] }), null, "reserved commands are never replayed");
  await repo.completeForListener({ userId: f.user.id, listenerInstanceId: f.prepare.listenerInstanceId, reservationId: input.prepareId, controlId: input.controlId, outcome: { status: "applied", receipt: { generationId: f.prepare.generationId, tasks: [] } } });
  assert.equal((await repo.readTaskForUser(input))?.status, "applied");
});
for (const mutation of ["head", "desktop", "expired-listener", "listener-takeover", "continuation-floor", "archived"] as const) test(`task controls reject ${mutation} and hide previously returned output`, { skip: !enabled }, async t => {
  const f = await fixture(t), repo = new DrizzleNativeLiveRuntimeControlRepository(f.database.db), input = request(f);
  await repo.createForUser(input);
  if (mutation === "head") await f.database.db.update(conversations).set({ currentHeadMessageId: null }).where(eq(conversations.id, f.conversation.id));
  else if (mutation === "expired-listener") await f.database.db.update(nativeLiveRuntimeListenerLeases).set({ leaseExpiresAt: new Date(0) }).where(eq(nativeLiveRuntimeListenerLeases.userId, f.user.id));
  else if (mutation === "listener-takeover") await f.database.db.update(nativeLiveRuntimeListenerLeases).set({ listenerInstanceId: crypto.randomUUID() }).where(eq(nativeLiveRuntimeListenerLeases.userId, f.user.id));
  else if (mutation === "archived") await f.database.db.update(conversations).set({ lifecycleStatus: "archived" }).where(eq(conversations.id, f.conversation.id));
  else await f.database.db.execute(mutation === "desktop" ? sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata,'{nativeSessionSource}','{"owner":"desktop"}'::jsonb) WHERE id=${f.conversation.id}::uuid`
    : sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata,'{nativeSessionSource}',jsonb_build_object('owner','leileios','mode','continuation','headMessageId',${f.completed.assistantMessageId}::text)) WHERE id=${f.conversation.id}::uuid`);
  await assert.rejects(repo.createForUser({ ...input, controlId: crypto.randomUUID() }), { code: "TURN_NOT_ACTIVE" });
  await assert.rejects(repo.readTaskForUser(input), { code: "TURN_NOT_ACTIVE" });
  assert.equal(await repo.reserveTaskForListener({ userId: f.user.id, listenerInstanceId: f.prepare.listenerInstanceId, bindings: [{ conversationId: f.conversation.id, providerSessionId: "synthetic-session", generationId: f.prepare.generationId }] }), null);
});
test("task output and stop require exact handles; user/session isolation precedes access", { skip: !enabled }, async t => {
  const f = await fixture(t), repo = new DrizzleNativeLiveRuntimeControlRepository(f.database.db), input = request(f);
  await assert.rejects(repo.createForUser({ ...input, payload: { action: "stop", taskId: "sdk-task" } }), { code: "CONTROL_INVALID" });
  await assert.rejects(repo.createForUser({ ...input, userId: crypto.randomUUID() }), { code: "TURN_NOT_ACTIVE" });
  await repo.createForUser({ ...input, payload: { action: "output", taskId: "sdk-task", handle: "opaque-run", generationId: f.prepare.generationId } });
  assert.equal(await repo.reserveTaskForListener({ userId: f.user.id, listenerInstanceId: f.prepare.listenerInstanceId, bindings: [{ conversationId: f.conversation.id, providerSessionId: "wrong-session", generationId: f.prepare.generationId }] }), null);
  assert.equal(await repo.readTaskForUser({ ...input, userId: crypto.randomUUID() }), null);
});

test("task completion rechecks ownership and cannot publish output after handoff",{skip:!enabled},async t=>{
 const f=await fixture(t),repo=new DrizzleNativeLiveRuntimeControlRepository(f.database.db),input=request(f);
 await repo.createForUser(input);
 await repo.reserveTaskForListener({userId:f.user.id,listenerInstanceId:f.prepare.listenerInstanceId,bindings:[{conversationId:f.conversation.id,providerSessionId:"synthetic-session",generationId:f.prepare.generationId}]});
 await f.database.db.execute(sql`UPDATE conversations SET provider_metadata=jsonb_set(provider_metadata,'{nativeSessionSource}','{"owner":"desktop"}'::jsonb) WHERE id=${f.conversation.id}::uuid`);
 await assert.rejects(repo.completeForListener({userId:f.user.id,listenerInstanceId:f.prepare.listenerInstanceId,reservationId:input.prepareId,controlId:input.controlId,outcome:{status:"applied",receipt:{generationId:f.prepare.generationId,tasks:[]}}}),{code:"TURN_NOT_ACTIVE"});
});

test("same-source concurrent task requests and completions retain exactly one durable receipt",{skip:!enabled},async t=>{
 const f=await fixture(t),repo=new DrizzleNativeLiveRuntimeControlRepository(f.database.db),input=request(f);
 const creates=await Promise.all([repo.createForUser(input),repo.createForUser(input)]);assert.equal(creates.filter(v=>v.outcome==="created").length,1);
 await repo.reserveTaskForListener({userId:f.user.id,listenerInstanceId:f.prepare.listenerInstanceId,bindings:[{conversationId:f.conversation.id,providerSessionId:"synthetic-session",generationId:f.prepare.generationId}]});
 assert.equal((await repo.createForUser(input)).outcome,"idempotent");
 const done={userId:f.user.id,listenerInstanceId:f.prepare.listenerInstanceId,reservationId:input.prepareId,controlId:input.controlId,outcome:{status:"applied" as const,receipt:{generationId:f.prepare.generationId,tasks:[]}}};
 assert.deepEqual((await Promise.all([repo.completeForListener(done),repo.completeForListener(done)])).sort(),["applied","idempotent"]);
});

test("completed source remains usable on the same session after another ordinary turn",{skip:!enabled},async t=>{
 const f=await fixture(t),repo=new DrizzleNativeLiveRuntimeControlRepository(f.database.db);await f.parent();
 assert.equal(await repo.checkTaskAdmission({userId:f.user.id,prepareId:f.prepare.sourcePrepareId,listenerInstanceId:f.prepare.listenerInstanceId,providerSessionId:"synthetic-session"}),true);
 assert.equal((await repo.createForUser(request(f))).outcome,"created");
});

test("task commands cross the authenticated HTTP boundary without creating a Claude turn",{skip:!enabled},async t=>{
 const f=await fixture(t);
 const {NativeLiveRuntimeControlService}=await import("../src/domains/bridge/runtime-interaction/native-live-runtime-control.js");
 const {createNativeLiveApiRouter}=await import("../src/web-api/native-live/router.js");
 const {createNativeLiveRelayInternalRouter}=await import("../src/web-api/native-live-internal/router.js");
 const {withServer,FakeRelayService,FakeTurnReader}=await import("./helpers/native-live-http-relay-fixtures.js");
 const service=new NativeLiveRuntimeControlService(new DrizzleNativeLiveRuntimeControlRepository(f.database.db));
 const relay=new FakeRelayService(),controlId=crypto.randomUUID();
 await withServer(app=>{
  app.use((req,_res,next)=>{if(req.header("x-test-owner")==="yes"){req.webUserId=f.user.id;req.mcpUserId=f.user.id;}next();});
  app.use("/user",createNativeLiveApiRouter({coordinator:f.coordinator,relayService:relay,turnReader:new FakeTurnReader(),runtimeControlService:service}));
  app.use("/internal",createNativeLiveRelayInternalRouter({relayService:relay,runtimeControlService:service}));
 },async base=>{
  const headers={"content-type":"application/json","x-test-owner":"yes"};
  assert.equal((await fetch(`${base}/user/turns/${f.prepare.sourcePrepareId}/task-controls/${controlId}`)).status,401);
  assert.equal((await fetch(`${base}/internal/task-controls/wait`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({listener_instance_id:f.prepare.listenerInstanceId,bindings:[]})})).status,401);
  const before=await f.database.db.select().from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.userId,f.user.id));
  const posted=await fetch(`${base}/user/turns/${f.prepare.sourcePrepareId}/controls`,{method:"POST",headers,body:JSON.stringify({control_id:controlId,kind:"task",payload:{action:"list"}})});assert.equal(posted.status,201);
  const admitted=await fetch(`${base}/internal/reservations/${f.prepare.sourcePrepareId}/task-admission`,{method:"POST",headers,body:JSON.stringify({listener_instance_id:f.prepare.listenerInstanceId,provider_session_id:"synthetic-session"})});assert.equal(admitted.status,200);assert.equal((await admitted.json() as any).data.admitted,true);
  const pending=await fetch(`${base}/internal/task-controls/wait`,{method:"POST",headers,body:JSON.stringify({listener_instance_id:f.prepare.listenerInstanceId,bindings:[{conversationId:f.conversation.id,providerSessionId:"synthetic-session",generationId:f.prepare.generationId}]})});assert.equal(pending.status,200);assert.equal((await pending.json() as any).data.control.controlId,controlId);
  const done=await fetch(`${base}/internal/reservations/${f.prepare.sourcePrepareId}/controls/${controlId}/complete`,{method:"POST",headers,body:JSON.stringify({listener_instance_id:f.prepare.listenerInstanceId,outcome:{status:"applied",receipt:{generationId:f.prepare.generationId,tasks:[]}}})});assert.equal(done.status,200);
  const result=await fetch(`${base}/user/turns/${f.prepare.sourcePrepareId}/task-controls/${controlId}`,{headers});assert.equal(result.status,200);assert.equal((await result.json() as any).data.status,"applied");assert.match(result.headers.get("cache-control")!,/no-store/);
  assert.deepEqual(await f.database.db.select().from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.userId,f.user.id)),before);
 });
});

test("first foreground turn can list and stop background tasks before its assistant result exists",{skip:!enabled},async t=>{
 const f=await fixture(t),repo=new DrizzleNativeLiveRuntimeControlRepository(f.database.db);
 await f.database.db.update(nativeLiveTurnPreparations).set({status:"prepared",dispatchStatus:"executing",assistantMessageId:null,providerSessionId:null,providerCheckpointId:null,resultHash:null,finalizedAt:null}).where(eq(nativeLiveTurnPreparations.id,f.prepare.sourcePrepareId));
 await f.database.db.update(conversations).set({currentHeadMessageId:f.source.command.canonical_user_message_id}).where(eq(conversations.id,f.conversation.id));
 await f.database.db.insert(nativeLiveRuntimeEvents).values({id:crypto.randomUUID(),userId:f.user.id,prepareId:f.prepare.sourcePrepareId,sequence:1,eventType:"session",providerSessionId:"synthetic-session",payload:{}});
 assert.equal((await repo.createForUser(request(f))).outcome,"created");
});
