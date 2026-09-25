import "dotenv/config";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { runtimeSubjectStates } from "../src/database/schema.js";
import {
  DrizzleMemoryLifecycleRuntimePort,
} from "../src/domains/runtime/memory-lifecycle-runtime-repository.js";
import {
  MemoryLifecycleService,
  readSubjectStateLifecycle,
} from "../src/domains/runtime/memory-lifecycle.js";
import {
  DrizzleSubjectStateRuntimePort,
} from "../src/domains/runtime/subject-state-runtime-repository.js";
import type {
  SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";

assert.equal(
  process.env.RUN_PRODUCTION_TRUE_FORGETTING_ACCEPTANCE,
  "1",
  "Set RUN_PRODUCTION_TRUE_FORGETTING_ACCEPTANCE=1 explicitly.",
);

const databaseUrl = process.env.DATABASE_URL;
const userId = process.env.MCP_USER_ID;
assert.ok(
  databaseUrl,
  "DATABASE_URL is required. Run through Railway production variables.",
);
assert.ok(
  userId,
  "MCP_USER_ID is required. Run through Railway production variables.",
);

const database = createDatabase(databaseUrl);
const runId = crypto.randomUUID();
const subjectId = `acceptance:true-forgetting:${runId}`;
const stateIds = {
  memory: crypto.randomUUID(),
  feel: crypto.randomUUID(),
  protectedMemory: crypto.randomUUID(),
};
const allStateIds = Object.values(stateIds);
const marker = `true-forgetting-production-acceptance:${runId}`;

function acceptanceState(
  id: string,
  kind: "memory" | "feel",
  label: string,
): SubjectStateWrite {
  return {
    id,
    kind,
    text: `${marker}:${label}:secret-text-must-disappear`,
    payload: {
      acceptance_marker: marker,
      label,
      secret_payload_must_disappear: {
        value: `payload-${runId}-${label}`,
      },
    },
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
        sources: [{ kind: "decision", id: marker }],
        causedBy: marker,
        derivedFrom: [],
        decisionId: null,
        processRunId: runId,
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "true-forgetting-production-acceptance-v1",
        processVersion: "true-forgetting-production-acceptance-v1",
        model: null,
      },
    },
  };
}

async function readRows() {
  return database.db
    .select({
      id: runtimeSubjectStates.id,
      kind: runtimeSubjectStates.kind,
      text: runtimeSubjectStates.text,
      payload: runtimeSubjectStates.payload,
      envelope: runtimeSubjectStates.envelope,
      validityStatus: runtimeSubjectStates.validityStatus,
      subjectId: runtimeSubjectStates.subjectId,
    })
    .from(runtimeSubjectStates)
    .where(inArray(runtimeSubjectStates.id, allStateIds));
}

async function cleanup() {
  await database.db
    .delete(runtimeSubjectStates)
    .where(inArray(runtimeSubjectStates.id, allStateIds));
}

let seeded = false;
try {
  const existing = await readRows();
  assert.equal(existing.length, 0, "Disposable state IDs unexpectedly exist.");

  const subjectPort = new DrizzleSubjectStateRuntimePort(database.db);
  await subjectPort.append({
    userId,
    subjectId,
    states: [
      acceptanceState(stateIds.memory, "memory", "memory"),
      acceptanceState(stateIds.feel, "feel", "feel"),
      acceptanceState(
        stateIds.protectedMemory,
        "memory",
        "protected-memory",
      ),
    ],
  });
  seeded = true;

  let rows = await readRows();
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.subjectId, subjectId);
    assert.equal(row.validityStatus, "valid");
    assert.match(row.text ?? "", /secret-text-must-disappear/u);
    assert.equal(row.payload?.acceptance_marker, marker);
  }

  const lifecyclePort =
    new DrizzleMemoryLifecycleRuntimePort(database.db);
  const forgetting = new MemoryLifecycleService(
    lifecyclePort,
    {
      halfLifeHours: { memory: 24, feel: 12 },
      fadingThreshold: 0.7,
      archiveThreshold: 0.2,
      forgetAfterHours: 0,
      purgeAfterHours: 24,
    },
  );

  const archivedAt = new Date().toISOString();
  assert.equal(
    await forgetting.setProtected({
      userId,
      subjectId,
      stateId: stateIds.protectedMemory,
      protected: true,
      at: archivedAt,
    }),
    true,
  );
  for (const stateId of allStateIds) {
    assert.equal(
      await forgetting.archive({
        userId,
        subjectId,
        stateId,
        at: archivedAt,
      }),
      true,
    );
  }

  const archivedCandidates = await lifecyclePort.listCandidates({
    userId,
    subjectId,
    limit: 10,
  });
  assert.equal(archivedCandidates.length, 3);

  const forgottenRun = await forgetting.runOnce({
    userId,
    subjectId,
    now: new Date(Date.parse(archivedAt) + 1_000).toISOString(),
    limit: 10,
  });
  assert.equal(forgottenRun.forgotten, 2);
  assert.equal(forgottenRun.purged, 0);
  assert.equal(forgottenRun.conflicts, 0);

  rows = await readRows();
  assert.equal(rows.length, 3);

  for (const stateId of [stateIds.memory, stateIds.feel]) {
    const row = rows.find((candidate) => candidate.id === stateId);
    assert.ok(row);
    assert.equal(row.text, null);
    assert.equal(row.validityStatus, "tombstoned");
    assert.deepEqual(Object.keys(row.payload ?? {}), ["lifecycle_v1"]);
    const lifecycle = readSubjectStateLifecycle(row.payload);
    assert.ok(lifecycle);
    assert.equal(lifecycle.status, "forgotten");
    assert.equal(lifecycle.salience, 0);
    assert.equal(lifecycle.protected, false);
    const envelopeStatus =
      row.envelope.status as Record<string, unknown> | undefined;
    assert.equal(envelopeStatus?.validityStatus, "tombstoned");
  }

  const protectedRow = rows.find(
    (candidate) => candidate.id === stateIds.protectedMemory,
  );
  assert.ok(protectedRow);
  assert.match(
    protectedRow.text ?? "",
    /secret-text-must-disappear/u,
  );
  assert.equal(protectedRow.validityStatus, "valid");
  assert.equal(protectedRow.payload?.acceptance_marker, marker);
  const protectedLifecycle =
    readSubjectStateLifecycle(protectedRow.payload);
  assert.ok(protectedLifecycle);
  assert.equal(protectedLifecycle.status, "archived");
  assert.equal(protectedLifecycle.protected, true);

  const validCandidatesAfterForget =
    await lifecyclePort.listCandidates({
      userId,
      subjectId,
      limit: 10,
    });
  assert.deepEqual(
    validCandidatesAfterForget.map((candidate) => candidate.stateId),
    [stateIds.protectedMemory],
  );
  const forgottenCandidates =
    await lifecyclePort.listForgottenCandidates({
      userId,
      subjectId,
      limit: 10,
    });
  assert.deepEqual(
    new Set(forgottenCandidates.map((candidate) => candidate.stateId)),
    new Set([stateIds.memory, stateIds.feel]),
  );

  process.stdout.write(
    JSON.stringify({
      phase: "forgotten",
      runId,
      subjectId,
      scrubbedKinds: ["memory", "feel"],
      tombstoned: 2,
      protectedArchivedRetained: true,
    }) + "\n",
  );

  const purging = new MemoryLifecycleService(
    lifecyclePort,
    {
      halfLifeHours: { memory: 24, feel: 12 },
      fadingThreshold: 0.7,
      archiveThreshold: 0.2,
      forgetAfterHours: 0,
      purgeAfterHours: 0,
    },
  );
  const purgedRun = await purging.runOnce({
    userId,
    subjectId,
    now: new Date(Date.parse(archivedAt) + 2_000).toISOString(),
    limit: 10,
  });
  assert.equal(purgedRun.purged, 2);
  assert.equal(purgedRun.conflicts, 0);

  rows = await readRows();
  assert.deepEqual(
    rows.map((row) => row.id),
    [stateIds.protectedMemory],
  );
  assert.equal(rows[0]?.validityStatus, "valid");
  assert.equal(
    readSubjectStateLifecycle(rows[0]?.payload)?.protected,
    true,
  );

  process.stdout.write(
    JSON.stringify({
      phase: "accepted",
      runId,
      productionDatabase: true,
      memory: "scrubbed_then_purged",
      feel: "scrubbed_then_purged",
      protectedArchivedMemory: "not_forgotten",
      isolation: "unique_subject_id",
    }) + "\n",
  );
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      phase: "failed",
      runId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    }) + "\n",
  );
  throw error;
} finally {
  if (seeded) {
    await cleanup();
    const remaining = await readRows();
    assert.equal(
      remaining.length,
      0,
      "Production acceptance cleanup left disposable rows behind.",
    );
    process.stdout.write(
      JSON.stringify({
        phase: "cleaned",
        runId,
        deletedDisposableRows: allStateIds.length,
      }) + "\n",
    );
  }
  await database.close();
}
