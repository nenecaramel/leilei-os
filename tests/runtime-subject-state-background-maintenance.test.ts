import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundLoopOrchestrator,
} from "../src/domains/runtime/background/background-loop-orchestrator.js";
import {
  SubjectStateBackgroundMaintenance,
} from "../src/domains/runtime/background/subject-state-background-maintenance.js";

const NOW = "2026-09-30T00:00:00.000Z";

function orchestrator() {
  return new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 8,
    maxCostPerCycle: 8,
    maxConcurrent: 4,
  });
}

test("Subject State maintenance runs Memory/Feel decay under the shared Subject mutex", async () => {
  const calls: string[] = [];
  const loop = orchestrator();
  const maintenance = new SubjectStateBackgroundMaintenance(
    loop,
    "G",
    {
      decay: {
        async runOnce(input) {
          calls.push(
            [input.userId, input.subjectId, input.now, input.limit ?? "none"]
              .join(":"),
          );
        },
      },
    },
    { decay: { priority: "maintenance", cost: 1, limit: 20 } },
    () => NOW,
  );

  maintenance.schedule({ userId: " user-1 " });
  await loop.drain();

  assert.deepEqual(calls, [`user-1:G:${NOW}:20`]);
});

test("decay is scheduled only when selected", async () => {
  const calls: string[] = [];
  const loop = orchestrator();
  const maintenance = new SubjectStateBackgroundMaintenance(
    loop,
    "G",
    { decay: { async runOnce() { calls.push("decay"); } } },
    { decay: { priority: "maintenance", cost: 1 } },
  );

  maintenance.schedule({ userId: "user-1", kinds: [] });
  await loop.drain();
  assert.deepEqual(calls, []);

  maintenance.schedule({ userId: "user-1", kinds: ["decay"] });
  await loop.drain();
  assert.deepEqual(calls, ["decay"]);
});

test("repeated offers coalesce into one pending decay job per user and subject", async () => {
  let runs = 0;
  const loop = orchestrator();
  const maintenance = new SubjectStateBackgroundMaintenance(
    loop,
    "G",
    { decay: { async runOnce() { runs += 1; } } },
    { decay: { priority: "maintenance", cost: 1 } },
  );

  maintenance.schedule({ userId: "user-1" });
  maintenance.schedule({ userId: "user-1" });
  await loop.drain();
  assert.equal(runs, 1);
});

test("maintenance requires an explicit plan instead of inventing cadence or cost", () => {
  const runner = { async runOnce() {} };

  assert.throws(
    () => new SubjectStateBackgroundMaintenance(orchestrator(), "G", { decay: runner }, {}),
    /requires both runner and explicit plan/,
  );
  assert.throws(
    () => new SubjectStateBackgroundMaintenance(
      orchestrator(),
      "G",
      {},
      { decay: { priority: "maintenance", cost: 1 } },
    ),
    /requires both runner and explicit plan/,
  );
  assert.throws(
    () => new SubjectStateBackgroundMaintenance(
      orchestrator(),
      "G",
      { decay: runner },
      { decay: { priority: "maintenance", cost: 0 } },
    ),
    /cost must be a positive integer/,
  );
  assert.throws(
    () => new SubjectStateBackgroundMaintenance(orchestrator(), " ", {}, {}),
    /subjectId must not be blank/,
  );
});

test("a maintenance instance with nothing configured schedules nothing", async () => {
  const loop = orchestrator();
  const maintenance = new SubjectStateBackgroundMaintenance(loop, "G", {}, {});
  assert.doesNotThrow(() => maintenance.schedule({ userId: "user-1" }));
  await loop.drain();
});
