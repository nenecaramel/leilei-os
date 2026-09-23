
import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundLoopOrchestrator,
} from "../src/domains/runtime/background-loop-orchestrator.js";
import {
  SubjectStateBackgroundMaintenance,
} from "../src/domains/runtime/subject-state-background-maintenance.js";

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
    },
    () => "2026-09-23T06:30:00+00:00",
  );

  maintenance.schedule({ userId: "u1" });
  const summary = await orchestrator.drain();

  assert.equal(summary?.runsStarted, 4);
  assert.equal(summary?.completed, 4);
  assert.deepEqual(calls, [
    "decay:u1:G:2026-09-23T06:30:00.000Z:20",
    "thought:u1:G:2026-09-23T06:30:00.000Z:30",
    "drive:u1:G:2026-09-23T06:30:00.000Z:40",
    "curiosity:u1:G:2026-09-23T06:30:00.000Z:50",
    "topic:u1:G:2026-09-23T06:30:00.000Z:50",
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
