import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicResurfaceEvaluationService,
  type TopicResurfaceEvaluator,
} from "../src/domains/runtime/topic-resurface-evaluation.js";
import type {
  TopicResurfaceCandidate,
} from "../src/domains/runtime/topic-resurface-candidates.js";

function candidate(id: string): TopicResurfaceCandidate {
  return {
    stateId: id,
    text: "topic-" + id,
    threadKey: "thread-" + id,
    reinforcementCount: 2,
    lastReinforcedAt: "2026-09-20T00:00:00.000Z",
    dormantAt: "2026-09-23T00:00:00.000Z",
  };
}

class Reader {
  calls: Array<{
    userId: string;
    subjectId: string;
    limit: number;
  }> = [];

  constructor(
    readonly values: TopicResurfaceCandidate[],
  ) {}

  async list(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }) {
    this.calls.push(input);
    return { candidates: this.values.slice(0, input.limit) };
  }
}

class Evaluator implements TopicResurfaceEvaluator {
  calls: Array<{
    evaluatedAt: string;
    candidates: readonly TopicResurfaceCandidate[];
  }> = [];

  constructor(
    private readonly result:
      | { decision: "quiet" }
      | { decision: "consider"; stateId: string },
  ) {}

  async evaluate(input: {
    evaluatedAt: string;
    candidates: readonly TopicResurfaceCandidate[];
  }) {
    this.calls.push(input);
    return this.result;
  }
}

test("Topic resurface evaluation stays idle without candidates and skips the model", async () => {
  const reader = new Reader([]);
  let evaluated = 0;
  const evaluator: TopicResurfaceEvaluator = {
    async evaluate() {
      evaluated += 1;
      return { decision: "quiet" };
    },
  };
  const service = new TopicResurfaceEvaluationService(
    reader as never,
    evaluator,
  );

  assert.deepEqual(
    await service.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00+00:00",
      candidateLimit: 5,
    }),
    {
      outcome: "idle",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 0,
    },
  );
  assert.equal(evaluated, 0);
});

test("Topic resurface evaluation may return quiet without mutating candidates", async () => {
  const values = [candidate("topic-1"), candidate("topic-2")];
  const before = structuredClone(values);
  const reader = new Reader(values);
  const evaluator = new Evaluator({ decision: "quiet" });
  const service = new TopicResurfaceEvaluationService(
    reader as never,
    evaluator,
  );

  const result = await service.runOnce({
    userId: "user-1",
    subjectId: "G",
    now: "2026-09-23T01:00:00.000Z",
    candidateLimit: 2,
  });

  assert.deepEqual(result, {
    outcome: "quiet",
    evaluatedAt: "2026-09-23T01:00:00.000Z",
    candidateCount: 2,
  });
  assert.deepEqual(values, before);
  assert.equal(evaluator.calls.length, 1);
});

test("Topic resurface evaluation returns exactly the selected supplied candidate", async () => {
  const values = [candidate("topic-1"), candidate("topic-2")];
  const service = new TopicResurfaceEvaluationService(
    new Reader(values) as never,
    new Evaluator({
      decision: "consider",
      stateId: "topic-2",
    }),
  );

  const result = await service.runOnce({
    userId: "user-1",
    subjectId: "G",
    now: "2026-09-23T01:00:00.000Z",
    candidateLimit: 2,
  });

  assert.deepEqual(result, {
    outcome: "consider",
    evaluatedAt: "2026-09-23T01:00:00.000Z",
    candidateCount: 2,
    candidate: values[1],
  });
});

test("candidate ids outside the supplied set fail closed as model_failed", async () => {
  const service = new TopicResurfaceEvaluationService(
    new Reader([candidate("topic-1")]) as never,
    new Evaluator({
      decision: "consider",
      stateId: "not-a-candidate",
    }),
  );

  assert.deepEqual(
    await service.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 1,
    }),
    {
      outcome: "model_failed",
      evaluatedAt: "2026-09-23T01:00:00.000Z",
      candidateCount: 1,
    },
  );
});

test("model exceptions fail closed without Topic state changes", async () => {
  const service = new TopicResurfaceEvaluationService(
    new Reader([candidate("topic-1")]) as never,
    {
      async evaluate() {
        throw new Error("model unavailable");
      },
    },
  );

  assert.equal(
    (await service.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 1,
    })).outcome,
    "model_failed",
  );
});
