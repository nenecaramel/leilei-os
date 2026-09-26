
import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundLoopOrchestrator,
} from "../src/domains/runtime/background-loop-orchestrator.js";
import {
  SubjectStateBackgroundMaintenance,
} from "../src/domains/runtime/subject-state-background-maintenance.js";
import {
  BackgroundOpportunityPolicy,
} from "../src/domains/runtime/background-opportunity-policy.js";

test("Subject State maintenance adapts existing decay/evolution services onto one shared Subject mutex", async () => {
  const calls: string[] = [];
  const orchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 8,
    maxCostPerCycle: 8,
    maxConcurrent: 4,
  });

  const runner = (name: string) => ({
    async runOnce(input: {
      userId: string;
      subjectId: string;
      now: string;
      limit?: number;
    }) {
      calls.push(
        name
        + ":"
        + input.userId
        + ":"
        + input.subjectId
        + ":"
        + input.now
        + ":"
        + String(input.limit ?? "none"),
      );
    },
  });

  const maintenance = new SubjectStateBackgroundMaintenance(
    orchestrator,
    "G",
    {
      decay: runner("decay"),
      thoughtEvolution: runner("thought"),
      driveEvolution: runner("drive"),
      curiosityTopicProjection: runner("curiosity"),
      topicEvolution: runner("topic"),
      mindRetirement: runner("retirement"),
    },
    {
      decay: {
        priority: "maintenance",
        cost: 1,
        limit: 20,
      },
      thoughtEvolution: {
        priority: "maintenance",
        cost: 1,
        limit: 30,
      },
      driveEvolution: {
        priority: "maintenance",
        cost: 1,
        limit: 40,
      },
      topicLifecycle: {
        priority: "maintenance",
        cost: 1,
        limit: 50,
      },
      mindRetirement: {
        priority: "maintenance",
        cost: 1,
        limit: 60,
      },
    },
    () => "2026-09-23T06:30:00+00:00",
  );

  maintenance.schedule({ userId: "u1" });
  const summary = await orchestrator.drain();

  assert.equal(summary?.runsStarted, 5);
  assert.equal(summary?.completed, 5);
  assert.deepEqual(calls, [
    "decay:u1:G:2026-09-23T06:30:00.000Z:20",
    "thought:u1:G:2026-09-23T06:30:00.000Z:30",
    "drive:u1:G:2026-09-23T06:30:00.000Z:40",
    "curiosity:u1:G:2026-09-23T06:30:00.000Z:50",
    "topic:u1:G:2026-09-23T06:30:00.000Z:50",
    "retirement:u1:G:2026-09-23T06:30:00.000Z:60",
  ]);
});

test("Topic lifecycle keeps Curiosity projection before Topic evolution inside one job", async () => {
  const calls: string[] = [];
  const orchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 1,
    maxCostPerCycle: 1,
    maxConcurrent: 2,
  });

  const maintenance = new SubjectStateBackgroundMaintenance(
    orchestrator,
    "G",
    {
      curiosityTopicProjection: {
        async runOnce() {
          calls.push("curiosity");
        },
      },
      topicEvolution: {
        async runOnce() {
          calls.push("topic");
        },
      },
    },
    {
      topicLifecycle: {
        priority: "maintenance",
        cost: 1,
      },
    },
  );

  maintenance.schedule({ userId: "u1" });
  await orchestrator.drain();
  assert.deepEqual(calls, ["curiosity", "topic"]);
});

test("Subject State maintenance requires explicit plans instead of inventing cadence or cost", () => {
  const orchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 1,
    maxCostPerCycle: 1,
    maxConcurrent: 1,
  });

  assert.throws(
    () => new SubjectStateBackgroundMaintenance(
      orchestrator,
      "G",
      {
        decay: {
          async runOnce() {},
        },
      },
      {},
    ),
    /both runner and explicit plan/,
  );

  assert.throws(
    () => new SubjectStateBackgroundMaintenance(
      orchestrator,
      "G",
      {},
      {
        decay: {
          priority: "maintenance",
          cost: 1,
        },
      },
    ),
    /both runner and explicit plan/,
  );
});


test("Subject State maintenance can schedule only the pulse-selected loop kinds", async () => {
  const calls: string[] = [];
  const orchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 4,
    maxCostPerCycle: 4,
    maxConcurrent: 1,
  });
  const runner = (name: string) => ({
    async runOnce() {
      calls.push(name);
    },
  });
  const maintenance = new SubjectStateBackgroundMaintenance(
    orchestrator,
    "G",
    {
      decay: runner("decay"),
      thoughtEvolution: runner("thought"),
      driveEvolution: runner("drive"),
      topicEvolution: runner("topic"),
    },
    {
      decay: { priority: "maintenance", cost: 1 },
      thoughtEvolution: { priority: "maintenance", cost: 1 },
      driveEvolution: { priority: "maintenance", cost: 1 },
      topicLifecycle: { priority: "maintenance", cost: 1 },
    },
  );

  maintenance.schedule({
    userId: "u1",
    kinds: ["thought_evolution", "topic_lifecycle"],
  });
  await orchestrator.drain();

  assert.deepEqual(calls, ["thought", "topic"]);
});


test("Mind retirement requires both an explicit runner and an explicit maintenance plan", () => {
  const orchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 1,
    maxCostPerCycle: 1,
    maxConcurrent: 1,
  });

  assert.throws(
    () => new SubjectStateBackgroundMaintenance(
      orchestrator,
      "G",
      {
        mindRetirement: {
          async runOnce() {},
        },
      },
      {},
    ),
    /mindRetirement requires both runner and explicit plan/,
  );

  assert.throws(
    () => new SubjectStateBackgroundMaintenance(
      orchestrator,
      "G",
      {},
      {
        mindRetirement: {
          priority: "maintenance",
          cost: 1,
        },
      },
    ),
    /mindRetirement requires both runner and explicit plan/,
  );
});

test("Mind retirement is not scheduled when the caller does not select it", async () => {
  const calls: string[] = [];
  const orchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 2,
    maxCostPerCycle: 2,
    maxConcurrent: 1,
  });
  const maintenance = new SubjectStateBackgroundMaintenance(
    orchestrator,
    "G",
    {
      mindRetirement: {
        async runOnce() {
          calls.push("retirement");
        },
      },
    },
    {
      mindRetirement: {
        priority: "maintenance",
        cost: 1,
      },
    },
  );

  maintenance.schedule({
    userId: "u1",
    kinds: [],
  });
  await orchestrator.drain();
  assert.deepEqual(calls, []);

  maintenance.schedule({
    userId: "u1",
    kinds: ["mind_retirement"],
  });
  await orchestrator.drain();
  assert.deepEqual(calls, ["retirement"]);
});
