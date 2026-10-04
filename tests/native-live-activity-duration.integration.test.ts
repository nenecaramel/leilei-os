import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClaudeEvents } from "../tools/claude-bridge/src/normalized-events.mjs";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, nativeLiveTurnPreparations, conversationProviderSessionCheckpoints } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";
import { readNativeLiveMessageActivityByAssistantMessage } from "../src/domains/conversation/native-live-message-activity-read-repository.js";

test("current-path reuses durable checkpoint duration through refresh and operational retention without another write", { skip: process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST !== "1" }, async (t) => {
  assert.ok(process.env.DATABASE_URL);
  const database = createDatabase(process.env.DATABASE_URL, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `activity-${crypto.randomUUID()}@example.com`, displayName: "Activity finish" }).returning();
  assert.ok(user);
  t.after(async () => {
    await database.db.delete(conversations).where(eq(conversations.userId, user.id));
    await database.db.delete(users).where(eq(users.id, user.id));
    await database.close();
  });
  const repository = new DrizzleNativeLiveConversationRepository(database.db);
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  const conversation = await repository.createConversation({ userId: user.id, title: "Activity duration" });
  const requestId = crypto.randomUUID();
  const prepared = await coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: requestId, operation: "send", conversation_id: conversation.id, expected_head_message_id: null, text: "Edit" });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  if (!prepared.ok) throw new Error("prepare failed");
  const command = prepared.command;
  const providerResult = normalizeClaudeEvents([
    { type: "result", subtype: "success", session_id: `activity-${requestId}`, result: "Done", duration_ms: 18000 },
  ], { logicalConversationId: conversation.id, mode: "new" }).find((event: { type: string }) => event.type === "result");
  assert.ok(providerResult);
  const finalized = await coordinator.finalize(user.id, {
    protocol_version: 3, prepare_id: command.prepare_id, request_id: requestId, conversation_id: conversation.id, status: "success", provider_session_id: `activity-${requestId}`,
    normalized_events: [
      { type: "tool_use", payload: { tool_use_id: "edit1", tool_name: "Edit", input: {} } },
      { type: "tool_result", payload: { tool_use_id: "edit1", output: "ok" } },
      { type: "text", payload: { text: "Done" } },
      providerResult,
    ],
    runtime_metadata: { context_usage: null, result: providerResult.payload.telemetry },
  });
  assert.ok(finalized.ok);
  if (!finalized.ok) throw new Error("finalize failed");
  const [checkpoint] = await database.db.select({ runtimeMetadata: conversationProviderSessionCheckpoints.runtimeMetadata }).from(conversationProviderSessionCheckpoints).where(eq(conversationProviderSessionCheckpoints.canonicalMessageId, finalized.assistantMessageId));
  assert.equal((checkpoint?.runtimeMetadata?.result as { duration_ms: number })?.duration_ms, 18000);
  const reader = new DrizzleNativeLiveCurrentPathReader(database.db);
  const input = { userId: user.id, conversationId: conversation.id, limit: 100 };
  const before = await reader.readCurrentPath(input);
  const assistant = before?.messages.find((message) => message.id === finalized.assistantMessageId);
  assert.equal(assistant?.activity?.durationMs, 18000);
  const turn = await new DrizzleNativeLiveBackendTurnPort(database.db).readTurn({ userId:user.id, prepareId:prepared.command.prepare_id });
  assert.ok(turn?.startedAt, "actual preparation start is exposed");
  assert.equal(assistant?.activity?.startedAt, turn.startedAt, "canonical start is preparation time, not finalization time");
  assert.equal(assistant?.activity?.prepareId, command.prepare_id);
  assert.deepEqual(assistant?.blocks.map((block) => block.kind), ["tool_use", "tool_result", "text"]);
  const refreshed = await new DrizzleNativeLiveCurrentPathReader(database.db).readCurrentPath(input);
  assert.equal(refreshed?.messages.at(-1)?.activity?.durationMs, 18000);
  await database.db.delete(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, command.prepare_id));
  const expired = await reader.readCurrentPath(input);
  assert.deepEqual(expired?.messages.at(-1)?.activity, { prepareId: null, durationMs: 18000, startedAt:turn.startedAt, events: [], interactions: [] });
  const foreign = await readNativeLiveMessageActivityByAssistantMessage(database.db, { ...input, userId: crypto.randomUUID(), messageRows: [{ id: finalized.assistantMessageId, role: "assistant" }] });
  assert.equal(foreign.size, 0);
  const otherConversation = await readNativeLiveMessageActivityByAssistantMessage(database.db, { ...input, conversationId: crypto.randomUUID(), messageRows: [{ id: finalized.assistantMessageId, role: "assistant" }] });
  assert.equal(otherConversation.size, 0);
  for (const metadata of [null, {}, { result: {} }, { result: { duration_ms: null } }, { result: { duration_ms: -1 } }, { result: { duration_ms: "18000" } }]) {
    await database.db.update(conversationProviderSessionCheckpoints).set({ runtimeMetadata: metadata }).where(eq(conversationProviderSessionCheckpoints.canonicalMessageId, finalized.assistantMessageId));
    const old = await reader.readCurrentPath(input);
    assert.equal(old?.messages.at(-1)?.activity, null);
  }
});

test("provider timing evidence uses persisted event timestamps through successful and failed operational retention", { skip: process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST !== "1" }, async t => {
  const database = createDatabase(process.env.DATABASE_URL!, {ssl:false});
  const [user] = await database.db.insert(users).values({email:`clock-${crypto.randomUUID()}@example.com`,displayName:"Clock"}).returning();
  t.after(async()=> { await database.db.delete(conversations).where(eq(conversations.userId,user.id)); await database.db.delete(users).where(eq(users.id,user.id)); await database.close(); });
  const { nativeLiveRuntimeEvents } = await import("../src/database/schema.js");
  const repository = new DrizzleNativeLiveConversationRepository(database.db);
  const port = new DrizzleNativeLiveBackendTurnPort(database.db);
  const coordinator = new NativeLiveBackendTurnCoordinator(port);
  const reader = new DrizzleNativeLiveCurrentPathReader(database.db);
  for (const outcome of ["success","success-no-terminal","failure","failure-no-terminal"] as const) {
    const status = outcome.startsWith("success") ? "success" : "failure";
    const conversation = await repository.createConversation({userId:user.id,title:"Timing"});
    const prepared = await coordinator.prepare(user.id,{dispatch_target:"claude_code",request_id:crypto.randomUUID(),operation:"send",conversation_id:conversation.id,expected_head_message_id:null,text:"Clock"});
    assert.ok(prepared.ok); if (!prepared.ok) throw Error("prepare");
    const c = prepared.command;
    const expected = [
      {sequence:1,event:{type:"runtime" as const,payload:{kind:"provider_message_start"}},createdAt:"2026-10-04T10:00:05.000Z"},
      {sequence:4,event:{type:status === "success" ? "result" as const : "error" as const,payload:status === "success" ? {duration_ms:17000} : {message:"failed"}},createdAt:"2026-10-04T10:00:17.000Z"},
    ];
    await database.db.insert(nativeLiveRuntimeEvents).values([
      ...expected.filter(e => !outcome.endsWith("no-terminal") || e.event.type === "runtime").map(e => ({userId:user.id,prepareId:c.prepare_id,sequence:e.sequence,eventType:e.event.type,payload:e.event.payload,createdAt:new Date(e.createdAt)})),
      {userId:user.id,prepareId:c.prepare_id,sequence:2,eventType:"partial_text",payload:{delta:"Partial"},createdAt:new Date("2026-10-04T10:00:08Z")},
      {userId:user.id,prepareId:c.prepare_id,sequence:3,eventType:"runtime",payload:{kind:"provider_message_start"},createdAt:new Date("2026-10-04T10:00:11Z")},
    ]);
    const finalized = await coordinator.finalize(user.id,{protocol_version:3,prepare_id:c.prepare_id,request_id:c.request_id,conversation_id:conversation.id,status,...(status === "success" ? {provider_session_id:`clock-${conversation.id}`,normalized_events:[{type:"text",payload:{text:"Partial"}},{type:"result",payload:{status:"success",duration_ms:17000}}]} : {error_code:"CLAUDE_PROCESS_FAILED"})});
    assert.equal(finalized.ok,status === "success",JSON.stringify(finalized));
    const input = {userId:user.id,conversationId:conversation.id,limit:100};
    const before = await reader.readCurrentPath(input);
    const events = status === "success" ? before?.messages.at(-1)?.activity?.events : before?.failedTurn?.events;
    assert.ok(events);
    if (outcome.endsWith("no-terminal")) {
      const terminalType = status === "success" ? "result" : "error";
      assert.equal(events.filter(e=>e.event.type === terminalType).length,1,"a missing terminal delivery must persist a terminal clock boundary");
      const [preparation] = await database.db.select({finalizedAt:nativeLiveTurnPreparations.finalizedAt}).from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id,c.prepare_id));
      assert.equal(events.find(e=>e.event.type === terminalType)!.createdAt,preparation.finalizedAt?.toISOString(),"runtime and durable failure use the exact persisted terminal boundary");
    }
    for (const expectedEvent of expected.filter(e=>!outcome.endsWith("no-terminal") || e.event.type === "runtime")) {
      const actual = events.find(e=>e.sequence===expectedEvent.sequence);
      assert.equal(actual?.createdAt,expectedEvent.createdAt);
      assert.equal(actual?.event.type,expectedEvent.event.type);
      if (expectedEvent.event.type === "runtime") assert.deepEqual(actual?.event.payload,{kind:"provider_message_start"});
    }
    await database.db.delete(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id,c.prepare_id));
    const after = await reader.readCurrentPath(input);
    assert.deepEqual(status === "success" ? after?.messages.at(-1)?.activity?.events : after?.failedTurn?.events,events,"timing survives deletion of operational rows");
    if (status === "success") assert.deepEqual(after?.messages.at(-1)?.blocks.map(b=>b.kind),["text"],"marker never becomes canonical Chat content");
  }
});
