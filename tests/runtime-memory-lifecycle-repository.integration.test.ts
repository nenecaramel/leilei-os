import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { runtimeSubjectStates, users } from "../src/database/schema.js";
import { recallBreath } from "../src/domains/runtime/breath/breath-recall.js";
import { DrizzleMemoryLifecycleRuntimePort } from "../src/domains/runtime/lifecycle/memory-lifecycle-runtime-repository.js";
import { MemoryLifecycleService } from "../src/domains/runtime/lifecycle/memory-lifecycle.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state/subject-state-contract.js";

const enabled = process.env.RUN_RUNTIME_LIFECYCLE_DATABASE_TEST === "1";

test(
  "Memory lifecycle persists protect/decay/archive then scrubs forgotten content and purges the tombstone",
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
        email: `runtime-lifecycle-${suffix}@example.com`,
        displayName: "Runtime Lifecycle Test",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const stateId = crypto.randomUUID();
    const state: SubjectStateWrite = {
      id: stateId,
      kind: "memory",
      text: "lifecycle marker",
      payload: null,
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
          sources: [{ kind: "event", id: "lifecycle-test" }],
          causedBy: "lifecycle-test",
          derivedFrom: [],
        },
        versions: {
          schemaVersion: 1,
          ruleVersion: "lifecycle-test",
          processVersion: "lifecycle-test",
        },
      },
    };

    const subjectPort = new DrizzleSubjectStateRuntimePort(database.db);
    await subjectPort.append({ userId, subjectId: "G", states: [state] });

    const lifecycle = new MemoryLifecycleService(
      new DrizzleMemoryLifecycleRuntimePort(database.db),
      {
        halfLifeHours: { memory: 24, feel: 12 },
        fadingThreshold: 0.7,
        archiveThreshold: 0.2,
        forgetAfterHours: 24,
        purgeAfterHours: 24,
      },
    );

    const t0 = "2026-09-20T00:00:00.000Z";
    assert.equal(
      (await lifecycle.runOnce({ userId, subjectId: "G", now: t0 })).initialized,
      1,
    );

    const t1 = "2026-09-21T00:00:00.000Z";
    assert.equal(
      await lifecycle.setProtected({
        userId, subjectId: "G", stateId, protected: true, at: t1,
      }),
      true,
    );

    const t4 = "2026-09-24T00:00:00.000Z";
    await lifecycle.runOnce({ userId, subjectId: "G", now: t4 });

    let [listed] = await subjectPort.list({
      userId,
      subjectId: "G",
      conversationId: crypto.randomUUID(),
    });
    assert.ok(listed);
    assert.equal(
      (listed.payload?.lifecycle_v1 as { salience?: unknown } | undefined)?.salience,
      1,
    );

    assert.equal(
      await lifecycle.setProtected({
        userId, subjectId: "G", stateId, protected: false, at: t4,
      }),
      true,
    );

    const t5 = "2026-09-25T00:00:00.000Z";
    await lifecycle.runOnce({ userId, subjectId: "G", now: t5 });

    [listed] = await subjectPort.list({
      userId,
      subjectId: "G",
      conversationId: crypto.randomUUID(),
    });
    assert.ok(listed);
    const faded = listed.payload?.lifecycle_v1 as
      | { status?: unknown; salience?: unknown }
      | undefined;
    assert.equal(faded?.status, "fading");
    assert.equal(faded?.salience, 0.5);

    assert.equal(
      await lifecycle.archive({
        userId,
        subjectId: "G",
        stateId,
        at: "2026-09-25T01:00:00.000Z",
      }),
      true,
    );

    [listed] = await subjectPort.list({
      userId,
      subjectId: "G",
      conversationId: crypto.randomUUID(),
    });
    assert.ok(listed);

    const recalled = recallBreath(
      "lifecycle marker",
      [listed],
      {
        userId,
        subjectId: "G",
        conversationId: crypto.randomUUID(),
        currentPathMessageIds: new Set(),
        limit: 5,
      },
    );
    assert.deepEqual(recalled, []);

    const forgetAt = "2026-09-26T02:00:00.000Z";
    const forgot = await lifecycle.runOnce({
      userId,
      subjectId: "G",
      now: forgetAt,
    });
    assert.equal(forgot.forgotten, 1);

    let [forgottenRow] = await database.db
      .select({
        text: runtimeSubjectStates.text,
        payload: runtimeSubjectStates.payload,
        validityStatus: runtimeSubjectStates.validityStatus,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.id, stateId))
      .limit(1);
    assert.ok(forgottenRow);
    assert.equal(forgottenRow.text, null);
    assert.equal(forgottenRow.validityStatus, "tombstoned");
    assert.deepEqual(Object.keys(forgottenRow.payload ?? {}), ["lifecycle_v1"]);
    assert.equal(
      (forgottenRow.payload?.lifecycle_v1 as { status?: unknown } | undefined)?.status,
      "forgotten",
    );

    const purgeAt = "2026-09-27T02:00:00.000Z";
    const purge = await lifecycle.runOnce({
      userId,
      subjectId: "G",
      now: purgeAt,
    });
    assert.equal(purge.purged, 1);

    [forgottenRow] = await database.db
      .select({
        text: runtimeSubjectStates.text,
        payload: runtimeSubjectStates.payload,
        validityStatus: runtimeSubjectStates.validityStatus,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.id, stateId))
      .limit(1);
    assert.equal(forgottenRow, undefined);
  },
);
