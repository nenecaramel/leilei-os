import "dotenv/config";
import assert from "node:assert/strict";
import { and, asc, eq, gte } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  nativeLiveBackgroundModelJobs,
  runtimeSubjectStates,
} from "../src/database/schema.js";
import {
  DrizzleSubjectStateRuntimePort,
} from "../src/domains/runtime/subject-state-runtime-repository.js";
import {
  DrizzleTopicResurfaceCandidatePort,
} from "../src/domains/runtime/topic-resurface-candidate-runtime-repository.js";
import {
  TopicResurfaceCandidateService,
} from "../src/domains/runtime/topic-resurface-candidates.js";
import {
  topicThreadKey,
  writeTopicEvolution,
} from "../src/domains/runtime/topic-evolution.js";
import {
  topicResurfaceThoughtStateId,
} from "../src/domains/runtime/topic-resurface-thought-materialization.js";
import type {
  SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";

const databaseUrl = process.env.DATABASE_URL;
const userId = process.env.MCP_USER_ID;
assert.ok(
  databaseUrl,
  "DATABASE_URL is required. Run through `railway run -s leilei-os -e production ...`.",
);
assert.ok(
  userId,
  "MCP_USER_ID is required. Run through `railway run -s leilei-os -e production ...`.",
);

const subjectId = "G";
const database = createDatabase(databaseUrl);
const topicId =
  "00000000-0000-4000-8000-" + crypto.randomUUID().replace(/-/gu, "").slice(0, 12);
const evidenceId = "production-topic-acceptance:" + crypto.randomUUID();
const thoughtId = topicResurfaceThoughtStateId(topicId, evidenceId);
const startedAt = new Date();

function acceptanceTopic(): SubjectStateWrite {
  const now = new Date();
  const reinforcedAt = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1_000);
  const dormantAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1_000);
  const text =
    "Internal background reflection should revisit unresolved dormant topics only when quiet, and preserve a genuinely new durable observation rather than mechanically repeating the topic.";

  return {
    id: topicId,
    kind: "topic",
    text,
    payload: writeTopicEvolution(null, {
      phase: "dormant",
      role: "anchor",
      threadKey: topicThreadKey(text),
      anchorStateId: topicId,
      reinforcementCount: 2,
      reinforcementSources: [evidenceId],
      lastEvolvedAt: dormantAt.toISOString(),
      lastReinforcedAt: reinforcedAt.toISOString(),
      dormantAt: dormantAt.toISOString(),
    }),
    envelope: {
      semanticActor: { kind: "subject", id: subjectId },
      producer: { kind: "process", id: "production-acceptance" },
      committer: { kind: "runtime", id: "leileios-runtime" },
      authority: "subject_authorized",
      scope: {
        userId,
        subjectId,
        applicability: "global",
        conversationId: null,
        pathHeadMessageId: null,
        visibility: "subject_private",
        sensitivity: "normal",
        audience: [subjectId],
      },
      status: {
        generationStatus: "committed",
        presentationStatus: "not_presented",
        pathStatus: "current",
        settlementStatus: "settled",
        validityStatus: "valid",
      },
      provenance: {
        sources: [{ kind: "decision", id: evidenceId }],
        causedBy: evidenceId,
        derivedFrom: [],
        decisionId: null,
        processRunId: null,
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "production-topic-resurface-acceptance-v1",
        processVersion: "production-topic-resurface-acceptance-v1",
        model: null,
      },
    },
  };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function payloadContainsTopic(
  payload: Record<string, unknown> | null,
): boolean {
  if (!payload) return false;
  const candidate = payload.candidate;
  if (
    candidate
    && typeof candidate === "object"
    && !Array.isArray(candidate)
    && (candidate as Record<string, unknown>).stateId === topicId
  ) {
    return true;
  }
  const candidates = payload.candidates;
  return Array.isArray(candidates)
    && candidates.some(
      (item) =>
        item
        && typeof item === "object"
        && !Array.isArray(item)
        && (item as Record<string, unknown>).stateId === topicId,
    );
}

async function cleanup(workflowRunId: string | null) {
  if (workflowRunId) {
    await database.db
      .delete(nativeLiveBackgroundModelJobs)
      .where(eq(nativeLiveBackgroundModelJobs.workflowRunId, workflowRunId));
  }
  await database.db
    .delete(runtimeSubjectStates)
    .where(eq(runtimeSubjectStates.id, thoughtId));
  await database.db
    .delete(runtimeSubjectStates)
    .where(eq(runtimeSubjectStates.id, topicId));
}

let seeded = false;
let workflowRunId: string | null = null;
let acceptanceCompleted = false;

try {
  const candidates = new TopicResurfaceCandidateService(
    new DrizzleTopicResurfaceCandidatePort(database.db),
  );
  const before = await candidates.list({
    userId,
    subjectId,
    limit: 5,
  });
  if (before.candidates.length !== 0) {
    throw new Error(
      "Production already has eligible dormant Topic candidates; acceptance refuses to mix test data with real dormant Topics.",
    );
  }

  await new DrizzleSubjectStateRuntimePort(database.db).append({
    userId,
    subjectId,
    states: [acceptanceTopic()],
  });
  seeded = true;

  const after = await candidates.list({
    userId,
    subjectId,
    limit: 5,
  });
  assert.deepEqual(
    after.candidates.map((candidate) => candidate.stateId),
    [topicId],
    "Acceptance Topic must be the sole eligible candidate.",
  );

  process.stdout.write(
    JSON.stringify({
      phase: "seeded",
      topicId,
      waitingFor: "Mac daemon + Railway Topic opportunity",
    }) + "\n",
  );

  const discoveryDeadline = Date.now() + 120_000;

  while (Date.now() < discoveryDeadline && !workflowRunId) {
    const rows = await database.db
      .select({
        workflowRunId: nativeLiveBackgroundModelJobs.workflowRunId,
        workflowPayload: nativeLiveBackgroundModelJobs.workflowPayload,
      })
      .from(nativeLiveBackgroundModelJobs)
      .where(
        and(
          eq(nativeLiveBackgroundModelJobs.userId, userId),
          eq(nativeLiveBackgroundModelJobs.workflowKind, "topic_resurface"),
          gte(nativeLiveBackgroundModelJobs.createdAt, startedAt),
        ),
      )
      .orderBy(asc(nativeLiveBackgroundModelJobs.createdAt));

    workflowRunId =
      rows.find((row) => payloadContainsTopic(row.workflowPayload))
        ?.workflowRunId ?? null;

    if (!workflowRunId) await sleep(1_000);
  }

  assert.ok(
    workflowRunId,
    "No production Topic resurface workflow was staged within 120 seconds.",
  );

  process.stdout.write(
    JSON.stringify({
      phase: "workflow_staged",
      workflowRunId,
    }) + "\n",
  );

  const finishDeadline = Date.now() + 180_000;
  let finalRows:
    | Array<{
        taskKind: string;
        status: string;
        resultText: string | null;
        errorCode: string | null;
        consumedAt: Date | null;
      }>
    | null = null;

  while (Date.now() < finishDeadline) {
    const rows = await database.db
      .select({
        taskKind: nativeLiveBackgroundModelJobs.taskKind,
        status: nativeLiveBackgroundModelJobs.status,
        resultText: nativeLiveBackgroundModelJobs.resultText,
        errorCode: nativeLiveBackgroundModelJobs.errorCode,
        consumedAt: nativeLiveBackgroundModelJobs.consumedAt,
      })
      .from(nativeLiveBackgroundModelJobs)
      .where(
        eq(nativeLiveBackgroundModelJobs.workflowRunId, workflowRunId),
      )
      .orderBy(asc(nativeLiveBackgroundModelJobs.createdAt));

    const evaluateCompleted = rows.some(
      (row) =>
        row.taskKind === "topic_resurface_evaluate"
        && (row.status === "completed" || row.status === "failed"),
    );
    const hasOpen = rows.some(
      (row) =>
        row.status === "pending"
        || row.status === "reserved"
        || (
          (row.status === "completed" || row.status === "failed")
          && row.consumedAt === null
        ),
    );

    if (evaluateCompleted && !hasOpen) {
      finalRows = rows;
      break;
    }
    await sleep(1_000);
  }

  assert.ok(
    finalRows,
    "Production Topic resurface workflow did not reach a consumed terminal state within 180 seconds.",
  );

  const thought = await database.db
    .select({
      id: runtimeSubjectStates.id,
      text: runtimeSubjectStates.text,
    })
    .from(runtimeSubjectStates)
    .where(eq(runtimeSubjectStates.id, thoughtId))
    .limit(1);

  const summary = finalRows.map((row) => ({
    taskKind: row.taskKind,
    status: row.status,
    errorCode: row.errorCode,
    result:
      row.resultText && row.resultText.length <= 500
        ? row.resultText
        : row.resultText
          ? row.resultText.slice(0, 500)
          : null,
  }));

  process.stdout.write(
    JSON.stringify({
      phase: "accepted",
      workflowRunId,
      stages: summary,
      derivedThought: thought[0]
        ? { id: thought[0].id, text: thought[0].text }
        : null,
    }) + "\n",
  );

  acceptanceCompleted = true;
  await cleanup(workflowRunId);
  process.stdout.write(
    JSON.stringify({
      phase: "cleaned",
      topicId,
      thoughtId,
      workflowRunId,
    }) + "\n",
  );
} catch (error) {
  if (seeded && !workflowRunId) {
    await cleanup(null);
  }
  process.stderr.write(
    JSON.stringify({
      phase: "failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
      topicId,
      thoughtId,
      workflowRunId,
      cleanup:
        !seeded
          ? "not_needed"
          : !workflowRunId
            ? "completed"
            : acceptanceCompleted
              ? "completed"
              : "deferred_to_avoid_racing_active_workflow",
    }) + "\n",
  );
  throw error;
} finally {
  await database.close();
}
