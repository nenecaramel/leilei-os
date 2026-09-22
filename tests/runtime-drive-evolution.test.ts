import assert from "node:assert/strict";
import test from "node:test";
import {
  DriveEvolutionService,
  driveThreadKey,
  readDriveEvolution,
  writeDriveEvolution,
  type DriveEvolutionCandidate,
  type DriveEvolutionPolicy,
  type DriveEvolutionUpdate,
} from "../src/domains/runtime/drive-evolution.js";

const policy: DriveEvolutionPolicy = {
  basePressure: 0.4,
  reinforcementBoost: 0.2,
  activeThreshold: 0.1,
  minEvolutionIntervalHours: 6,
  maxReinforcementSources: 16,
};

function candidate(
  stateId: string,
  text: string,
  sourceId: string,
  createdAt: string,
  payload: Record<string, unknown> | null = null,
): DriveEvolutionCandidate {
  return {
    stateId,
    text,
    sourceId,
    createdAt,
    updatedAt: createdAt,
    payload,
  };
}

class Port {
  updates: DriveEvolutionUpdate[] = [];

  constructor(public candidates: DriveEvolutionCandidate[]) {}

  async listCandidates() {
    return this.candidates;
  }

  async applyUpdates(input: {
    updates: readonly DriveEvolutionUpdate[];
  }) {
    this.updates = [...input.updates];
    return {
      applied: input.updates.length,
      conflicts: 0,
    };
  }
}

test("one settled Drive starts as an active generic pressure without inventing dimensions", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "I want to keep understanding this system",
      "source-1",
      "2026-09-22T10:00:00.000Z",
    ),
  ]);
  const service = new DriveEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-22T10:00:00.000Z",
  });

  assert.equal(result.active, 1);
  assert.equal(result.initialized, 1);
  assert.equal(port.updates.length, 1);
  const drive = port.updates[0]?.evolution;
  assert.equal(drive?.phase, "active");
  assert.equal(drive?.role, "anchor");
  assert.equal(drive?.pressure, 0.4);
  assert.equal(drive?.reinforcementCount, 1);
  assert.equal(
    drive?.threadKey,
    driveThreadKey("I want to keep understanding this system"),
  );
});

test("independent settled repetitions strengthen the same Drive thread", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "I want to keep understanding this system",
      "source-1",
      "2026-09-22T10:00:00.000Z",
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "  I WANT TO KEEP UNDERSTANDING THIS SYSTEM  ",
      "source-2",
      "2026-09-22T11:00:00.000Z",
    ),
    candidate(
      "33333333-3333-4333-8333-333333333333",
      "I want to keep understanding this system",
      "source-3",
      "2026-09-22T12:00:00.000Z",
    ),
  ]);
  const service = new DriveEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-22T12:00:00.000Z",
  });

  assert.equal(result.active, 1);
  assert.equal(port.updates.length, 3);
  const anchor = port.updates.find(
    (update) => update.stateId === "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(anchor?.evolution.pressure, 0.8);
  assert.equal(anchor?.evolution.reinforcementCount, 3);
  assert.equal(anchor?.evolution.role, "anchor");
  assert.equal(
    port.updates.find(
      (update) => update.stateId === "33333333-3333-4333-8333-333333333333",
    )?.evolution.role,
    "reinforcement",
  );
});

test("duplicate Drive tags from one assistant message count as one reinforcement", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "same drive",
      "message-1",
      "2026-09-22T10:00:00.000Z",
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "same drive",
      "message-1",
      "2026-09-22T10:00:01.000Z",
    ),
    candidate(
      "33333333-3333-4333-8333-333333333333",
      "same drive",
      "message-2",
      "2026-09-22T11:00:00.000Z",
    ),
  ]);
  const service = new DriveEvolutionService(port, policy);
  await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-22T11:00:00.000Z",
  });

  assert.equal(port.updates[0]?.evolution.reinforcementCount, 2);
  assert.equal(port.updates[0]?.evolution.pressure, 0.6);
});

test("satisfaction stored on the anchor lowers pressure and later reinforcement can reactivate it", async () => {
  const anchorId = "11111111-1111-4111-8111-111111111111";
  const satisfiedPayload = writeDriveEvolution(null, {
    phase: "satisfied",
    role: "anchor",
    threadKey: driveThreadKey("keep exploring"),
    anchorStateId: anchorId,
    pressure: 0,
    reinforcementCount: 2,
    reinforcementSources: ["m1", "m2"],
    satisfactionTotal: 0.7,
    lastEvolvedAt: "2026-09-22T12:00:00.000Z",
    lastReinforcedAt: "2026-09-22T11:00:00.000Z",
    lastSatisfiedAt: "2026-09-22T12:00:00.000Z",
  });
  const port = new Port([
    candidate(
      anchorId,
      "keep exploring",
      "m1",
      "2026-09-22T10:00:00.000Z",
      satisfiedPayload,
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "keep exploring",
      "m2",
      "2026-09-22T11:00:00.000Z",
      writeDriveEvolution(null, {
        ...readDriveEvolution(satisfiedPayload)!,
        role: "reinforcement",
      }),
    ),
    candidate(
      "33333333-3333-4333-8333-333333333333",
      "keep exploring",
      "m3",
      "2026-09-23T10:00:00.000Z",
    ),
  ]);

  const service = new DriveEvolutionService(port, policy);
  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-23T10:00:00.000Z",
  });

  assert.equal(result.active, 1);
  const anchor = port.updates.find((update) => update.stateId === anchorId);
  assert.ok(anchor);
  assert.ok(Math.abs(anchor.evolution.pressure - 0.1) < 1e-9);
  assert.equal(anchor.evolution.phase, "active");
  assert.equal(anchor.evolution.satisfactionTotal, 0.7);
});
