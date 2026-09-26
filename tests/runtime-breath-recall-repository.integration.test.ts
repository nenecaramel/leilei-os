import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { runtimeSubjectStates, users } from "../src/database/schema.js";
import { recallBreath } from "../src/domains/runtime/breath-recall.js";
import { readSubjectStateLifecycle } from "../src/domains/runtime/memory-lifecycle.js";
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
      stateIds: [stateId],
      recalledAt,
      salienceBoost: 0.08,
      sourceMessageId: "canonical-user-turn",
    });
    await port.recordBreathRecall({
      userId,
      subjectId: "G",
      stateIds: [stateId],
      recalledAt,
      salienceBoost: 0.08,
      sourceMessageId: "canonical-user-turn",
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

    const hits = recallBreath(
      "柠檬黄",
      [stored],
      {
        userId,
        subjectId: "G",
        conversationId: crypto.randomUUID(),
        currentPathMessageIds: new Set(),
        limit: 3,
        now: "2026-09-22T11:00:00.000Z",
        cooldownHours: 2,
        salienceWeight: 0.5,
      },
    );
    assert.deepEqual(hits, []);
  },
);
