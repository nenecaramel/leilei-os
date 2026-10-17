import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, nativeLiveTurnPreparations, conversationProviderSessionCheckpoints } from "../src/database/schema.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { NativeLiveSilenceWakeService, silenceWakePreparationId } from "../src/domains/bridge/turn/native-live-silence-wake.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import { readNativeResumeCheckpoint } from "../src/domains/bridge/turn/native-live-resume-checkpoint.js";

for (const kind of ["quiet", "visible"] as const) {
  test(`stale ${kind} native Wake preserves its verified checkpoint while the next user send is queued`, {
    skip: process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST !== "1",
  }, async t => {
    assert.ok(process.env.DATABASE_URL);
    const { isolatedPostgresTarget, verifyIsolatedPostgresTarget } =
      await import("../scripts/isolated-postgres-target.mjs");
    await verifyIsolatedPostgresTarget(isolatedPostgresTarget(process.env.DATABASE_URL));
    const database = createDatabase(process.env.DATABASE_URL, { ssl: false });
    const db = database.db;
    const userId = crypto.randomUUID();
    const [user] = await db.insert(users).values({
      id: userId, email: `stale-wake-${userId}@example.com`, displayName: "Stale wake fixture",
    }).returning({ id: users.id });
    t.after(async () => {
      try {
        await db.delete(conversations).where(eq(conversations.userId, user.id));
        await db.delete(users).where(eq(users.id, user.id));
      } finally { await database.close(); }
    });

    const service = new NativeLiveConversationService(new DrizzleNativeLiveConversationRepository(db));
    const conv = await service.createConversation({ userId: user.id, title: "Wake race" });
    const port = new DrizzleNativeLiveBackendTurnPort(db);
    const coordinator = new NativeLiveBackendTurnCoordinator(port, () => crypto.randomUUID());
    const start = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code", request_id: crypto.randomUUID(),
      operation: "send", conversation_id: conv.id,
      expected_head_message_id: null, text: "original message",
    });
    assert.equal(start.ok, true);
    if (!start.ok) throw new Error("source preparation failed");
    const providerSessionId = crypto.randomUUID();
    const parentCheckpointId = crypto.randomUUID();
    const original = await coordinator.finalize(user.id, {
      protocol_version: 4, prepare_id: start.command.prepare_id,
      request_id: start.command.request_id, conversation_id: conv.id,
      status: "success", provider_session_id: providerSessionId,
      provider_checkpoint_id: parentCheckpointId,
      normalized_events: [{ type: "text", payload: { text: "original answer" } }],
    });
    assert.ok(original.ok && original.outcome === "completed");
    if (!original.ok || original.outcome !== "completed") throw new Error("source finalize failed");
    let now = new Date();
    const silence = new NativeLiveSilenceWakeService(db, () => now);
    const schedule = await silence.readSchedule({ userId: user.id });
    assert.ok(schedule);
    now = new Date(schedule.postTurnDueAt);
    assert.equal((await silence.fire({
      userId: user.id, epochId: schedule.epochId, slot: "post_turn_idle",
    })).outcome, "queued");
    const wakeId = silenceWakePreparationId(schedule.epochId, "post_turn_idle");
    await db.update(nativeLiveTurnPreparations)
      .set({ runtimeMode: "resume" }).where(eq(nativeLiveTurnPreparations.id, wakeId));
    const wake = await port.getPreparation({ userId: user.id, prepareId: wakeId });
    assert.ok(wake);
    assert.equal(wake.parentProviderCheckpointId, parentCheckpointId);

    // User input arrives AFTER the SDK admitted this Wake but BEFORE
    // its completed result is finalized. Preparation switches presentation
    // ownership; it must not prevent a same-session invisible cursor advance.
    const next = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code", request_id: crypto.randomUUID(),
      operation: "send", conversation_id: conv.id,
      expected_head_message_id: original.assistantMessageId, text: "next user turn",
    });
    assert.equal(next.ok, true);
    if (!next.ok) throw new Error("next send preparation failed");
    assert.equal(next.command.parent_provider_checkpoint_id, parentCheckpointId);

    const resumedCheckpointId = crypto.randomUUID();
    const finalized = await coordinator.finalize(user.id, {
      protocol_version: 4, prepare_id: wakeId, request_id: wake.requestId,
      conversation_id: conv.id, status: "success",
      provider_session_id: providerSessionId, provider_checkpoint_id: resumedCheckpointId,
      normalized_events: [{ type: "text", payload: {
        text: kind === "quiet" ? "<quiet />" : "stale visible text must not publish",
      } }, { type: "result", payload: { status: "success", final_text: kind === "quiet"
        ? "<quiet />" : "stale visible text must not publish" } }],
    });
    assert.ok(finalized.ok && finalized.outcome === "wake_stale");
    if (!finalized.ok) throw new Error("wake finalize failed");
    assert.equal(finalized.nativeResumeCheckpointId, resumedCheckpointId,
      "the Mac must receive proof of the invisible cursor before reusing its writer");
    assert.equal(await readNativeResumeCheckpoint(db, {
      userId: user.id, conversationId: conv.id,
      canonicalMessageId: original.assistantMessageId,
    }), resumedCheckpointId, "new send must bind the exact Wake-advanced provider cursor");
    assert.equal((await port.getPreparation({ userId: user.id, prepareId: wakeId })), null);
    const view = await service.getConversation({ userId: user.id, conversationId: conv.id });
    assert.ok(view);
    assert.equal(view.currentHeadMessageId, original.assistantMessageId,
      "an obsolete Wake never creates a visible assistant message");
    const [cp] = await db.select().from(conversationProviderSessionCheckpoints)
      .where(eq(conversationProviderSessionCheckpoints.canonicalMessageId, original.assistantMessageId));
    assert.equal((cp.runtimeMetadata as Record<string, unknown>)?.native_live_resume_tail !== undefined,true);

    // The queued send is still distinct canonical work with original ancestry.
    // Native started-binding must pick up the hidden cursor when it begins.
    const pending = await port.getPreparation({ userId: user.id, prepareId: next.command.prepare_id });
    assert.ok(pending);
    assert.equal(pending.parentProviderSessionId, providerSessionId);
  });
}
