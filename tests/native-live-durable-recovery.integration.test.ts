import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { users, conversations, conversationMessages, conversationProviderSessionCheckpoints, nativeLiveRuntimeListenerLeases } from "../src/database/schema.js";
import { DrizzleNativeLiveBackendRelayRepository, NativeLiveBackendRelayService } from "../src/domains/bridge/relay/native-live-backend-relay.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import { DrizzleNativeLiveProviderSessionStoreRepository, NativeLiveProviderSessionStoreService } from "../src/domains/bridge/provider-session/native-live-provider-session-store.js";
import { NativeLiveMacProviderSessionStore } from "../src/domains/bridge/mac/native-live-mac-provider-session-store.js";
import { NativeLiveMacResultOutbox } from "../src/domains/bridge/mac/native-live-mac-result-outbox.js";
import { isolatedPostgresTarget, verifyIsolatedPostgresTarget } from "../scripts/isolated-postgres-target.mjs";
import { NativeLiveMacDaemonLoop, type NativeLiveMacDaemonRelayClient } from "../src/domains/bridge/mac/native-live-mac-daemon-loop.js";

test("optional remote append component and terminal outbox each replay idempotently after lost commit responses", { skip: process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST !== "1" }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "leilei-combined-recovery-"));
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  await verifyIsolatedPostgresTarget(isolatedPostgresTarget(databaseUrl));
  const database = createDatabase(databaseUrl, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `combined-${crypto.randomUUID()}@example.com`, displayName: "Combined recovery" }).returning({ id: users.id });
  t.after(async () => {
    try {
      await database.db.delete(nativeLiveRuntimeListenerLeases).where(eq(nativeLiveRuntimeListenerLeases.userId, user!.id));
      await database.db.delete(conversations).where(eq(conversations.userId, user!.id));
      await database.db.delete(users).where(eq(users.id, user!.id));
    } finally { await database.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  const userId = user!.id;
  const conversation = await new NativeLiveConversationService(new DrizzleNativeLiveConversationRepository(database.db)).createConversation({ userId, title: "Recovery" });
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  const relay = new NativeLiveBackendRelayService(new DrizzleNativeLiveBackendRelayRepository(database.db), coordinator);
  const owner = crypto.randomUUID(), requestId = crypto.randomUUID();
  await relay.renewLease({ userId, listenerInstanceId: owner, dispatchTarget: "claude_code" });
  const prepared = await coordinator.prepare(userId, { dispatch_target: "claude_code", request_id: requestId, operation: "send", conversation_id: conversation.id, expected_head_message_id: null, text: "minimal local fixture" });
  assert.ok(prepared.ok);
  if (!prepared.ok) throw new Error("prepare failed");
  await relay.enqueuePreparation({ userId, prepareId: prepared.command.prepare_id });
  const reservation = await relay.reserveNext({ userId, listenerInstanceId: owner, dispatchTarget: "claude_code" });
  assert.ok(reservation);
  await relay.markExecutionStarted({ userId, listenerInstanceId: owner, reservationId: reservation.reservationId });
  const sessionId = crypto.randomUUID(), checkpoint = crypto.randomUUID();
  const remote = new NativeLiveProviderSessionStoreService(new DrizzleNativeLiveProviderSessionStoreRepository(database.db));
  const key = { projectKey: "/fixture", sessionId };
  const entries = [{ type: "assistant", uuid: checkpoint, message: { role: "assistant", content: [{ type: "text", text: "local result" }] } }];
  let loseAppend = true;
  const events: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    await remote.append({ userId, key: { sessionId: body.key.session_id }, appendBatchId: body.append_batch_id, entries: body.entries });
    events.push("append");
    if (loseAppend) throw new Error("append response lost after commit");
    return new Response(JSON.stringify({ success: true, data: null }));
  };
  const makeStore = () => new NativeLiveMacProviderSessionStore("https://local.fixture", "local-only", fetchImpl, join(directory, "append"));
  await assert.rejects(makeStore().append(key, entries), /response lost/u);
  const result = { protocol_version: 4 as const, prepare_id: prepared.command.prepare_id, request_id: requestId, conversation_id: conversation.id, status: "success" as const, provider_session_id: sessionId, provider_checkpoint_id: checkpoint, normalized_events: [{ type: "result" as const, payload: { status: "success", final_text: "local result" } }] };
  const entry = { listenerInstanceId: owner, reservationId: reservation.reservationId, result };
  const makeOutbox = () => new NativeLiveMacResultOutbox(join(directory, "result"));
  await makeOutbox().save(entry);
  let loseResult = true, providerCalls = 0;
  const client: NativeLiveMacDaemonRelayClient = {
    renewLease: input => relay.renewLease({ userId, ...input }),
    reserveNext: input => relay.reserveNext({ userId, ...input }),
    markExecutionStarted: input => relay.markExecutionStarted({ userId, ...input }),
    rejectReservation: input => relay.rejectReservation({ userId, ...input }),
    async submitResult(input) {
      assert.deepEqual(input, entry);
      assert.deepEqual(await remote.load({ userId, key: { sessionId } }), entries);
      events.push("result");
      const receipt = await relay.submitResult({ userId, ...input });
      assert.ok(receipt.ok);
      if (loseResult) throw new Error("terminal response lost after canonical commit");
      return { canonicalOutcome: "committed" };
    },
  };
  const makeLoop = () => new NativeLiveMacDaemonLoop(owner, client, { async execute() { providerCalls += 1; throw new Error("provider must not execute"); } }, null, null, null, null, null, null, makeOutbox());
  // This optional remote component retains a failed append until its caller retries.
  // Foreground daemon local-SDK ownership is exercised separately below.
  await assert.rejects(makeStore().recoverPendingAppends(), /response lost/u);
  assert.equal(events.includes("result"), false);
  loseAppend = false;
  await makeStore().recoverPendingAppends();
  assert.equal((await makeLoop().runOnce()).outcome, "delivery_unknown");
  assert.equal((await makeOutbox().list()).length, 1);
  loseResult = false;
  await makeStore().recoverPendingAppends();
  assert.equal((await makeLoop().runOnce()).outcome, "completed");
  assert.equal(providerCalls, 0);
  assert.deepEqual(await remote.load({ userId, key: { sessionId } }), entries);
  const messages = await database.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id));
  const assistants = messages.filter((message) => message.role === "assistant");
  assert.equal(assistants.length, 1);
  const [head] = await database.db.select().from(conversations).where(eq(conversations.id, conversation.id));
  assert.equal(head!.currentHeadMessageId, assistants[0]!.id);
  assert.deepEqual(events, ["append", "append", "append", "result", "result"]);
  assert.deepEqual(await makeOutbox().list(), []);
});


test("local SDK checkpoint and terminal outbox survive daemon restart after a lost canonical commit response", { skip: process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST !== "1" }, async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "leilei-local-sdk-recovery-")));
  const configDirectory = join(directory, "claude");
  const previousConfigDirectory = process.env.CLAUDE_CONFIG_DIR;
  const previousProjectDirectoryName = process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
  // SDK transcript imports use the process environment, independently of the
  // transport's query environment. Isolate it before the first SDK import.
  process.env.CLAUDE_CONFIG_DIR = configDirectory;
  delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
  t.after(() => {
    if (previousConfigDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousConfigDirectory;
    if (previousProjectDirectoryName === undefined) delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
    else process.env.CLAUDE_CODE_PROJECT_DIR_NAME = previousProjectDirectoryName;
    rmSync(directory, { recursive: true, force: true });
  });
  // SDK 0.3.296 ct()/qc(): config/projects/<cwd with non-alphanumerics replaced>.
  // Keep below its 200-character threshold so no truncated-name hash is needed.
  const projectKey = directory.normalize("NFC").replace(/[^a-zA-Z0-9]/g, "-");
  assert.ok(projectKey.length <= 200);
  const projectDirectory = join(configDirectory, "projects", projectKey);
  mkdirSync(projectDirectory, { recursive: true });
  const { AgentSdkClaudeTransport } = await import("../tools/claude-bridge/src/agent-sdk-claude-transport.mjs");
  const { readNativeSession, readNativeBranch } = await import("../tools/claude-bridge/src/native-session-catalog.mjs");
  const { NativeLiveMacWorkingDirectoryRuntimePool } = await import("../src/domains/bridge/mac/native-live-mac-working-directory-runtime.js");
  const { NativeLiveMacRuntimeExecutor } = await import("../src/domains/bridge/mac/native-live-mac-runtime-executor.js");
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  await verifyIsolatedPostgresTarget(isolatedPostgresTarget(databaseUrl));
  const database = createDatabase(databaseUrl, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `local-recovery-${crypto.randomUUID()}@example.com`, displayName: "Local SDK recovery" }).returning();
  t.after(async () => {
    try {
      await database.db.delete(nativeLiveRuntimeListenerLeases).where(eq(nativeLiveRuntimeListenerLeases.userId, user.id));
      await database.db.delete(conversations).where(eq(conversations.userId, user.id));
      await database.db.delete(users).where(eq(users.id, user.id));
    } finally { await database.close(); }
  });
  const repository = new DrizzleNativeLiveConversationRepository(database.db);
  const conversation = await repository.createConversation({ userId: user.id, title: "Local SDK durability" });
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  const relay = new NativeLiveBackendRelayService(new DrizzleNativeLiveBackendRelayRepository(database.db), coordinator);
  const prepared = await coordinator.prepare(user.id, { dispatch_target: "claude_code", request_id: crypto.randomUUID(), operation: "send", conversation_id: conversation.id, expected_head_message_id: null, text: "local transcript fixture" });
  assert.ok(prepared.ok); if (!prepared.ok) throw Error("prepare failed");
  await relay.enqueuePreparation({ userId: user.id, prepareId: prepared.command.prepare_id });
  const owner = crypto.randomUUID(), sessionId = crypto.randomUUID(), checkpointId = crypto.randomUUID();
  let providerCalls = 0, loseResponse = true;
  const transport = new AgentSdkClaudeTransport({
    environment: { CLAUDE_CONFIG_DIR: configDirectory }, cwd: directory,
    // Stub only query/model execution. The SDK's real local transcript importer,
    // transport, executor, daemon loop, outbox and DB repositories remain in use.
    queryImpl: (input: { options: Record<string, unknown>; prompt: AsyncIterable<{ uuid: string }> }) => ({
      close() {}, async *[Symbol.asyncIterator]() {
        providerCalls++;
        assert.equal("sessionStore" in input.options, false, "foreground SDK owns its local transcript");
        yield { type: "system", subtype: "init", session_id: sessionId };
        const prompt = await input.prompt[Symbol.asyncIterator]().next();
        assert.equal(prompt.done, false);
        assert.equal(prompt.value.uuid, prepared.command.canonical_user_message_id);
        const entries = [
          { type: "user", uuid: prompt.value.uuid, parentUuid: null, sessionId, message: { role: "user", content: "local transcript fixture" } },
          { type: "assistant", uuid: checkpointId, parentUuid: prompt.value.uuid, sessionId, message: { role: "assistant", content: [{ type: "text", text: "durable local reply" }] } },
        ];
        writeFileSync(join(projectDirectory, `${sessionId}.jsonl`), entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
        yield { type: "assistant", session_id: sessionId, message: entries[1].message };
        yield { type: "result", subtype: "success", session_id: sessionId, result: "durable local reply" };
      },
    }),
  });
  const pool = new NativeLiveMacWorkingDirectoryRuntimePool({}, directory, async (_environment, _cwd, sessionStore) => {
    assert.equal(sessionStore, null, "actual runtime pool selects local SDK storage by default");
    return { kind: "agent_sdk", runtime: transport };
  });
  const makeOutbox = () => new NativeLiveMacResultOutbox(join(directory, "result-outbox"));
  const receipts: string[] = [];
  const client: NativeLiveMacDaemonRelayClient = {
    renewLease: input => relay.renewLease({ userId: user.id, ...input }),
    reserveNext: input => relay.reserveNext({ userId: user.id, ...input }),
    markExecutionStarted: input => relay.markExecutionStarted({ userId: user.id, ...input }),
    async submitResult(input) {
      assert.equal(input.listenerInstanceId, owner, "restart retains the original reservation owner");
      const pending = await makeOutbox().list();
      assert.equal(pending.length, 1, "daemon persists result before attempting callback");
      assert.deepEqual(pending[0], input);
      assert.equal(input.result.status, "success", JSON.stringify(input.result));
      if (input.result.status !== "success") throw Error("SDK fixture did not succeed");
      assert.equal(input.result.provider_checkpoint_id, checkpointId);
      const snapshot = await readNativeSession(projectDirectory, sessionId);
      assert.equal(readNativeBranch(snapshot, checkpointId).at(-1)?.uuid, checkpointId);
      const receipt = await relay.submitResult({ userId: user.id, ...input });
      assert.ok(receipt.ok); if (!receipt.ok) throw Error("result rejected");
      receipts.push(receipt.outcome);
      if (loseResponse) throw Error("canonical commit response lost");
      return { canonicalOutcome: receipt.outcome };
    },
    markResultDeliveryUnknown: input => relay.markResultDeliveryUnknown({ userId: user.id, ...input }),
    rejectReservation: input => relay.rejectReservation({ userId: user.id, ...input }),
  };
  const firstLoop = new NativeLiveMacDaemonLoop(owner, client, new NativeLiveMacRuntimeExecutor(pool), null, null, null, null, null, null, makeOutbox());
  const first = await firstLoop.runOnce();
  assert.equal(first.outcome, "delivery_unknown", JSON.stringify(first));
  assert.equal(providerCalls, 1);
  const before = await readNativeSession(projectDirectory, sessionId);
  const restartedOwner = crypto.randomUUID();
  const restart = () => new NativeLiveMacDaemonLoop(restartedOwner, client, { async execute() { throw Error("pending replay must not rerun the SDK"); } }, null, null, null, null, null, null, makeOutbox());
  assert.equal((await restart().runOnce()).outcome, "busy", "a live original listener prevents takeover");
  assert.equal(receipts.length, 1, "busy restart must not replay output");
  assert.equal((await makeOutbox().list()).length, 1, "busy restart retains evidence");
  // Model the old process lease expiring without waiting on wall-clock time.
  await database.db.update(nativeLiveRuntimeListenerLeases).set({ leaseExpiresAt: new Date(0) })
    .where(eq(nativeLiveRuntimeListenerLeases.userId, user.id));
  assert.equal((await restart().runOnce()).outcome, "delivery_unknown");
  assert.equal((await makeOutbox().list()).length, 1);
  loseResponse = false;
  const recovered = await restart().runOnce();
  assert.equal(recovered.outcome, "completed");
  if (recovered.outcome === "completed") assert.equal(recovered.canonicalOutcome, "idempotent");
  assert.deepEqual(receipts, ["completed", "idempotent", "idempotent"]);
  assert.equal(providerCalls, 1);
  assert.deepEqual(await makeOutbox().list(), []);
  assert.deepEqual(await readNativeSession(projectDirectory, sessionId), before, "terminal retries cannot rewrite local SDK history");
  assert.throws(() => readNativeBranch(before, crypto.randomUUID()), "unrelated checkpoint must not become an execution root");
  const messages = await database.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id));
  const assistants = messages.filter(message => message.role === "assistant");
  assert.equal(assistants.length, 1);
  const [head] = await database.db.select().from(conversations).where(eq(conversations.id, conversation.id));
  assert.equal(head.currentHeadMessageId, assistants[0].id);
  const checkpoints = await database.db.select().from(conversationProviderSessionCheckpoints).where(eq(conversationProviderSessionCheckpoints.conversationId, conversation.id));
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].canonicalMessageId, assistants[0].id);
  assert.equal(checkpoints[0].providerSessionId, sessionId);
  assert.equal(checkpoints[0].providerCheckpointId, checkpointId);
  assert.equal(await repository.getConversation({ userId: crypto.randomUUID(), conversationId: conversation.id }), null);
});
