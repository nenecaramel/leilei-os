import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  nativeLiveBackgroundModelJobs,
  nativeLiveRuntimeListenerLeases,
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
  topicResurfaceThoughtStateId,
} from "../src/domains/runtime/topic-resurface-thought-materialization.js";
import {
  topicThreadKey,
  writeTopicEvolution,
} from "../src/domains/runtime/topic-evolution.js";
import type {
  SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";

const enabled =
  process.env.RUN_RUNTIME_THOUGHT_DATABASE_TEST === "1";

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
        ruleVersion: "xdevice-test",
        processVersion: "xdevice-test",
        model: null,
      },
    },
  };
}

test(
  "cross-device Topic workflow survives DB handoff and materializes one derived Thought",
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
            .delete(nativeLiveRuntimeListenerLeases)
            .where(eq(nativeLiveRuntimeListenerLeases.userId, userId));
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
          `topic-xdevice-${crypto.randomUUID()}@example.com`,
        displayName: "Topic Cross Device",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const topicId = crypto.randomUUID();
    const evidenceId = "assistant-message-xdevice-source";
    const topicText = "后台思考和主动说话要保持分层";
    await new DrizzleSubjectStateRuntimePort(database.db).append({
      userId,
      subjectId: "G",
      states: [dormantTopic({
        id: topicId,
        userId,
        text: topicText,
        causedBy: evidenceId,
      })],
    });

    const listenerId = crypto.randomUUID();
    await database.db
      .insert(nativeLiveRuntimeListenerLeases)
      .values({
        userId,
        dispatchTarget: "claude_code",
        listenerInstanceId: listenerId,
        leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
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

    const started = await coordinator.start({
      userId,
      subjectId: "G",
      now: "2026-09-23T03:30:00.000Z",
      candidateLimit: 5,
    });
    assert.equal(started.outcome, "staged_evaluation");

    const evaluation = await queue.reserveNext({
      userId,
      listenerInstanceId: listenerId,
    });
    assert.ok(evaluation);
    await queue.submitResult({
      userId,
      listenerInstanceId: listenerId,
      taskId: evaluation.reservationId,
      result: {
        protocol_version: 1,
        task_id: evaluation.reservationId,
        task_kind: "topic_resurface_evaluate",
        status: "success",
        final_text: JSON.stringify({
          decision: "consider",
          state_id: topicId,
        }),
      },
    });
    assert.equal(
      (await coordinator.advanceNextForUser({ userId })).outcome,
      "staged_deliberation",
    );

    const deliberation = await queue.reserveNext({
      userId,
      listenerInstanceId: listenerId,
    });
    assert.ok(deliberation);
    await queue.submitResult({
      userId,
      listenerInstanceId: listenerId,
      taskId: deliberation.reservationId,
      result: {
        protocol_version: 1,
        task_id: deliberation.reservationId,
        task_kind: "topic_resurface_deliberate",
        status: "success",
        final_text: JSON.stringify({
          decision: "reflect",
          reflection:
            "内部 background thought 与外部 proactive speech 应继续分层。",
        }),
      },
    });
    assert.equal(
      (await coordinator.advanceNextForUser({ userId })).outcome,
      "staged_retention",
    );

    const retention = await queue.reserveNext({
      userId,
      listenerInstanceId: listenerId,
    });
    assert.ok(retention);
    await queue.submitResult({
      userId,
      listenerInstanceId: listenerId,
      taskId: retention.reservationId,
      result: {
        protocol_version: 1,
        task_id: retention.reservationId,
        task_kind: "topic_resurface_retention",
        status: "success",
        final_text: JSON.stringify({
          decision: "retain_as_thought_seed",
        }),
      },
    });

    const final = await coordinator.advanceNextForUser({ userId });
    const thoughtId = topicResurfaceThoughtStateId(
      topicId,
      evidenceId,
    );
    assert.deepEqual(final, {
      outcome: "materialized",
      runId: (started as Extract<
        typeof started,
        { outcome: "staged_evaluation" }
      >).runId,
      stateId: thoughtId,
    });

    const jobs = await database.db
      .select({
        status: nativeLiveBackgroundModelJobs.status,
        consumedAt: nativeLiveBackgroundModelJobs.consumedAt,
      })
      .from(nativeLiveBackgroundModelJobs)
      .where(eq(nativeLiveBackgroundModelJobs.userId, userId));
    assert.equal(jobs.length, 3);
    assert.equal(
      jobs.every(
        (job) =>
          job.status === "completed"
          && job.consumedAt instanceof Date,
      ),
      true,
    );

    const states = await new DrizzleSubjectStateRuntimePort(
      database.db,
    ).list({
      userId,
      subjectId: "G",
      conversationId: crypto.randomUUID(),
    });
    assert.equal(
      states.filter((state) => state.id === thoughtId).length,
      1,
    );
  },
);
