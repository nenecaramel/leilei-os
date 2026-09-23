import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  nativeLiveBackgroundModelJobs,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveBackgroundModelQueueRepository,
  NativeLiveBackgroundModelQueueService,
} from "../src/domains/bridge/native-live-background-model-queue.js";
import {
  TopicResurfaceCrossDeviceCoordinator,
} from "../src/domains/runtime/topic-resurface-cross-device-coordinator.js";
import {
  TopicResurfaceCrossDeviceOpportunity,
} from "../src/domains/runtime/topic-resurface-cross-device-opportunity.js";
import {
  DrizzleTopicResurfaceCandidatePort,
} from "../src/domains/runtime/topic-resurface-candidate-runtime-repository.js";
import {
  TopicResurfaceCandidateService,
} from "../src/domains/runtime/topic-resurface-candidates.js";
import {
  DrizzleTopicResurfaceThoughtMaterializationPort,
} from "../src/domains/runtime/topic-resurface-thought-materialization-runtime-repository.js";
import {
  DrizzleSubjectStateRuntimePort,
} from "../src/domains/runtime/subject-state-runtime-repository.js";
import {
  topicThreadKey,
  writeTopicEvolution,
} from "../src/domains/runtime/topic-evolution.js";
import type {
  SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";

const enabled =
  process.env.RUN_RUNTIME_TOPIC_OPPORTUNITY_DATABASE_TEST === "1";

function dormantTopic(input: {
  id: string;
  userId: string;
  text: string;
  causedBy: string;
}): SubjectStateWrite {
  return {
    id: input.id,
    kind: "topic",
    text: input.text,
    payload: writeTopicEvolution(null, {
      phase: "dormant",
      role: "anchor",
      threadKey: topicThreadKey(input.text),
      anchorStateId: input.id,
      reinforcementCount: 1,
      reinforcementSources: [input.causedBy],
      lastEvolvedAt: "2026-09-23T00:00:00.000Z",
      lastReinforcedAt: "2026-09-20T00:00:00.000Z",
      dormantAt: "2026-09-23T00:00:00.000Z",
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
        sources: [{ kind: "message", id: input.causedBy }],
        causedBy: input.causedBy,
        derivedFrom: [],
        decisionId: null,
        processRunId: null,
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "opportunity-test",
        processVersion: "opportunity-test",
        model: null,
      },
    },
  };
}

test(
  "production Topic opportunity stages one bounded workflow and enforces cadence over durable queue state",
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
            .delete(nativeLiveBackgroundModelJobs)
            .where(eq(nativeLiveBackgroundModelJobs.userId, userId));
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
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
          `topic-opportunity-${crypto.randomUUID()}@example.com`,
        displayName: "Topic Opportunity",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    await new DrizzleSubjectStateRuntimePort(database.db).append({
      userId,
      subjectId: "G",
      states: [
        dormantTopic({
          id: crypto.randomUUID(),
          userId,
          text: "后台思考应该保持低频并且不能抢 foreground",
          causedBy: "opportunity-source-1",
        }),
      ],
    });

    const queue = new NativeLiveBackgroundModelQueueService(
      new DrizzleNativeLiveBackgroundModelQueueRepository(database.db),
    );
    const coordinator = new TopicResurfaceCrossDeviceCoordinator(
      queue,
      new TopicResurfaceCandidateService(
        new DrizzleTopicResurfaceCandidatePort(database.db),
      ),
      new DrizzleTopicResurfaceThoughtMaterializationPort(database.db),
      {
        ruleVersion: "topic-resurface-thought-v1",
        processVersion: "topic-resurface-thought-materialization-v1",
        deliberationPromptContractVersion:
          "topic-resurface-deliberation-v1",
        retentionPromptContractVersion:
          "topic-resurface-retention-v1",
        model: {
          provider: "claude_code",
          model: "runtime-selected",
          configVersion: "cross-device-v1",
          promptContractVersion: "topic-resurface-v1",
        },
      },
    );

    let now = "2026-09-23T04:00:00.000Z";
    const opportunity = new TopicResurfaceCrossDeviceOpportunity(
      coordinator,
      "G",
      {
        minIntervalMs: 60_000,
        candidateLimit: 5,
      },
      () => now,
    );

    const first = await opportunity.offer({ userId });
    assert.equal(first.outcome, "attempted");
    if (first.outcome !== "attempted") {
      throw new Error("expected first Topic opportunity attempt");
    }
    assert.equal(first.result.outcome, "staged_evaluation");

    const jobsAfterFirst = await database.db
      .select({
        id: nativeLiveBackgroundModelJobs.id,
        status: nativeLiveBackgroundModelJobs.status,
        taskKind: nativeLiveBackgroundModelJobs.taskKind,
        subjectId: nativeLiveBackgroundModelJobs.subjectId,
      })
      .from(nativeLiveBackgroundModelJobs)
      .where(eq(nativeLiveBackgroundModelJobs.userId, userId));
    assert.equal(jobsAfterFirst.length, 1);
    assert.equal(jobsAfterFirst[0]?.status, "pending");
    assert.equal(
      jobsAfterFirst[0]?.taskKind,
      "topic_resurface_evaluate",
    );
    assert.equal(jobsAfterFirst[0]?.subjectId, "G");

    now = "2026-09-23T04:00:30.000Z";
    assert.deepEqual(await opportunity.offer({ userId }), {
      outcome: "not_due",
      lastAttemptAt: "2026-09-23T04:00:00.000Z",
      nextEligibleAt: "2026-09-23T04:01:00.000Z",
    });

    now = "2026-09-23T04:01:00.000Z";
    const dueAgain = await opportunity.offer({ userId });
    assert.equal(dueAgain.outcome, "attempted");
    if (dueAgain.outcome !== "attempted") {
      throw new Error("expected second Topic opportunity attempt");
    }
    assert.equal(dueAgain.result.outcome, "waiting");

    const jobsAfterWaiting = await database.db
      .select({ id: nativeLiveBackgroundModelJobs.id })
      .from(nativeLiveBackgroundModelJobs)
      .where(eq(nativeLiveBackgroundModelJobs.userId, userId));
    assert.equal(jobsAfterWaiting.length, 1);

    now = "2026-09-23T04:01:01.000Z";
    assert.equal(
      (await opportunity.offer({ userId })).outcome,
      "not_due",
    );
  },
);
