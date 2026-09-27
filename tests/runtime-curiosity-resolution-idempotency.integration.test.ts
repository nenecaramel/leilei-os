import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversationMessages,
  conversations,
  runtimeCuriosityResolutionEvents,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  readCuriosityEvolution,
  writeCuriosityEvolution,
} from "../src/domains/runtime/curiosity-evolution.js";
import {
  DrizzleCuriosityResolutionRuntimePort,
} from "../src/domains/runtime/curiosity-resolution-runtime-repository.js";
import {
  DrizzleSubjectStateRuntimePort,
} from "../src/domains/runtime/subject-state-runtime-repository.js";
import type {
  SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";

const enabled =
  process.env.RUN_RUNTIME_CURIOSITY_RESOLUTION_DATABASE_TEST === "1";

function curiosityState(input: {
  id: string;
  userId: string;
  sourceId: string;
  now: string;
}): SubjectStateWrite {
  return {
    id: input.id,
    kind: "curiosity",
    text: "Will this replay remain harmless after reactivation?",
    payload: writeCuriosityEvolution(null, {
      phase: "active",
      role: "anchor",
      threadKey: "will this replay remain harmless after reactivation?",
      anchorStateId: input.id,
      reinforcementCount: 1,
      reinforcementSources: [input.sourceId],
      lastEvolvedAt: input.now,
      lastReinforcedAt: input.now,
      resolvedAt: null,
      resolutionSourceId: null,
      dormantAt: null,
    }),
    envelope: {
      semanticActor: { kind: "subject", id: "G" },
      producer: { kind: "model", id: "claude-code" },
      committer: { kind: "runtime", id: "leileios-runtime" },
      authority: "subject_authorized",
      scope: {
        userId: input.userId,
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
        sources: [{ kind: "message", id: input.sourceId }],
        causedBy: input.sourceId,
        derivedFrom: [],
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "curiosity-resolution-idempotency-test",
        processVersion: "curiosity-resolution-idempotency-test",
      },
    },
  };
}

test(
  "Curiosity resolution replay is durable across reactivation and branch purge removes the old action receipt",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });
    let userId: string | null = null;

    t.after(async () => {
      try {
        if (userId) {
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db
            .delete(users)
            .where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email:
          `runtime-curiosity-resolution-${crypto.randomUUID()}@example.com`,
        displayName: "Runtime Curiosity Resolution",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const conversationsRepo =
      new DrizzleNativeLiveConversationRepository(database.db);
    const conversation = await conversationsRepo.createConversation({
      userId,
      title: "Curiosity replay idempotency",
    });
    const sourceUser = await conversationsRepo.appendUserMessage({
      userId,
      conversationId: conversation.id,
      parentMessageId: null,
    });
    const sourceAssistant = await conversationsRepo.appendAssistantMessage({
      userId,
      conversationId: conversation.id,
      parentMessageId: sourceUser.id,
    });

    const curiosityStateId = crypto.randomUUID();
    const initialNow = "2026-09-27T02:00:00.000Z";
    const statePort = new DrizzleSubjectStateRuntimePort(database.db);
    await statePort.append({
      userId,
      subjectId: "G",
      states: [
        curiosityState({
          id: curiosityStateId,
          userId,
          sourceId: sourceAssistant.id,
          now: initialNow,
        }),
      ],
    });

    const resolution =
      new DrizzleCuriosityResolutionRuntimePort(database.db);
    const idempotencyKey =
      "mind-action:curiosity-resolution-idempotency-test-0001";
    const first = await resolution.resolve({
      userId,
      subjectId: "G",
      curiosityStateId,
      conversationId: conversation.id,
      resolutionSourceId: sourceAssistant.id,
      idempotencyKey,
      now: "2026-09-27T03:00:00.000Z",
    });
    assert.equal(first.outcome, "applied");

    const [event] = await database.db
      .select({
        requestedResolutionSourceId:
          runtimeCuriosityResolutionEvents.requestedResolutionSourceId,
        resultResolutionSourceId:
          runtimeCuriosityResolutionEvents.resultResolutionSourceId,
      })
      .from(runtimeCuriosityResolutionEvents)
      .where(
        and(
          eq(runtimeCuriosityResolutionEvents.userId, userId),
          eq(runtimeCuriosityResolutionEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    assert.deepEqual(event, {
      requestedResolutionSourceId: sourceAssistant.id,
      resultResolutionSourceId: sourceAssistant.id,
    });

    const [resolvedState] = await database.db
      .select({
        payload: runtimeSubjectStates.payload,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.id, curiosityStateId))
      .limit(1);
    assert.ok(resolvedState);
    const resolvedEvolution = readCuriosityEvolution(resolvedState.payload);
    assert.ok(resolvedEvolution);
    assert.equal(resolvedEvolution.phase, "resolved");

    const reactivatedAt = "2026-09-27T04:00:00.000Z";
    await database.db
      .update(runtimeSubjectStates)
      .set({
        payload: writeCuriosityEvolution(resolvedState.payload, {
          ...resolvedEvolution,
          phase: "active",
          reinforcementCount: resolvedEvolution.reinforcementCount + 1,
          reinforcementSources: [
            ...resolvedEvolution.reinforcementSources,
            "new-independent-evidence",
          ],
          lastEvolvedAt: reactivatedAt,
          lastReinforcedAt: reactivatedAt,
          resolvedAt: null,
          resolutionSourceId: null,
          dormantAt: null,
        }),
        updatedAt: new Date(reactivatedAt),
      })
      .where(eq(runtimeSubjectStates.id, curiosityStateId));

    const replay = await resolution.resolve({
      userId,
      subjectId: "G",
      curiosityStateId,
      conversationId: conversation.id,
      resolutionSourceId: sourceAssistant.id,
      idempotencyKey,
      now: "2026-09-27T05:00:00.000Z",
    });
    assert.equal(replay.outcome, "idempotent");

    const [afterReplay] = await database.db
      .select({ payload: runtimeSubjectStates.payload })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.id, curiosityStateId))
      .limit(1);
    assert.ok(afterReplay);
    const afterReplayEvolution =
      readCuriosityEvolution(afterReplay.payload);
    assert.ok(afterReplayEvolution);
    assert.equal(
      afterReplayEvolution.phase,
      "active",
      "stale replay must not resolve a Curiosity that reactivated later",
    );
    assert.equal(afterReplayEvolution.resolvedAt, null);
    assert.equal(afterReplayEvolution.resolutionSourceId, null);

    const conflict = await resolution.resolve({
      userId,
      subjectId: "G",
      curiosityStateId,
      conversationId: conversation.id,
      resolutionSourceId: crypto.randomUUID(),
      idempotencyKey,
      now: "2026-09-27T05:30:00.000Z",
    });
    assert.deepEqual(conflict, {
      outcome: "rejected",
      code: "IDEMPOTENCY_CONFLICT",
    });

    await database.db
      .delete(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, sourceAssistant.id),
          eq(conversationMessages.userId, userId),
        ),
      );

    const receiptsAfterBranchPurge = await database.db
      .select({ id: runtimeCuriosityResolutionEvents.id })
      .from(runtimeCuriosityResolutionEvents)
      .where(eq(runtimeCuriosityResolutionEvents.userId, userId));
    assert.equal(
      receiptsAfterBranchPurge.length,
      0,
      "branch purge should cascade the old semantic-action identity",
    );
  },
);
