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
  "Memory lifecycle never forgets or purges and reactivates legacy archives",
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
        halfLifeHours: { memory: 24 },
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
        userId, subjectId: "G", stateId, at: "2026-09-25T01:00:00.000Z",
      }), false,
    );

    // The old archive flag must not block recall while the text remains.
    await database.db.update(runtimeSubjectStates).set({
      payload: {
        ...(listed.payload ?? {}),
        lifecycle_v1: {
          ...((listed.payload?.lifecycle_v1 ?? {}) as Record<string, unknown>),
          status: "archived",
          archivedAt: t5,
        },
      },
      updatedAt: new Date(),
    }).where(eq(runtimeSubjectStates.id, stateId));

    const [legacyRow] = await database.db.select({
      updatedAt: runtimeSubjectStates.updatedAt,
    }).from(runtimeSubjectStates).where(eq(runtimeSubjectStates.id, stateId)).limit(1);
    assert.ok(legacyRow);
    const directPort = new DrizzleMemoryLifecycleRuntimePort(database.db);
    const noForget = await directPort.forgetArchived({
      userId, subjectId: "G", forgets: [{
        stateId, expectedUpdatedAt: legacyRow.updatedAt.toISOString(),
        lifecycle: {
          status: "forgotten", salience: 0, protected: false,
          lastDecayedAt: t5, lastRecalledAt: null,
          archivedAt: t5, forgottenAt: "2026-09-26T00:00:00.000Z",
        },
      }],
    });
    assert.deepEqual(noForget, {applied: 0, conflicts: 0});
    assert.deepEqual(await directPort.purgeForgotten({
      userId, subjectId: "G", purges: [{
        stateId, expectedUpdatedAt: legacyRow.updatedAt.toISOString(),
      }],
    }), {applied: 0, conflicts: 0});
    assert.equal(await directPort.archive({
      userId, subjectId: "G", stateId, at: t5,
    }), false);

    [listed] = await subjectPort.list({
      userId, subjectId: "G", conversationId: crypto.randomUUID(),
    });
    assert.ok(listed);
    const recalled = recallBreath("lifecycle marker", [listed], {
      userId, subjectId: "G", conversationId: crypto.randomUUID(),
      currentPathMessageIds: new Set(), limit: 5,
    });
    assert.ok(recalled.length > 0, "legacy archived Memory remains eligible");

    const result = await lifecycle.runOnce({
      userId, subjectId: "G", now: "2026-10-01T00:00:00.000Z",
    });
    assert.equal(result.forgottenScanned, 0);
    assert.equal(result.archived, 0);
    assert.equal(result.forgotten, 0);
    assert.equal(result.purged, 0);

    const [persisted] = await database.db.select({
      text: runtimeSubjectStates.text,
      payload: runtimeSubjectStates.payload,
      validityStatus: runtimeSubjectStates.validityStatus,
    }).from(runtimeSubjectStates).where(eq(runtimeSubjectStates.id, stateId)).limit(1);
    assert.ok(persisted);
    assert.equal(persisted.text, "lifecycle marker");
    assert.equal(persisted.validityStatus, "valid");
    assert.equal((persisted.payload?.lifecycle_v1 as {status?: string})?.status, "fading");
  },
);
