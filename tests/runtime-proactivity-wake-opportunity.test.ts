import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BackgroundLoopOrchestrator,
} from "../src/domains/runtime/background/background-loop-orchestrator.js";
import {
  ProactivityWakeOpportunityProducer,
  proactivityWakeId,
} from "../src/domains/runtime/proactivity/proactivity-wake-opportunity.js";

test("Proactivity wake ids are stable for one backend activity/cooldown anchor", () => {
  const input = {
    userId: "22222222-2222-4222-8222-222222222222",
    subjectId: "G",
    conversationId: "33333333-3333-4333-8333-333333333333",
    headMessageId: "44444444-4444-4444-8444-444444444444",
    latestUserActivityAt: "2026-09-23T08:00:00.000Z",
    latestDecidedWakeAt: null,
  };

  assert.equal(proactivityWakeId(input), proactivityWakeId(input));
  assert.notEqual(
    proactivityWakeId(input),
    proactivityWakeId({
      ...input,
      latestUserActivityAt: "2026-09-23T09:00:00.000Z",
    }),
  );
});

test("Proactivity producer reuses the shared orchestrator and schedules only eligible backend-built opportunities", async () => {
  const calls: string[] = [];
  const orchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 4,
    maxCostPerCycle: 4,
    maxConcurrent: 2,
  });

  const producer = new ProactivityWakeOpportunityProducer(
    orchestrator,
    {
      async buildOpportunity(input) {
        calls.push("discover:" + input.userId);
        if (input.userId === "u2") return null;
        return {
          gate: {
            wakeId: "11111111-1111-4111-8111-111111111111",
            userId: "u1",
            subjectId: "G",
            offeredAt: input.offeredAt,
            mode: "live",
            enabled: true,
            foregroundActive: false,
            outstandingEffectStatus: null,
            quietUntil: "2026-09-23T08:00:00.000Z",
            nextEligibleAt: null,
          },
          contactTarget: "conversation:c1",
          context: {
            version: 1,
            contextManifestId: null,
            capsule: "{}",
            sourceConversationId: "c1",
            sourceHeadMessageId: "m1",
            sourceActivityAt: "2026-09-23T06:00:00.000Z",
          },
        };
      },
    },
    {
      async start(input) {
        calls.push("start:" + input.gate.userId);
        return {
          outcome: "staged" as const,
          wakeId: input.gate.wakeId,
          taskId: "task-1",
        };
      },
    },
    "G",
    {
      kind: "proactivity_wake",
      priority: "reflection",
      cost: 1,
    },
    () => "2026-09-23T09:40:00.000Z",
  );

  assert.equal(await producer.scheduleUser("u1"), 1);
  assert.equal(await producer.scheduleUser("u2"), 0);
  await orchestrator.drain();

  assert.deepEqual(calls, [
    "discover:u1",
    "discover:u2",
    "start:u1",
  ]);
});


test("Proactivity capsule excludes archived or forgotten Memory and Feel", () => {
  const source = readFileSync(
    new URL(
      "../src/domains/runtime/proactivity/proactivity-wake-opportunity.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /kind IN \('memory', 'feel'\)[\s\S]*lifecycle_v1,status[\s\S]*IN \('archived', 'forgotten'\)/,
  );
});
