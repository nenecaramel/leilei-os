import assert from "node:assert/strict";
import test from "node:test";
import {
  DriveEvolutionService,
  driveThreadKey,
  writeDriveEvolution,
  type DriveEvolutionUpdate,
} from "../src/domains/runtime/drive-evolution.js";
import {
  ThoughtEvolutionService,
  thoughtThreadKey,
  writeThoughtEvolution,
  type ThoughtEvolutionUpdate,
} from "../src/domains/runtime/thought-evolution.js";
import {
  TopicEvolutionService,
  topicThreadKey,
  writeTopicEvolution,
  type TopicEvolutionUpdate,
} from "../src/domains/runtime/topic-evolution.js";

const oldAt = "2026-09-20T07:35:00.000Z";
const now = "2026-09-23T07:35:00.000Z";

test("settlement catch-up mode initializes new Drive evidence without periodic recalculation", async () => {
  let applied: readonly DriveEvolutionUpdate[] = [];
  const service = new DriveEvolutionService(
    {
      async listCandidates() {
        return [
          {
            stateId: "drive-old",
            text: "old drive",
            payload: writeDriveEvolution(null, {
              phase: "active",
              role: "anchor",
              threadKey: driveThreadKey("old drive"),
              anchorStateId: "drive-old",
              pressure: 0.4,
              reinforcementCount: 1,
              reinforcementSources: ["source-old"],
              satisfactionTotal: 0,
              lastEvolvedAt: oldAt,
              lastReinforcedAt: oldAt,
              lastSatisfiedAt: null,
            }),
            sourceId: "source-old",
            createdAt: oldAt,
            updatedAt: oldAt,
          },
          {
            stateId: "drive-new",
            text: "new drive",
            payload: null,
            sourceId: "source-new",
            createdAt: now,
            updatedAt: now,
          },
        ];
      },
      async applyUpdates(input) {
        applied = input.updates;
        return { applied: input.updates.length, conflicts: 0 };
      },
    },
    {
      basePressure: 0.4,
      reinforcementBoost: 0.2,
      activeThreshold: 0.1,
      minEvolutionIntervalHours: 1,
      maxReinforcementSources: 8,
    },
  );

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now,
    mode: "settlement_catch_up",
  });

  assert.deepEqual(
    applied.map((update) => [update.stateId, update.reason]),
    [["drive-new", "initialize"]],
  );
  assert.equal(result.recalculated, 0);
});

test("settlement catch-up mode initializes new Thought evidence without time decay", async () => {
  let applied: readonly ThoughtEvolutionUpdate[] = [];
  const service = new ThoughtEvolutionService(
    {
      async listCandidates() {
        return [
          {
            stateId: "thought-old",
            text: "old thought",
            payload: writeThoughtEvolution(null, {
              phase: "active",
              role: "anchor",
              threadKey: thoughtThreadKey("old thought"),
              anchorStateId: "thought-old",
              strength: 0.4,
              reinforcementCount: 1,
              reinforcementSources: ["source-old"],
              lastEvolvedAt: oldAt,
              lastReinforcedAt: oldAt,
              dormantAt: null,
            }),
            sourceId: "source-old",
            createdAt: oldAt,
            updatedAt: oldAt,
          },
          {
            stateId: "thought-new",
            text: "new thought",
            payload: null,
            sourceId: "source-new",
            createdAt: now,
            updatedAt: now,
          },
        ];
      },
      async applyUpdates(input) {
        applied = input.updates;
        return { applied: input.updates.length, conflicts: 0 };
      },
    },
    {
      halfLifeHours: 24,
      baseStrength: 0.4,
      reinforcementBoost: 0.2,
      dormantBelowStrength: 0.1,
      minEvolutionIntervalHours: 1,
      maxReinforcementSources: 8,
    },
  );

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now,
    mode: "settlement_catch_up",
  });

  assert.deepEqual(
    applied.map((update) => [update.stateId, update.reason]),
    [["thought-new", "initialize"]],
  );
  assert.equal(result.decayed, 0);
  assert.equal(result.dormantTransitions, 0);
});

test("settlement catch-up mode initializes new Topic evidence without dormancy maintenance", async () => {
  let applied: readonly TopicEvolutionUpdate[] = [];
  const service = new TopicEvolutionService(
    {
      async listCandidates() {
        return [
          {
            stateId: "topic-old",
            text: "old topic",
            payload: writeTopicEvolution(null, {
              phase: "active",
              role: "anchor",
              threadKey: topicThreadKey("old topic"),
              anchorStateId: "topic-old",
              reinforcementCount: 1,
              reinforcementSources: ["source-old"],
              lastEvolvedAt: oldAt,
              lastReinforcedAt: oldAt,
              dormantAt: null,
            }),
            sourceId: "source-old",
            createdAt: oldAt,
            updatedAt: oldAt,
          },
          {
            stateId: "topic-new",
            text: "new topic",
            payload: null,
            sourceId: "source-new",
            createdAt: now,
            updatedAt: now,
          },
        ];
      },
      async applyUpdates(input) {
        applied = input.updates;
        return { applied: input.updates.length, conflicts: 0 };
      },
    },
    {
      maxReinforcementSources: 8,
      dormantAfterHours: 24,
    },
  );

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now,
    mode: "settlement_catch_up",
  });

  assert.deepEqual(
    applied.map((update) => [update.stateId, update.reason]),
    [["topic-new", "initialize"]],
  );
  assert.equal(result.dormantTransitions, 0);
});
