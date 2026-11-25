import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, conversationContentBlocks, conversationProviderSessionCheckpoints, nativeLiveTurnPreparations } from "../src/database/schema.js";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";
import { listReferencedNativeSessions } from "../src/domains/conversation/native-session-history-repository.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";

const enabled = process.env.RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST === "1";
const sourceDate = new Date("2026-10-10T00:00:00.123Z");

/** Rows as an earlier full-history import left them: original dates and native checkpoints. */
async function importedConversation(turns: number, run: (f: any) => Promise<void>) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/leileios_native_session_test");
  assert.notEqual(process.env.NODE_ENV, "production");
  const { db, close } = createDatabase(url.toString(), { ssl: false });
  const [owner] = await db.insert(users).values({ email: `native-history-${randomUUID()}@example.com`, displayName: "Synthetic native history" }).returning();
  const userId = owner!.id, conversationId = randomUUID(), sessionId = randomUUID();
  const messageIds: string[] = [], checkpoints: string[] = [];
  try {
    await db.insert(conversations).values({ id: conversationId, userId, origin: "native_live", lifecycleStatus: "active",
      providerMetadata: { nativeSessionSource: { schemaVersion: 1, sessionId } } });
    for (let index = 0; index < turns * 2; index++) {
      const id = randomUUID(), role = index % 2 ? "assistant" as const : "user" as const, text = `synthetic ${role} ${index}`;
      await db.insert(conversationMessages).values({ id, userId, conversationId, parentMessageId: messageIds.at(-1) ?? null, sourceMessageId: randomUUID(), role,
        status: "completed", sourceCreatedAt: sourceDate, createdAt: sourceDate, completedAt: sourceDate, isCurrentPath: true, currentPathIndex: index, displayText: text });
      await db.insert(conversationContentBlocks).values({ userId, messageId: id, ordinal: 0, kind: "text", rawType: "text", text });
      messageIds.push(id);
      if (role === "assistant") {
        checkpoints.push(randomUUID());
        await db.insert(conversationProviderSessionCheckpoints).values({ userId, conversationId, canonicalMessageId: id, provider: "claude_code",
          providerSessionId: sessionId, providerCheckpointId: checkpoints.at(-1)!, effectiveWorkingDirectory: "/synthetic/workspace" });
      }
    }
    await db.update(conversations).set({ currentHeadMessageId: messageIds.at(-1)! }).where(eq(conversations.id, conversationId));
    const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(db));
    const prepare = async (operation: Record<string, unknown>) => {
      const prepared = await coordinator.prepare(userId, { request_id: randomUUID(), conversation_id: conversationId, dispatch_target: "claude_code", ...operation } as never);
      assert.ok(prepared.ok, JSON.stringify(prepared));
      return (prepared as any).command;
    };
    await run({ db, userId, conversationId, sessionId, messageIds, checkpoints, prepare });
  } finally {
    await db.delete(conversations).where(eq(conversations.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await close();
  }
}

test("an imported conversation keeps its original dates and an ordinary send resumes the same session", { skip: !enabled }, async () => importedConversation(1, async f => {
  const path = await new DrizzleNativeLiveCurrentPathReader(f.db).readCurrentPath({ userId: f.userId, conversationId: f.conversationId, limit: 100 });
  assert.ok(path);
  assert.deepEqual(path.messages.map(m => [m.role, m.blocks[0]!.text, m.createdAt]), [
    ["user", "synthetic user 0", sourceDate.toISOString()], ["assistant", "synthetic assistant 1", sourceDate.toISOString()],
  ]);
  const command = await f.prepare({ operation: "send", expected_head_message_id: f.messageIds.at(-1), text: "synthetic next" });
  assert.equal(command.runtime_mode, "resume");
  assert.equal(command.parent_provider_session_id, f.sessionId);
  assert.equal(command.parent_provider_checkpoint_id, f.checkpoints[0]);
  assert.equal(command.expected_working_directory, "/synthetic/workspace");
}));

for (const operation of ["retry", "edit"] as const) test(`${operation} in an imported conversation rewinds to the exact earlier checkpoint`, { skip: !enabled }, async () => importedConversation(2, async f => {
  const command = await f.prepare({ operation, target_user_message_id: f.messageIds[2], ...(operation === "edit" ? { text: "synthetic edit" } : {}) });
  assert.equal(command.runtime_mode, "resume");
  assert.equal(command.parent_provider_session_id, f.sessionId);
  assert.equal(command.parent_provider_checkpoint_id, f.checkpoints[0]);
  assert.notEqual(command.parent_provider_checkpoint_id, f.checkpoints[1]);
}));

test("referenced native sessions cover checkpoints, sources and in-flight turns, so archival never removes them", { skip: !enabled }, async () => importedConversation(1, async f => {
  const checkpointSession = randomUUID(), turnSession = randomUUID();
  await f.prepare({ operation: "send", expected_head_message_id: f.messageIds.at(-1), text: "synthetic next" });
  await f.db.update(conversationProviderSessionCheckpoints).set({ providerSessionId: checkpointSession }).where(eq(conversationProviderSessionCheckpoints.conversationId, f.conversationId));
  await f.db.update(nativeLiveTurnPreparations).set({ parentProviderSessionId: turnSession }).where(eq(nativeLiveTurnPreparations.conversationId, f.conversationId));
  const { sessionIds } = await listReferencedNativeSessions(f.db, { userId: f.userId });
  assert.deepEqual(sessionIds, [f.sessionId, checkpointSession, turnSession].sort());
  assert.deepEqual((await listReferencedNativeSessions(f.db, { userId: randomUUID() })).sessionIds, []);
}));
