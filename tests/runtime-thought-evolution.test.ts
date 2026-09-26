import assert from "node:assert/strict";
import test from "node:test";
import {
  ThoughtEvolutionService,
  readThoughtEvolution,
  thoughtThreadKey,
  type ThoughtEvolutionCandidate,
  type ThoughtEvolutionPolicy,
  type ThoughtEvolutionUpdate,
} from "../src/domains/runtime/thought-evolution.js";

const policy: ThoughtEvolutionPolicy = {
  halfLifeHours: 168,
  baseStrength: 0.35,
  reinforcementBoost: 0.25,
  minEvolutionIntervalHours: 6,
  maxReinforcementSources: 16,
};

function candidate(
  stateId: string,
  text: string,
  sourceId: string,
  createdAt: string,
  payload: Record<string, unknown> | null = null,
): ThoughtEvolutionCandidate {
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
  updates: ThoughtEvolutionUpdate[] = [];

  constructor(
    public candidates: ThoughtEvolutionCandidate[],
  ) {}

  async listCandidates() {
    return this.candidates;
  }

  async applyUpdates(input: {
    updates: readonly ThoughtEvolutionUpdate[];
  }) {
    this.updates = [...input.updates];
    return {
      applied: input.updates.length,
      conflicts: 0,
    };
  }
}

test("a single settled Thought decays by its half-life", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "I want to understand this more deeply",
      "source-1",
      "2026-09-22T00:00:00.000Z",
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-29T00:00:00.000Z",
  });

  assert.equal(result.initialized, 1);
  assert.equal(port.updates.length, 1);
  const evolution = port.updates[0]?.evolution;
  assert.equal(evolution?.role, "anchor");
  assert.equal(evolution?.reinforcementCount, 1);
  assert.ok(Math.abs((evolution?.strength ?? 0) - 0.175) < 1e-9);
});

test("independent repeats reinforce one Thought thread without promoting a separate stage", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "I keep wondering how memory changes identity",
      "message-1",
      "2026-09-22T10:00:00.000Z",
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "  I keep wondering how memory changes identity  ",
      "message-2",
      "2026-09-22T11:00:00.000Z",
    ),
    candidate(
      "33333333-3333-4333-8333-333333333333",
      "I KEEP WONDERING HOW MEMORY CHANGES IDENTITY",
      "message-3",
      "2026-09-22T12:00:00.000Z",
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-22T12:00:00.000Z",
  });

  assert.equal(port.updates.length, 3);
  const anchor = port.updates.find(
    (update) => update.stateId === "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(anchor?.evolution.role, "anchor");
  assert.equal(anchor?.evolution.reinforcementCount, 3);
  assert.equal(anchor?.evolution.strength, 0.85);
  assert.equal(
    anchor?.evolution.threadKey,
    thoughtThreadKey("I keep wondering how memory changes identity"),
  );
  assert.equal("stage" in (anchor?.evolution ?? {}), false);

  const reinforcement = port.updates.find(
    (update) => update.stateId === "33333333-3333-4333-8333-333333333333",
  );
  assert.equal(reinforcement?.evolution.role, "reinforcement");
  assert.equal(
    reinforcement?.evolution.anchorStateId,
    "11111111-1111-4111-8111-111111111111",
  );
});

test("duplicate Thought writes from one source count as one reinforcement", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "same thought",
      "message-1",
      "2026-09-22T10:00:00.000Z",
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "same thought",
      "message-1",
      "2026-09-22T10:00:01.000Z",
    ),
    candidate(
      "33333333-3333-4333-8333-333333333333",
      "same thought",
      "message-2",
      "2026-09-22T11:00:00.000Z",
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-22T11:00:00.000Z",
  });

  assert.equal(port.updates[0]?.evolution.reinforcementCount, 2);
  assert.equal(port.updates[0]?.evolution.strength, 0.6);
});

test("legacy Fixation payload fields are ignored and Thought strength can decay again", async () => {
  const legacyPayload = {
    thought_v1: {
      stage: "fixation",
      role: "anchor",
      threadKey: thoughtThreadKey("sticky thought"),
      anchorStateId: "11111111-1111-4111-8111-111111111111",
      strength: 0.35,
      reinforcementCount: 1,
      reinforcementSources: ["m1"],
      lastEvolvedAt: "2026-09-22T12:00:00.000Z",
      lastReinforcedAt: "2026-09-22T12:00:00.000Z",
      fixationAt: "2026-09-22T12:00:00.000Z",
    },
  };
  const parsed = readThoughtEvolution(legacyPayload);
  assert.ok(parsed);
  assert.equal("stage" in parsed, false);
  assert.equal("fixationAt" in parsed, false);

  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "sticky thought",
      "m1",
      "2026-09-22T12:00:00.000Z",
      legacyPayload,
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-29T12:00:00.000Z",
  });

  assert.equal(result.decayed, 1);
  assert.equal(port.updates.length, 1);
  assert.ok(Math.abs((port.updates[0]?.evolution.strength ?? 0) - 0.175) < 1e-9);
  assert.equal("stage" in (port.updates[0]?.evolution ?? {}), false);
});
