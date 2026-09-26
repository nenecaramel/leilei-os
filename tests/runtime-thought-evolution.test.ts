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
  flitHalfLifeHours: 168,
  baseStrength: 0.35,
  reinforcementBoost: 0.25,
  fixationThreshold: 0.75,
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

test("a single settled Thought starts as a decaying Flit", async () => {
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
  assert.equal(result.fixations, 0);
  assert.equal(port.updates.length, 1);
  const evolution = port.updates[0]?.evolution;
  assert.equal(evolution?.stage, "flit");
  assert.equal(evolution?.role, "anchor");
  assert.equal(evolution?.reinforcementCount, 1);
  assert.ok(Math.abs((evolution?.strength ?? 0) - 0.175) < 1e-9);
});

test("three independently settled exact-thread Thoughts promote one anchor to Fixation", async () => {
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

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-22T12:00:00.000Z",
  });

  assert.equal(result.fixations, 1);
  assert.equal(port.updates.length, 3);

  const anchor = port.updates.find(
    (update) => update.stateId === "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(anchor?.evolution.stage, "fixation");
  assert.equal(anchor?.evolution.role, "anchor");
  assert.equal(anchor?.evolution.reinforcementCount, 3);
  assert.equal(anchor?.evolution.strength, 0.85);
  assert.equal(
    anchor?.evolution.threadKey,
    thoughtThreadKey("I keep wondering how memory changes identity"),
  );

  const reinforcement = port.updates.find(
    (update) => update.stateId === "33333333-3333-4333-8333-333333333333",
  );
  assert.equal(reinforcement?.evolution.role, "reinforcement");
  assert.equal(
    reinforcement?.evolution.anchorStateId,
    "11111111-1111-4111-8111-111111111111",
  );
});

test("duplicate Thought tags from the same source message count as one reinforcement", async () => {
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
  assert.equal(port.updates[0]?.evolution.stage, "flit");
  assert.equal(port.updates[0]?.evolution.strength, 0.6);
});

test("a promoted Fixation does not automatically demote during V1 decay", async () => {
  const fixationPayload = {
    thought_v1: {
      stage: "fixation",
      role: "anchor",
      threadKey: thoughtThreadKey("sticky thought"),
      anchorStateId: "11111111-1111-4111-8111-111111111111",
      strength: 0.85,
      reinforcementCount: 3,
      reinforcementSources: ["m1", "m2", "m3"],
      lastEvolvedAt: "2026-09-22T12:00:00.000Z",
      lastReinforcedAt: "2026-09-22T12:00:00.000Z",
      fixationAt: "2026-09-22T12:00:00.000Z",
    },
  };
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "sticky thought",
      "m1",
      "2026-09-20T12:00:00.000Z",
      fixationPayload,
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "sticky thought",
      "m2",
      "2026-09-21T12:00:00.000Z",
      {
        thought_v1: {
          ...(fixationPayload.thought_v1 as Record<string, unknown>),
          role: "reinforcement",
        },
      },
    ),
    candidate(
      "33333333-3333-4333-8333-333333333333",
      "sticky thought",
      "m3",
      "2026-09-22T12:00:00.000Z",
      {
        thought_v1: {
          ...(fixationPayload.thought_v1 as Record<string, unknown>),
          role: "reinforcement",
        },
      },
    ),
  ]);
  const service = new ThoughtEvolutionService(port, policy);

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-22T12:00:00.000Z",
  });

  assert.equal(result.fixations, 1);
  assert.equal(port.updates.length, 0);
  assert.equal(
    readThoughtEvolution(fixationPayload)?.stage,
    "fixation",
  );
});
