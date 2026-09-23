import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicEvolutionService,
  readTopicEvolution,
  topicThreadKey,
  type TopicEvolutionCandidate,
  type TopicEvolutionUpdate,
} from "../src/domains/runtime/topic-evolution.js";

function candidate(
  stateId: string,
  text: string,
  sourceId: string,
  createdAt: string,
  payload: Record<string, unknown> | null = null,
): TopicEvolutionCandidate {
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
  updates: TopicEvolutionUpdate[] = [];

  constructor(public candidates: TopicEvolutionCandidate[]) {}

  async listCandidates() {
    return this.candidates;
  }

  async applyUpdates(input: {
    updates: readonly TopicEvolutionUpdate[];
  }) {
    this.updates = [...input.updates];
    return {
      applied: input.updates.length,
      conflicts: 0,
    };
  }
}

test("one settled Topic becomes one active pool anchor without inventing lifecycle parameters", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "Continue exploring Topic Pool",
      "source-1",
      "2026-09-23T00:00:00.000Z",
    ),
  ]);
  const service = new TopicEvolutionService(port, {
    maxReinforcementSources: 16,
  });

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-23T00:01:00.000Z",
  });

  assert.equal(result.active, 1);
  assert.equal(result.initialized, 1);
  assert.equal(port.updates.length, 1);
  const topic = port.updates[0]?.evolution;
  assert.equal(topic?.phase, "active");
  assert.equal(topic?.role, "anchor");
  assert.equal(topic?.reinforcementCount, 1);
  assert.equal(
    topic?.threadKey,
    topicThreadKey("Continue exploring Topic Pool"),
  );
});

test("independent repetitions reinforce one normalized Topic thread", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "Continue exploring Topic Pool",
      "source-1",
      "2026-09-23T00:00:00.000Z",
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "  CONTINUE EXPLORING TOPIC POOL  ",
      "source-2",
      "2026-09-23T01:00:00.000Z",
    ),
  ]);
  const service = new TopicEvolutionService(port, {
    maxReinforcementSources: 16,
  });

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-23T01:01:00.000Z",
  });

  assert.equal(result.threads, 1);
  assert.equal(port.updates.length, 2);
  const anchor = port.updates.find(
    (update) => update.stateId === "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(anchor?.evolution.reinforcementCount, 2);
  assert.deepEqual(anchor?.evolution.reinforcementSources, [
    "source-1",
    "source-2",
  ]);
});

test("duplicate Topic tags from one assistant message count as one reinforcement source", async () => {
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "same topic",
      "message-1",
      "2026-09-23T00:00:00.000Z",
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "same topic",
      "message-1",
      "2026-09-23T00:00:01.000Z",
    ),
    candidate(
      "33333333-3333-4333-8333-333333333333",
      "same topic",
      "message-2",
      "2026-09-23T01:00:00.000Z",
    ),
  ]);
  const service = new TopicEvolutionService(port, {
    maxReinforcementSources: 16,
  });
  await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-23T01:01:00.000Z",
  });

  assert.equal(port.updates[0]?.evolution.reinforcementCount, 2);
  const roundTrip = readTopicEvolution(port.updates[0]?.nextPayload);
  assert.equal(roundTrip?.reinforcementCount, 2);
});
