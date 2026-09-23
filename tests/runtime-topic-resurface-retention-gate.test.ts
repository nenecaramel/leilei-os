import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicResurfaceRetentionGateService,
  type TopicResurfaceRetentionEvaluator,
} from "../src/domains/runtime/topic-resurface-retention-gate.js";
import type {
  TopicResurfaceCandidate,
} from "../src/domains/runtime/topic-resurface-candidates.js";
import type {
  TopicResurfaceInternalLoopResult,
} from "../src/domains/runtime/topic-resurface-internal-loop.js";

const candidate: TopicResurfaceCandidate = {
  stateId: "11111111-1111-4111-8111-111111111111",
  text: "继续想 Topic Pool",
  threadKey: "thread-1",
  reinforcementCount: 2,
  lastReinforcedAt: "2026-09-20T00:00:00.000Z",
  dormantAt: "2026-09-23T00:00:00.000Z",
};

class InternalLoop {
  constructor(
    private readonly result: TopicResurfaceInternalLoopResult,
  ) {}

  async runOnce() {
    return this.result;
  }
}

class Evaluator implements TopicResurfaceRetentionEvaluator {
  calls = 0;

  constructor(
    private readonly result:
      | { decision: "discard" }
      | { decision: "retain_as_thought_seed" },
  ) {}

  async evaluate() {
    this.calls += 1;
    return this.result;
  }
}

test("Topic resurface retention gate skips model unless internal loop produced reflection", async () => {
  const evaluator = new Evaluator({
    decision: "retain_as_thought_seed",
  });
  const service = new TopicResurfaceRetentionGateService(
    new InternalLoop({
      outcome: "quiet",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
    }) as never,
    evaluator,
  );

  assert.deepEqual(
    await service.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 5,
    }),
    {
      outcome: "quiet",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
    },
  );
  assert.equal(evaluator.calls, 0);
});

test("Topic resurface retention gate may discard ephemeral reflection", async () => {
  const reflection = "这条旧 Topic 暂时没有形成值得长期留下的新观察。";
  const service = new TopicResurfaceRetentionGateService(
    new InternalLoop({
      outcome: "reflection",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
      candidate,
      reflection,
    }) as never,
    new Evaluator({ decision: "discard" }),
  );

  assert.deepEqual(
    await service.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 5,
    }),
    {
      outcome: "discarded_reflection",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
      candidate,
      reflection,
    },
  );
});

test("Topic resurface retention gate exposes unchanged Thought seed candidate without persistence", async () => {
  const reflection = "我注意到这个话题反复出现时，真正未解决的是边界而不是实现细节。";
  const before = structuredClone(candidate);
  const service = new TopicResurfaceRetentionGateService(
    new InternalLoop({
      outcome: "reflection",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
      candidate,
      reflection,
    }) as never,
    new Evaluator({ decision: "retain_as_thought_seed" }),
  );

  assert.deepEqual(
    await service.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 5,
    }),
    {
      outcome: "thought_seed_candidate",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
      candidate,
      text: reflection,
    },
  );
  assert.deepEqual(candidate, before);
});

test("Topic resurface retention gate fails closed on evaluator errors", async () => {
  const reflection = "值得留下";
  const service = new TopicResurfaceRetentionGateService(
    new InternalLoop({
      outcome: "reflection",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
      candidate,
      reflection,
    }) as never,
    {
      async evaluate() {
        throw new Error("model unavailable");
      },
    },
  );

  assert.deepEqual(
    await service.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 5,
    }),
    {
      outcome: "retention_failed",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
      candidate,
      reflection,
    },
  );
});
