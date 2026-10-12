import assert from "node:assert/strict";
import test from "node:test";
import { NativeLiveMacHttpRelayClient } from "../src/domains/bridge/mac/native-live-mac-http-relay-client.js";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveRuntimeListenerLeases,
  nativeLiveSemanticScoringRequests,
  runtimeContextManifests,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveBackendRelayRepository,
  NativeLiveBackendRelayService,
} from "../src/domains/bridge/relay/native-live-backend-relay.js";
import {
  NativeLiveBackendRelayPrepareCoordinator,
} from "../src/domains/bridge/relay/native-live-backend-relay-prepare.js";
import {
  NativeLiveBackendTurnCoordinator,
} from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import {
  DrizzleNativeLiveBackendTurnPort,
} from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import {
  DrizzleNativeLiveSemanticScoringRepository,
  NativeLiveSemanticHandshakeService,
} from "../src/domains/bridge/mind/native-live-semantic-handshake.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";
import {
  createDefaultBackendMindRuntime,
} from "../src/domains/runtime/mind/default-backend-mind-runtime.js";
import {
  DrizzleSubjectStateRuntimePort,
} from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";

const enabled =
  process.env.RUN_NATIVE_LIVE_SEMANTIC_DATABASE_TEST === "1";

test(
  "semantic score receipt is durable and backend recovery assembles the exact scored Context Manifest",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, { ssl: false });
    let cleanupUserId: string | null = null;
    t.after(async () => {
      try {
        if (cleanupUserId) {
          await database.db
            .delete(nativeLiveRuntimeListenerLeases)
            .where(eq(nativeLiveRuntimeListenerLeases.userId, cleanupUserId));
          await database.db
            .delete(runtimeContextManifests)
            .where(eq(runtimeContextManifests.userId, cleanupUserId));
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, cleanupUserId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, cleanupUserId));
          await database.db
            .delete(users)
            .where(eq(users.id, cleanupUserId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-semantic-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Semantic",
      })
      .returning({ id: users.id });
    assert.ok(user);
    cleanupUserId = user.id;

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await conversationService.createConversation({
      userId: user.id,
      title: "Semantic handshake",
    });

    const memoryId = crypto.randomUUID();
    await new DrizzleSubjectStateRuntimePort(database.db).append({
      userId: user.id,
      subjectId: "G",
      states: [{
        id: memoryId,
        kind: "memory",
        text: "那趟独自旅行让我第一次真切感到自己可以照顾好自己",
        payload: null,
        envelope: {
          semanticActor: { kind: "subject", id: "G" },
          producer: { kind: "model", id: "test" },
          committer: { kind: "runtime", id: "test" },
          authority: "derived",
          scope: {
            userId: user.id,
            subjectId: "G",
            applicability: "global",
            conversationId: null,
            pathHeadMessageId: null,
            visibility: "subject_private",
            sensitivity: "normal",
            audience: ["G"],
          },
          status: {
            generationStatus: "committed",
            presentationStatus: "presented",
            pathStatus: "current",
            settlementStatus: "settled",
            validityStatus: "valid",
          },
          provenance: {
            sources: [{ kind: "event", id: "semantic-fixture" }],
            causedBy: "semantic-fixture",
            derivedFrom: [],
          },
          versions: {
            schemaVersion: 1,
            ruleVersion: "semantic-handshake-test",
            processVersion: "semantic-handshake-test",
          },
        },
      }],
    });

    const turnPort = new DrizzleNativeLiveBackendTurnPort(database.db);
    const backendMind = createDefaultBackendMindRuntime(database.db);
    const finalizeCoordinator = new NativeLiveBackendTurnCoordinator(turnPort);
    const relayService = new NativeLiveBackendRelayService(
      new DrizzleNativeLiveBackendRelayRepository(database.db),
      finalizeCoordinator,
    );
    const semanticRepository =
      new DrizzleNativeLiveSemanticScoringRepository(database.db);
    const semanticService = new NativeLiveSemanticHandshakeService(
      semanticRepository,
      turnPort,
      backendMind,
      relayService,
    );
    const prepareCoordinator = new NativeLiveBackendRelayPrepareCoordinator(
      turnPort,
      backendMind,
      semanticService,
    );

    const requestId = crypto.randomUUID();
    const prepared = await prepareCoordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "solo travel made me feel independent",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) throw new Error("expected prepare success");
    assert.equal(prepared.semanticPending, true);

    const replayed = await prepareCoordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "solo travel made me feel independent",
    });
    assert.equal(replayed.ok, true);
    if (!replayed.ok) throw new Error("expected prepare replay success");
    assert.equal(replayed.outcome, "replayed");
    assert.equal(replayed.semanticPending, true);
    assert.equal(
      replayed.command.prepare_id,
      prepared.command.prepare_id,
    );

    const listenerId = crypto.randomUUID();
    assert.equal(
      await relayService.renewLease({
        userId: user.id,
        listenerInstanceId: listenerId,
        dispatchTarget: "claude_code",
      }),
      "acquired",
    );

    const scoring = await semanticService.reserveNext({
      userId: user.id,
      listenerInstanceId: listenerId,
    });
    assert.ok(scoring);
    assert.equal(scoring.reservationId, prepared.command.prepare_id);
    assert.equal(
      scoring.candidates.some((candidate) => candidate.stateId === memoryId),
      true,
    );

    await t.test("lost reserve response returns the same leased semantic task to its owner", async () => {
      const before = await semanticRepository.get({ userId: user.id, prepareId: scoring.reservationId });
      let calls = 0;
      const client = new NativeLiveMacHttpRelayClient("https://relay.example", "test-only", async () => {
        const data = await semanticService.reserveNext({ userId: user.id, listenerInstanceId: listenerId });
        if (++calls === 1) {
          return new Response(new ReadableStream({ start(controller) {
            controller.error(new TypeError("simulated response stream lost after DB commit"));
          } }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, data }), { status: 200 });
      });
      await assert.rejects(() => client.reserveSemanticScoring({ listenerInstanceId: listenerId, dispatchTarget: "claude_code" }));
      assert.deepEqual(await client.reserveSemanticScoring({ listenerInstanceId: listenerId, dispatchTarget: "claude_code" }), scoring);
      assert.equal(calls, 2);

      await assert.rejects(() => semanticService.reserveNext({
        userId: user.id, listenerInstanceId: crypto.randomUUID(),
      }), (error: unknown) => (error as { code?: string }).code === "LISTENER_NOT_ACTIVE");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const redelivered = await semanticService.reserveNext({ userId: user.id, listenerInstanceId: listenerId });
        assert.deepEqual(redelivered, scoring, "a committed reservation must not disappear before its owner receives it");
      }
      assert.deepEqual(await semanticRepository.get({ userId: user.id, prepareId: scoring.reservationId }), before);
      await database.db.update(nativeLiveSemanticScoringRequests)
        .set({ reservationExpiresAt: new Date(Date.now() - 1_000) })
        .where(eq(nativeLiveSemanticScoringRequests.prepareId, scoring.reservationId));
      assert.deepEqual(await semanticService.reserveNext({ userId: user.id, listenerInstanceId: listenerId }), scoring,
        "expired leases must still recover through the existing pending transition");

    });

    const scores = Object.fromEntries(
      scoring.candidates.map((candidate) => [
        candidate.stateId,
        candidate.stateId === memoryId ? 0.93 : 0.2,
      ]),
    );

    await semanticRepository.acceptScores({
      userId: user.id,
      listenerInstanceId: listenerId,
      prepareId: scoring.reservationId,
      scores,
    });
    assert.equal(await semanticService.reserveNext({ userId: user.id, listenerInstanceId: listenerId }), null,
      "completed semantic tasks must not be redelivered");

    await semanticRepository.acceptScores({
      userId: user.id,
      listenerInstanceId: listenerId,
      prepareId: scoring.reservationId,
      scores,
    });
    await assert.rejects(
      () =>
        semanticRepository.acceptScores({
          userId: user.id,
          listenerInstanceId: listenerId,
          prepareId: scoring.reservationId,
          scores: Object.fromEntries(
            scoring.candidates.map((candidate) => [
              candidate.stateId,
              candidate.stateId === memoryId ? 0.91 : 0.2,
            ]),
          ),
        }),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: unknown }).code
          === "SEMANTIC_RESERVATION_CONFLICT",
    );

    const beforeRecovery = await turnPort.getPreparation({
      userId: user.id,
      prepareId: scoring.reservationId,
    });
    assert.ok(beforeRecovery);
    assert.equal(beforeRecovery.mindPrepared, false);

    const stagedPlan = await semanticService.readPlan({
      userId: user.id,
      prepareId: scoring.reservationId,
    });
    assert.ok(stagedPlan);
    const firstAssembledPrompt = await backendMind.completeSemanticPrompt({
      userId: user.id,
      preparation: beforeRecovery,
      plan: stagedPlan,
      scores: new Map(Object.entries(scores)),
    });
    const stillUnpersisted = await turnPort.getPreparation({
      userId: user.id,
      prepareId: scoring.reservationId,
    });
    assert.ok(stillUnpersisted);
    assert.equal(stillUnpersisted.mindPrepared, false);

    assert.equal(
      await semanticService.processNextCompletion(),
      "processed",
    );

    const afterRecovery = await turnPort.getPreparation({
      userId: user.id,
      prepareId: scoring.reservationId,
    });
    assert.ok(afterRecovery);
    assert.equal(afterRecovery.mindPrepared, true);
    assert.equal(afterRecovery.prompt, firstAssembledPrompt);
    assert.equal(
      afterRecovery.prompt.includes(
        "那趟独自旅行让我第一次真切感到自己可以照顾好自己",
      ),
      true,
    );

    const reservation = await relayService.reserveNext({
      userId: user.id,
      listenerInstanceId: listenerId,
      dispatchTarget: "claude_code",
    });
    assert.ok(reservation);
    assert.equal(reservation.reservationId, scoring.reservationId);

    const manifests = await database.db
      .select({ items: runtimeContextManifests.items })
      .from(runtimeContextManifests)
      .where(eq(runtimeContextManifests.userId, user.id));
    const selected = manifests
      .flatMap((manifest) => manifest.items)
      .find((item) => item.sourceId === memoryId) as
        | {
            selection?: {
              reason?: unknown;
              score?: unknown;
            };
          }
        | undefined;
    assert.ok(selected);
    assert.equal(
      selected.selection?.reason,
      "breath_semantic_match",
    );
    assert.equal(typeof selected.selection?.score, "number");
    assert.ok((selected.selection?.score as number) > 0);
  },
);


test(
  "semantic completion recovery preserves per-conversation order while other conversations can progress",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, { ssl: false });
    let cleanupUserId: string | null = null;
    t.after(async () => {
      try {
        if (cleanupUserId) {
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, cleanupUserId));
          await database.db
            .delete(users)
            .where(eq(users.id, cleanupUserId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email:
          `native-live-semantic-order-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Semantic Order",
      })
      .returning({ id: users.id });
    assert.ok(user);
    cleanupUserId = user.id;

    const conversationsRepo =
      new DrizzleNativeLiveConversationRepository(database.db);
    const conversationA = await conversationsRepo.createConversation({
      userId: user.id,
      title: "Semantic FIFO A",
    });
    const conversationB = await conversationsRepo.createConversation({
      userId: user.id,
      title: "Semantic FIFO B",
    });
    const turnPort = new DrizzleNativeLiveBackendTurnPort(database.db);

    async function prepareSend(
      conversationId: string,
      expectedHeadMessageId: string | null,
      text: string,
    ) {
      const result = await turnPort.prepareSend({
        prepareId: crypto.randomUUID(),
        userId: user.id,
        requestId: crypto.randomUUID(),
        conversationId,
        expectedHeadMessageId,
        text,
        attachmentIds: [],
        executionSelection: null,
      });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected prepare success");
      return result.preparation;
    }

    const a1 = await prepareSend(conversationA.id, null, "A1");
    const a2 = await prepareSend(
      conversationA.id,
      null,
      "A2",
    );
    const b1 = await prepareSend(conversationB.id, null, "B1");

    const a1Candidate = crypto.randomUUID();
    const a2Candidate = crypto.randomUUID();
    const b1Candidate = crypto.randomUUID();
    await database.db.insert(nativeLiveSemanticScoringRequests).values([
      {
        prepareId: a1.prepareId,
        userId: user.id,
        conversationId: conversationA.id,
        manifestId: crypto.randomUUID(),
        assembledAt: new Date("2026-09-27T03:00:00.000Z"),
        snapshotSequence: 1,
        query: "A1",
        candidates: [{
          stateId: a1Candidate,
          kind: "memory",
          text: "A1 memory",
        }],
        status: "completed",
        scores: { [a1Candidate]: 0.8 },
        completedAt: new Date("2026-09-27T03:01:00.000Z"),
        resumeAvailableAt: new Date("2099-01-01T00:00:00.000Z"),
      },
      {
        prepareId: a2.prepareId,
        userId: user.id,
        conversationId: conversationA.id,
        manifestId: crypto.randomUUID(),
        assembledAt: new Date("2026-09-27T03:02:00.000Z"),
        snapshotSequence: 2,
        query: "A2",
        candidates: [{
          stateId: a2Candidate,
          kind: "memory",
          text: "A2 memory",
        }],
        status: "completed",
        scores: { [a2Candidate]: 0.8 },
        completedAt: new Date("2026-09-27T03:03:00.000Z"),
        resumeAvailableAt: new Date("2000-01-01T00:00:00.000Z"),
      },
      {
        prepareId: b1.prepareId,
        userId: user.id,
        conversationId: conversationB.id,
        manifestId: crypto.randomUUID(),
        assembledAt: new Date("2026-09-27T03:04:00.000Z"),
        snapshotSequence: 1,
        query: "B1",
        candidates: [{
          stateId: b1Candidate,
          kind: "memory",
          text: "B1 memory",
        }],
        status: "completed",
        scores: { [b1Candidate]: 0.8 },
        completedAt: new Date("2026-09-27T03:05:00.000Z"),
        resumeAvailableAt: new Date("2000-01-01T00:00:00.000Z"),
      },
    ]);

    const semanticRepository =
      new DrizzleNativeLiveSemanticScoringRepository(database.db);
    const selected = await semanticRepository.findCompletionPending();
    assert.ok(selected);
    assert.equal(
      selected.prepareId,
      b1.prepareId,
      "deferred A1 must block A2 without blocking conversation B",
    );
  },
);

test("lost semantic reservation transport response preserves owner, expiry recovery and score idempotence", { skip: !enabled }, async t => {
  const url = process.env.DATABASE_URL;
  assert.ok(url);
  assert.ok(new URL(url).hostname === "127.0.0.1" || new URL(url).hostname === "localhost", "this fault-injection test requires an isolated local database");
  assert.match(new URL(url).pathname, /test|regression|scratch/);
  const database = createDatabase(url, { ssl: false });
  const [user] = await database.db.insert(users).values({
    email: `bounded-recovery-${crypto.randomUUID()}@example.com`, displayName: "Synthetic recovery test",
  }).returning({ id: users.id });
  assert.ok(user);
  t.after(async () => {
    try {
      await database.db.delete(nativeLiveRuntimeListenerLeases).where(eq(nativeLiveRuntimeListenerLeases.userId, user.id));
      await database.db.delete(conversations).where(eq(conversations.userId, user.id));
      await database.db.delete(users).where(eq(users.id, user.id));
    } finally { await database.close(); }
  });
  const conversation = await new NativeLiveConversationService(new DrizzleNativeLiveConversationRepository(database.db))
    .createConversation({ userId: user.id, title: "Synthetic reservation recovery" });
  const turnPort = new DrizzleNativeLiveBackendTurnPort(database.db);
  const prepared = await turnPort.prepareSend({
    prepareId: crypto.randomUUID(), userId: user.id, requestId: crypto.randomUUID(),
    conversationId: conversation.id, expectedHeadMessageId: null,
    text: "synthetic recovery input", attachmentIds: [], executionSelection: null,
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("synthetic preparation failed");
  const repository = new DrizzleNativeLiveSemanticScoringRepository(database.db);
  const stateId = crypto.randomUUID();
  await repository.stage({ userId: user.id, preparation: prepared.preparation, plan: {
    manifestId: crypto.randomUUID(), assembledAt: new Date().toISOString(), snapshotSequence: 0,
    query: "synthetic recovery query", candidates: [{ stateId, kind: "memory", text: "synthetic candidate" }],
  } });
  const listener = crypto.randomUUID();
  const relay = new NativeLiveBackendRelayService(new DrizzleNativeLiveBackendRelayRepository(database.db), new NativeLiveBackendTurnCoordinator(turnPort));
  assert.equal(await relay.renewLease({ userId: user.id, listenerInstanceId: listener, dispatchTarget: "claude_code" }), "acquired");
  let responses = 0;
  const client = new NativeLiveMacHttpRelayClient("https://synthetic-relay.invalid", "test-only", async () => {
    const data = await repository.reserveNext({ userId: user.id, listenerInstanceId: listener });
    if (++responses === 1) {
      return new Response(new ReadableStream({ start(controller) {
        controller.error(new TypeError("synthetic HTTP 200 body lost after transaction commit"));
      } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, data }));
  });
  await assert.rejects(() => client.reserveSemanticScoring({ listenerInstanceId: listener, dispatchTarget: "claude_code" }));
  const [committed] = await database.db.select().from(nativeLiveSemanticScoringRequests)
    .where(eq(nativeLiveSemanticScoringRequests.prepareId, prepared.preparation.prepareId));
  assert.ok(committed);
  assert.equal(committed.status, "reserved");
  assert.equal(committed.reservedBy, listener);
  const recovered = await client.reserveSemanticScoring({ listenerInstanceId: listener, dispatchTarget: "claude_code" });
  assert.equal(recovered?.reservationId, prepared.preparation.prepareId);
  const repeated = await Promise.all([0, 1].map(() => repository.reserveNext({ userId: user.id, listenerInstanceId: listener })));
  assert.deepEqual(repeated, [recovered, recovered]);
  const [unchanged] = await database.db.select().from(nativeLiveSemanticScoringRequests)
    .where(eq(nativeLiveSemanticScoringRequests.prepareId, committed.prepareId));
  assert.deepEqual(unchanged, committed, "redelivery must not extend or rewrite the committed reservation");
  await assert.rejects(() => repository.reserveNext({ userId: user.id, listenerInstanceId: crypto.randomUUID() }),
    (error: unknown) => (error as { code?: string }).code === "LISTENER_NOT_ACTIVE");
  await database.db.update(nativeLiveSemanticScoringRequests).set({ reservationExpiresAt: new Date(Date.now() - 1_000) })
    .where(eq(nativeLiveSemanticScoringRequests.prepareId, committed.prepareId));
  assert.deepEqual(await repository.reserveNext({ userId: user.id, listenerInstanceId: listener }), recovered);
  const input = { userId: user.id, listenerInstanceId: listener, prepareId: committed.prepareId, scores: { [stateId]: 0.9 } };
  const accepted = await repository.acceptScores(input);
  assert.deepEqual(await repository.acceptScores(input), accepted);
  assert.equal(await repository.reserveNext({ userId: user.id, listenerInstanceId: listener }), null);
  const rows = await database.db.select().from(nativeLiveSemanticScoringRequests).where(eq(nativeLiveSemanticScoringRequests.userId, user.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, "completed");
});
