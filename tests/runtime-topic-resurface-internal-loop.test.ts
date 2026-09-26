import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicResurfaceInternalLoopService,
  type TopicResurfaceDeliberator,
} from "../src/domains/runtime/topic-resurface-internal-loop.js";
import type {
  TopicResurfaceCandidate,
} from "../src/domains/runtime/topic-resurface-candidates.js";
import type {
  TopicResurfaceEvaluationResult,
} from "../src/domains/runtime/topic-resurface-evaluation.js";

const candidate: TopicResurfaceCandidate = {
  stateId: "11111111-1111-4111-8111-111111111111",
  text: "继续想 Topic Pool",
  threadKey: "thread-1",
  reinforcementCount: 2,
  lastReinforcedAt: "2026-09-20T00:00:00.000Z",
  dormantAt: "2026-09-23T00:00:00.000Z",
};

class Evaluation {
  constructor(
    private readonly result: TopicResurfaceEvaluationResult,
  ) {}

  async runOnce() {
    return this.result;
  }
}

class Deliberator implements TopicResurfaceDeliberator {
  calls = 0;

  constructor(
    private readonly result:
      | { decision: "quiet" }
      | { decision: "reflect"; reflection: string },
  ) {}

  async deliberate() {
    this.calls += 1;
    return this.result;
  }
}

test("Topic resurface internal loop skips deliberation unless evaluator says consider", async () => {
  const deliberator = new Deliberator({
    decision: "reflect",
    reflection: "不会被调用",
  });
  const service = new TopicResurfaceInternalLoopService(
    new Evaluation({
      outcome: "quiet",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 2,
    }) as never,
    deliberator,
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
      candidateCount: 2,
    },
  );
  assert.equal(deliberator.calls, 0);
});

test("Topic resurface internal loop returns bounded ephemeral reflection without mutation", async () => {
  const before = structuredClone(candidate);
  const deliberator = new Deliberator({
    decision: "reflect",
    reflection: "  这个话题仍然值得在内部保留一点注意力。  ",
  });
  const service = new TopicResurfaceInternalLoopService(
    new Evaluation({
      outcome: "consider",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
      candidate,
    }) as never,
    deliberator,
  );

  assert.deepEqual(
    await service.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 5,
    }),
    {
      outcome: "reflection",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
      candidate,
      reflection: "这个话题仍然值得在内部保留一点注意力。",
    },
  );
  assert.deepEqual(candidate, before);
});

test("Topic resurface internal loop treats deliberator quiet as quiet", async () => {
  const service = new TopicResurfaceInternalLoopService(
    new Evaluation({
      outcome: "consider",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
      candidate,
    }) as never,
    new Deliberator({ decision: "quiet" }),
  );

  assert.equal(
    (await service.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 5,
    })).outcome,
    "quiet",
  );
});

test("Topic resurface internal loop fails closed on deliberator errors or blank reflection", async () => {
  const evaluation = new Evaluation({
    outcome: "consider",
    evaluatedAt: "2026-09-23T01:00:00.000Z",
    candidateCount: 1,
    candidate,
  }) as never;

  const throwing = new TopicResurfaceInternalLoopService(
    evaluation,
    {
      async deliberate() {
        throw new Error("model unavailable");
      },
    },
  );
  assert.equal(
    (await throwing.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 5,
    })).outcome,
    "deliberation_failed",
  );

  const blank = new TopicResurfaceInternalLoopService(
    evaluation,
    new Deliberator({
      decision: "reflect",
      reflection: "   ",
    }),
  );
  assert.equal(
    (await blank.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 5,
    })).outcome,
    "deliberation_failed",
  );
});
