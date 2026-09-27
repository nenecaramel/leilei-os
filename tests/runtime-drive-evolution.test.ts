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
import type {
  MindSemanticGroupingService,
} from "../src/domains/runtime/mind-semantic-grouping.js";

const policy: DriveEvolutionPolicy = {
  basePressure: 0.4,
  reinforcementBoost: 0.2,
  activeThreshold: 0.1,
  dormantAfterSatisfiedHours: 24,
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

test("later reinforcement can reactivate a dormant Drive", async () => {
  const anchorId = "11111111-1111-4111-8111-111111111111";
  const satisfiedPayload = writeDriveEvolution(null, {
    phase: "dormant",
    role: "anchor",
    threadKey: driveThreadKey("keep exploring"),
    anchorStateId: anchorId,
    pressure: 0,
    reinforcementCount: 2,
    reinforcementSources: ["m1", "m2"],
    satisfactionTotal: 0.65,
    lastEvolvedAt: "2026-09-22T12:00:00.000Z",
    lastReinforcedAt: "2026-09-22T11:00:00.000Z",
    lastSatisfiedAt: "2026-09-22T12:00:00.000Z",
    dormantAt: "2026-09-22T13:00:00.000Z",
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
  assert.ok(Math.abs(anchor.evolution.pressure - 0.15) < 1e-9);
  assert.equal(anchor.evolution.phase, "active");
  assert.equal(anchor.evolution.dormantAt, null);
  assert.equal(anchor.evolution.satisfactionTotal, 0.65);
});


test("satisfied Drive becomes dormant only after the configured inactivity window", async () => {
  const anchorId = "44444444-4444-4444-8444-444444444444";
  const satisfiedPayload = writeDriveEvolution(null, {
    phase: "satisfied",
    role: "anchor",
    threadKey: driveThreadKey("finish the runtime cleanup"),
    anchorStateId: anchorId,
    pressure: 0,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    satisfactionTotal: 0.5,
    lastEvolvedAt: "2026-09-22T12:00:00.000Z",
    lastReinforcedAt: "2026-09-22T10:00:00.000Z",
    lastSatisfiedAt: "2026-09-22T12:00:00.000Z",
    dormantAt: null,
  });
  const port = new Port([
    candidate(
      anchorId,
      "finish the runtime cleanup",
      "m1",
      "2026-09-22T10:00:00.000Z",
      satisfiedPayload,
    ),
  ]);
  const service = new DriveEvolutionService(port, policy);

  const before = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-23T11:59:59.000Z",
  });
  assert.equal(before.satisfied, 1);
  assert.equal(before.dormant, 0);
  assert.equal(port.updates[0]?.evolution.phase, "satisfied");
  assert.equal(port.updates[0]?.evolution.dormantAt, null);

  port.updates = [];
  const after = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-23T12:00:00.000Z",
  });
  assert.equal(after.satisfied, 0);
  assert.equal(after.dormant, 1);
  assert.equal(port.updates[0]?.evolution.phase, "dormant");
  assert.equal(
    port.updates[0]?.evolution.dormantAt,
    "2026-09-23T12:00:00.000Z",
  );
});

test("Drive dormancy remains disabled when no dormancy window is configured", async () => {
  const anchorId = "55555555-5555-4555-8555-555555555555";
  const satisfiedPayload = {
    drive_v1: {
      phase: "satisfied",
      role: "anchor",
      threadKey: driveThreadKey("keep this explicit"),
      anchorStateId: anchorId,
      pressure: 0,
      reinforcementCount: 1,
      reinforcementSources: ["m1"],
      satisfactionTotal: 0.5,
      lastEvolvedAt: "2026-09-01T12:00:00.000Z",
      lastReinforcedAt: "2026-09-01T10:00:00.000Z",
      lastSatisfiedAt: "2026-09-01T12:00:00.000Z",
    },
  };
  const port = new Port([
    candidate(
      anchorId,
      "keep this explicit",
      "m1",
      "2026-09-01T10:00:00.000Z",
      satisfiedPayload,
    ),
  ]);
  const service = new DriveEvolutionService(port, {
    basePressure: 0.4,
    reinforcementBoost: 0.2,
    activeThreshold: 0.1,
    minEvolutionIntervalHours: 6,
    maxReinforcementSources: 16,
  });

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-20T12:00:00.000Z",
  });

  assert.equal(result.satisfied, 1);
  assert.equal(result.dormant, 0);
  assert.equal(port.updates[0]?.evolution.phase, "satisfied");
  assert.equal(port.updates[0]?.evolution.dormantAt, null);
});


test("durable satisfaction projection overrides stale cached Drive satisfaction after branch repair", async () => {
  const anchorId = "99999999-9999-4999-8999-999999999999";
  const stale = writeDriveEvolution(null, {
    phase: "satisfied",
    role: "anchor",
    threadKey: driveThreadKey("repair this drive"),
    anchorStateId: anchorId,
    pressure: 0,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    satisfactionTotal: 1,
    lastEvolvedAt: "2026-09-26T10:00:00.000Z",
    lastReinforcedAt: "2026-09-26T09:00:00.000Z",
    lastSatisfiedAt: "2026-09-26T10:00:00.000Z",
    dormantAt: null,
  });
  const port = new Port([{
    ...candidate(
      anchorId,
      "repair this drive",
      "m1",
      "2026-09-26T09:00:00.000Z",
      stale,
    ),
    durableSatisfactionTotal: 0,
    durableLastSatisfiedAt: null,
  }]);
  const service = new DriveEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-27T00:00:00.000Z",
  });

  assert.equal(result.active, 1);
  assert.equal(port.updates[0]?.evolution.satisfactionTotal, 0);
  assert.equal(port.updates[0]?.evolution.pressure, 0.4);
  assert.equal(port.updates[0]?.evolution.lastSatisfiedAt, null);
});

test("Drive dormancy policy rejects a non-positive window", () => {
  assert.throws(
    () => new DriveEvolutionService(new Port([]), {
      ...policy,
      dormantAfterSatisfiedHours: 0,
    }),
    /dormant-after-satisfied hours must be positive/,
  );
});


test("fresh reinforcement postpones dormancy even when pressure stays satisfied", async () => {
  const anchorId = "66666666-6666-4666-8666-666666666666";
  const satisfiedPayload = writeDriveEvolution(null, {
    phase: "satisfied",
    role: "anchor",
    threadKey: driveThreadKey("ship the cleanup"),
    anchorStateId: anchorId,
    pressure: 0,
    reinforcementCount: 1,
    reinforcementSources: ["m1"],
    satisfactionTotal: 1,
    lastEvolvedAt: "2026-09-20T12:00:00.000Z",
    lastReinforcedAt: "2026-09-20T10:00:00.000Z",
    lastSatisfiedAt: "2026-09-20T12:00:00.000Z",
    dormantAt: null,
  });
  const port = new Port([
    candidate(
      anchorId,
      "ship the cleanup",
      "m1",
      "2026-09-20T10:00:00.000Z",
      satisfiedPayload,
    ),
    candidate(
      "77777777-7777-4777-8777-777777777777",
      "ship the cleanup",
      "m2",
      "2026-09-23T11:00:00.000Z",
    ),
  ]);
  const service = new DriveEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-23T12:00:00.000Z",
  });

  assert.equal(result.satisfied, 1);
  assert.equal(result.dormant, 0);
  assert.equal(port.updates[0]?.evolution.phase, "satisfied");
  assert.equal(
    port.updates[0]?.evolution.lastReinforcedAt,
    "2026-09-23T11:00:00.000Z",
  );
});


test("Drive semantic grouping can merge a paraphrase into an older thread without blocking exact initialization", async () => {
  const anchorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const anchorText = "finish the runtime cleanup";
  const anchorPayload = writeDriveEvolution(null, {
    phase: "active",
    role: "anchor",
    threadKey: driveThreadKey(anchorText),
    anchorStateId: anchorId,
    pressure: 0.4,
    reinforcementCount: 1,
    reinforcementSources: ["source-1"],
    satisfactionTotal: 0,
    lastEvolvedAt: "2026-09-26T10:00:00.000Z",
    lastReinforcedAt: "2026-09-26T10:00:00.000Z",
    lastSatisfiedAt: null,
    dormantAt: null,
  });
  const paraphraseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const paraphraseText = "complete the backend cleanup";
  const port = new Port([
    candidate(anchorId, anchorText, "source-1", "2026-09-26T10:00:00.000Z", anchorPayload),
    candidate(paraphraseId, paraphraseText, "source-2", "2026-09-27T00:00:00.000Z"),
  ]);
  const semanticGrouping = {
    async reconcile(input: Parameters<MindSemanticGroupingService["reconcile"]>[0]) {
      return {
        canonicalThreadKeyByThread: new Map([
          [driveThreadKey(paraphraseText), driveThreadKey(anchorText)],
        ]),
        staged: 0,
      };
    },
  };
  const service = new DriveEvolutionService(
    port,
    policy,
    semanticGrouping,
  );

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-27T00:00:00.000Z",
  });

  assert.equal(result.threads, 1);
  const anchor = port.updates.find((update) => update.stateId === anchorId);
  const reinforcement = port.updates.find((update) => update.stateId === paraphraseId);
  assert.equal(anchor?.evolution.reinforcementCount, 2);
  assert.equal(anchor?.evolution.pressure, 0.6);
  assert.equal(reinforcement?.evolution.role, "reinforcement");
  assert.equal(reinforcement?.evolution.anchorStateId, anchorId);
  assert.equal(reinforcement?.evolution.threadKey, driveThreadKey(anchorText));
});
