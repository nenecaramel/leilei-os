import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { conversations, nativeLiveRuntimeListenerLeases, nativeLiveSemanticScoringRequests, users } from "../src/database/schema.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { DrizzleNativeLiveSemanticScoringRepository } from "../src/domains/bridge/mind/native-live-semantic-handshake.js";
import { DrizzleNativeLiveBackendRelayRepository, NativeLiveBackendRelayService } from "../src/domains/bridge/relay/native-live-backend-relay.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { NATIVE_LIVE_SEMANTIC_CANDIDATE_LIMIT } from "../src/shared/native-live-semantic-candidate-limit.js";

const enabled = process.env.RUN_NATIVE_LIVE_SEMANTIC_256_DATABASE_TEST === "1";

test("disposable Postgres preserves full 256-candidate semantic scoring and rejects 257", { skip: !enabled }, async () => {
  const rawUrl = process.env.DATABASE_URL;
  assert.ok(rawUrl, "A disposable localhost DATABASE_URL is required");
  const url = new URL(rawUrl);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Refusing a non-local database");
  assert.equal(url.pathname, "/leileios_native_session_test", "Refusing a non-disposable database");
  assert.notEqual(process.env.NODE_ENV, "production", "Refusing production");

  const database = createDatabase(rawUrl, { ssl: false });
  let userId: string | null = null;
  try {
    const [user] = await database.db.insert(users).values({
      email: `semantic-256-${crypto.randomUUID()}@example.com`,
      displayName: "Disposable 256-candidate regression",
    }).returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const conversation = await new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    ).createConversation({ userId, title: "Disposable semantic scoring" });
    const turnPort = new DrizzleNativeLiveBackendTurnPort(database.db);
    const scoring = new DrizzleNativeLiveSemanticScoringRepository(database.db);
    const candidates = Array.from({ length: NATIVE_LIVE_SEMANTIC_CANDIDATE_LIMIT }, (_, index) => ({
      stateId: crypto.randomUUID(),
      kind: "memory" as const,
      text: `candidate ${index + 1}`,
    }));

    async function createPreparation(text: string) {
      const prepared = await turnPort.prepareSend({
        prepareId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        userId: userId!,
        conversationId: conversation.id,
        expectedHeadMessageId: null,
        text,
        attachmentIds: [],
        executionSelection: null,
      });
      assert.equal(prepared.ok, true);
      if (!prepared.ok) throw new Error("Expected send preparation");
      return prepared.preparation;
    }

    const prepared = await createPreparation("Test bounded recall");
    const plan = {
      manifestId: crypto.randomUUID(),
      assembledAt: new Date().toISOString(),
      snapshotSequence: 1,
      query: "Test bounded recall",
      candidates,
    };
    await scoring.stage({ userId, preparation: prepared, plan });

    const stored = await database.db.select({
      candidates: nativeLiveSemanticScoringRequests.candidates,
    }).from(nativeLiveSemanticScoringRequests)
      .where(eq(nativeLiveSemanticScoringRequests.prepareId, prepared.prepareId));
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.candidates.length, 256);

    const relay = new NativeLiveBackendRelayService(
      new DrizzleNativeLiveBackendRelayRepository(database.db),
      new NativeLiveBackendTurnCoordinator(turnPort),
    );
    const listenerId = crypto.randomUUID();
    assert.equal(await relay.renewLease({
      userId, listenerInstanceId: listenerId, dispatchTarget: "claude_code",
    }), "acquired");
    const reserved = await scoring.reserveNext({ userId, listenerInstanceId: listenerId });
    assert.ok(reserved);
    assert.equal(reserved.candidates.length, 256);

    const scores = Object.fromEntries(reserved.candidates.map((candidate) => [
      candidate.stateId, 0.8,
    ]));
    const accepted = await scoring.acceptScores({
      userId, listenerInstanceId: listenerId,
      prepareId: reserved.reservationId, scores,
    });
    assert.equal(accepted.status, "completed");

    // The original 64-item database cap must not reject a 65-item request.
    const thresholdPreparation = await createPreparation("65-item threshold must work");
    await scoring.stage({
      userId,
      preparation: thresholdPreparation,
      plan: { ...plan, manifestId: crypto.randomUUID(), candidates: candidates.slice(0, 65) },
    });
    const thresholdRows = await database.db.select({
      candidates: nativeLiveSemanticScoringRequests.candidates,
    }).from(nativeLiveSemanticScoringRequests)
      .where(eq(nativeLiveSemanticScoringRequests.prepareId, thresholdPreparation.prepareId));
    assert.equal(thresholdRows[0]?.candidates.length, 65);

    const overflowPreparation = await createPreparation("Overflow must fail");
    await assert.rejects(
      () => scoring.stage({
        userId,
        preparation: overflowPreparation,
        plan: { ...plan, manifestId: crypto.randomUUID(), candidates: [...candidates, {
          stateId: crypto.randomUUID(), kind: "memory", text: "overflow",
        }] },
      }),
      (error: unknown) => {
        // Drizzle wraps the SQLSTATE/constraint error; only the intended
        // 257-item CHECK violation satisfies this assertion.
        let current: unknown = error;
        while (typeof current === "object" && current !== null) {
          const pg = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
          if (pg.code === "23514" &&
              (pg.constraint_name === "native_live_semantic_scoring_requests_candidates_array" ||
               pg.constraint === "native_live_semantic_scoring_requests_candidates_array")) {
            return true;
          }
          current = pg.cause;
        }
        return false;
      },
    );
    const overflowRows = await database.db.select({
      prepareId: nativeLiveSemanticScoringRequests.prepareId,
    }).from(nativeLiveSemanticScoringRequests)
      .where(eq(nativeLiveSemanticScoringRequests.prepareId, overflowPreparation.prepareId));
    assert.equal(overflowRows.length, 0);
  } finally {
    try {
      if (userId) {
        // Relay renewal creates a user-scoped listener lease with ON DELETE RESTRICT.
        // Remove only this test user's lease before deleting its conversations/user.
        await database.db.delete(nativeLiveRuntimeListenerLeases)
          .where(eq(nativeLiveRuntimeListenerLeases.userId, userId));
        await database.db.delete(conversations).where(eq(conversations.userId, userId));
        await database.db.delete(users).where(eq(users.id, userId));
      }
    } finally {
      await database.close();
    }
  }
});
