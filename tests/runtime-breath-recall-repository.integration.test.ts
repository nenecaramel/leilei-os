import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";
import { recallBreath } from "../src/domains/runtime/breath-recall.js";
import {
  readSubjectStateLifecycle,
  readSubjectStateRecallContext,
} from "../src/domains/runtime/memory-lifecycle.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state-runtime-repository.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state-contract.js";

const enabled = process.env.RUN_RUNTIME_BREATH_DATABASE_TEST === "1";

test(
  "selected Breath recall persists lastRecalledAt and enforces cooldown on the next turn",
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
          await database.db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const suffix = crypto.randomUUID();
    const [user] = await database.db
      .insert(users)
      .values({
        email: `runtime-breath-${suffix}@example.com`,
        displayName: "Runtime Breath DB Test",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await conversationService.createConversation({
      userId,
      title: "Breath recall source",
    });
    const canonicalUserTurn = await conversationService.appendUserMessage({
      userId,
      conversationId: conversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "canonical recall source" }],
    });

    const stateId = crypto.randomUUID();
    const state: SubjectStateWrite = {
      id: stateId,
      kind: "memory",
      text: "蕾蕾喜欢柠檬黄",
      payload: {
        lifecycle_v1: {
          status: "fading",
          salience: 0.5,
          protected: false,
          lastDecayedAt: "2026-09-20T00:00:00.000Z",
          lastRecalledAt: null,
          archivedAt: null,
          forgottenAt: null,
        },
      },
      envelope: {
        semanticActor: { kind: "subject", id: "G" },
        producer: { kind: "model", id: "claude-code" },
        committer: { kind: "runtime", id: "leileios-runtime" },
        authority: "subject_authorized",
        scope: {
          userId,
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
          sources: [{ kind: "event", id: "breath-db-test" }],
          causedBy: "breath-db-test",
          derivedFrom: [],
        },
        versions: {
          schemaVersion: 1,
          ruleVersion: "breath-db-test",
          processVersion: "breath-db-test",
        },
      },
    };

    const port = new DrizzleSubjectStateRuntimePort(database.db);
    await port.append({ userId, subjectId: "G", states: [state] });

    const recalledAt = "2026-09-22T10:00:00.000Z";
    await port.recordBreathRecall({
      userId,
      subjectId: "G",
      conversationId: conversation.id,
      contextEpoch: 0,
      stateIds: [stateId],
      recalledAt,
      salienceBoost: 0.08,
      sourceMessageId: canonicalUserTurn.id,
    });
    await port.recordBreathRecall({
      userId,
      subjectId: "G",
      conversationId: conversation.id,
      contextEpoch: 0,
      stateIds: [stateId],
      recalledAt,
      salienceBoost: 0.08,
      sourceMessageId: canonicalUserTurn.id,
    });

    const [stored] = await port.list({
      userId,
      subjectId: "G",
      conversationId: crypto.randomUUID(),
    });
    assert.ok(stored);
    const lifecycle = readSubjectStateLifecycle(stored.payload);
    assert.ok(lifecycle);
    assert.equal(lifecycle.lastRecalledAt, recalledAt);
    assert.equal(lifecycle.salience, 0.58);
    assert.deepEqual(
      readSubjectStateRecallContext(stored.payload),
      {
        conversationId: conversation.id,
        epoch: 0,
        sourceMessageId: canonicalUserTurn.id,
        recalledAt,
      },
    );

    const legacyStateId = crypto.randomUUID();
    const legacyState: SubjectStateWrite = {
      ...state,
      id: legacyStateId,
      text: "legacy memory without recall ledger",
      payload: {
        lifecycle_v1: {
          status: "fading",
          salience: 0.5,
          protected: false,
          lastDecayedAt: "2026-09-22T09:00:00.000Z",
          lastRecalledAt: "2026-09-22T09:00:00.000Z",
          archivedAt: null,
          forgottenAt: null,
        },
      },
    };
    await port.append({
      userId,
      subjectId: "G",
      states: [legacyState],
    });

    for (const legacyReplayAt of [
      "2026-09-22T09:00:00.000Z",
      "2026-09-22T08:00:00.000Z",
    ]) {
      await port.recordBreathRecall({
        userId,
        subjectId: "G",
        stateIds: [legacyStateId],
        recalledAt: legacyReplayAt,
        salienceBoost: 0.08,
        sourceMessageId: canonicalUserTurn.id,
      });
    }

    let storedLegacy = (
      await port.list({
        userId,
        subjectId: "G",
        conversationId: conversation.id,
      })
    ).find((candidate) => candidate.id === legacyStateId);
    assert.ok(storedLegacy);
    assert.equal(
      "recall_reinforcement_v1" in (storedLegacy.payload ?? {}),
      false,
    );
    assert.equal(
      readSubjectStateLifecycle(storedLegacy.payload)?.salience,
      0.5,
    );

    const newRecallAt = "2026-09-22T10:00:00.000Z";
    await port.recordBreathRecall({
      userId,
      subjectId: "G",
      conversationId: conversation.id,
      contextEpoch: 0,
      stateIds: [legacyStateId],
      recalledAt: newRecallAt,
      salienceBoost: 0.08,
      sourceMessageId: canonicalUserTurn.id,
    });

    storedLegacy = (
      await port.list({
        userId,
        subjectId: "G",
        conversationId: conversation.id,
      })
    ).find((candidate) => candidate.id === legacyStateId);
    assert.ok(storedLegacy);
    const healedLifecycle = readSubjectStateLifecycle(
      storedLegacy.payload,
    );
    assert.ok(healedLifecycle);
    assert.equal(healedLifecycle.salience, 0.58);
    assert.equal(healedLifecycle.lastRecalledAt, newRecallAt);
    const contributions = (
      storedLegacy.payload?.recall_reinforcement_v1 as {
        contributions: Array<{
          sourceMessageId: string;
          recalledAt: string;
          currentValue: number;
        }>;
      }
    ).contributions;
    assert.equal(contributions.length, 1);
    assert.equal(
      contributions[0]?.sourceMessageId,
      canonicalUserTurn.id,
    );
    assert.equal(contributions[0]?.recalledAt, newRecallAt);
    assert.ok(
      Math.abs((contributions[0]?.currentValue ?? 0) - 0.08) < 1e-12,
    );

    const hits = recallBreath(
      "柠檬黄",
      [stored],
      {
        userId,
        subjectId: "G",
        conversationId: conversation.id,
        contextEpoch: 0,
        currentPathMessageIds: new Set(),
        limit: 3,
        now: "2026-09-22T11:00:00.000Z",
        cooldownHours: 2,
        salienceWeight: 0.5,
      },
    );
    assert.deepEqual(hits, []);

    const afterCompact = recallBreath(
      "柠檬黄",
      [stored],
      {
        userId,
        subjectId: "G",
        conversationId: conversation.id,
        contextEpoch: 1,
        currentPathMessageIds: new Set(),
        limit: 3,
        now: "2026-09-22T11:00:00.000Z",
        cooldownHours: 2,
        salienceWeight: 0.5,
      },
    );
    assert.deepEqual(
      afterCompact.map((hit) => hit.state.id),
      [stateId],
    );
  },
);
