import assert from "node:assert/strict";
import test from "node:test";
import type {
  SubjectStateTransition,
} from "../src/domains/runtime/native-live-mind-loop-service.js";
import {
  SubjectStateSettlementCatchUp,
} from "../src/domains/runtime/subject-state-settlement-catch-up.js";

const now = "2026-09-23T07:35:00.000Z";

function settled(
  stateKind: SubjectStateTransition["stateKind"],
  stateId: string,
): SubjectStateTransition {
  return {
    stateId,
    stateKind,
    reason: "user_continued_current_path",
    settlementStatus: "settled",
    pathStatus: "current",
    validityStatus: "valid",
    promoteScopeToGlobal: true,
  };
}

test("settlement catch-up runs only derived processes needed by newly settled kinds", async () => {
  const calls: string[] = [];
  const runner = (name: string) => ({
    async runOnce(input: {
      userId: string;
      subjectId: string;
      now: string;
      mode?: "full" | "settlement_catch_up";
    }) {
      calls.push(
        name
        + ":" + input.userId
        + ":" + input.subjectId
        + ":" + input.now
        + ":" + String(input.mode),
      );
    },
  });

  const catchUp = new SubjectStateSettlementCatchUp(
    "G",
    {
      driveEvolution: runner("drive"),
      thoughtEvolution: runner("thought"),
      curiosityEvolution: runner("curiosity-evolution"),
      curiosityTopicProjection: runner("curiosity-projection"),
      topicEvolution: runner("topic"),
    },
    () => now,
  );

  await catchUp.run({
    userId: "u1",
    transitions: [
      settled("memory", "memory-1"),
      settled("drive", "drive-1"),
      settled("thought", "thought-1"),
      settled("curiosity", "curiosity-1"),
      settled("topic", "topic-1"),
    ],
  });

  assert.deepEqual(calls, [
    "drive:u1:G:2026-09-23T07:35:00.000Z:settlement_catch_up",
    "thought:u1:G:2026-09-23T07:35:00.000Z:settlement_catch_up",
    "curiosity-evolution:u1:G:2026-09-23T07:35:00.000Z:settlement_catch_up",
    "curiosity-projection:u1:G:2026-09-23T07:35:00.000Z:settlement_catch_up",
    "topic:u1:G:2026-09-23T07:35:00.000Z:settlement_catch_up",
  ]);
});

test("memory/feel settlement and superseded transitions do not invoke evolution catch-up", async () => {
  const calls: string[] = [];
  const catchUp = new SubjectStateSettlementCatchUp(
    "G",
    {
      thoughtEvolution: {
        async runOnce() {
          calls.push("thought");
        },
      },
    },
    () => now,
  );

  await catchUp.run({
    userId: "u1",
    transitions: [
      settled("memory", "memory-1"),
      settled("feel", "feel-1"),
      {
        stateId: "thought-old",
        stateKind: "thought",
        reason: "path_superseded",
        pathStatus: "superseded",
        validityStatus: "invalidated",
      },
    ],
  });

  assert.deepEqual(calls, []);
});

test("settlement catch-up is fail-soft per process and continues later required work", async () => {
  const calls: string[] = [];
  const catchUp = new SubjectStateSettlementCatchUp(
    "G",
    {
      driveEvolution: {
        async runOnce() {
          calls.push("drive");
          throw new Error("simulated drive catch-up failure");
        },
      },
      thoughtEvolution: {
        async runOnce() {
          calls.push("thought");
        },
      },
      curiosityEvolution: {
        async runOnce() {
          calls.push("curiosity-evolution");
        },
      },
      curiosityTopicProjection: {
        async runOnce() {
          calls.push("curiosity-projection");
          throw new Error("simulated curiosity projection failure");
        },
      },
      topicEvolution: {
        async runOnce() {
          calls.push("topic");
        },
      },
    },
    () => now,
  );

  await assert.doesNotReject(() =>
    catchUp.run({
      userId: "u1",
      transitions: [
        settled("drive", "drive-1"),
        settled("thought", "thought-1"),
        settled("curiosity", "curiosity-1"),
      ],
    })
  );
  assert.deepEqual(calls, [
    "drive",
    "thought",
    "curiosity-evolution",
    "curiosity-projection",
    "topic",
  ]);
});


test("replacement repair refreshes all derived Mind projections in full mode", async () => {
  const calls: string[] = [];
  const runner = (name: string) => ({
    async runOnce(input: { mode?: "full" | "settlement_catch_up" }) {
      calls.push(name + ":" + String(input.mode));
    },
  });
  const catchUp = new SubjectStateSettlementCatchUp(
    "G",
    {
      driveEvolution: runner("drive"),
      thoughtEvolution: runner("thought"),
      curiosityEvolution: runner("curiosity-evolution"),
      curiosityTopicProjection: runner("curiosity-projection"),
      topicEvolution: runner("topic"),
    },
    () => now,
  );

  await catchUp.refreshAfterReplacement({ userId: "u1" });

  assert.deepEqual(calls, [
    "drive:full",
    "thought:full",
    "curiosity-evolution:full",
    "curiosity-projection:full",
    "topic:full",
  ]);
});
