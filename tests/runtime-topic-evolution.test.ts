import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicEvolutionService,
  readTopicEvolution,
  topicThreadKey,
  writeTopicEvolution,
  type TopicEvolutionCandidate,
  type TopicEvolutionUpdate,
} from "../src/domains/runtime/topic-evolution.js";
import type {
  MindSemanticGroupingService,
} from "../src/domains/runtime/mind-semantic-grouping.js";

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
    dormantAfterHours: 168,
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
  assert.equal(topic?.dormantAt, null);
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
    dormantAfterHours: 168,
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
    dormantAfterHours: 168,
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


test("active Topic becomes dormant after the configured inactivity window", async () => {
  const payload = {
    topic_v1: {
      phase: "active",
      role: "anchor",
      threadKey: topicThreadKey("sleeping topic"),
      anchorStateId: "11111111-1111-4111-8111-111111111111",
      reinforcementCount: 1,
      reinforcementSources: ["source-1"],
      lastEvolvedAt: "2026-09-23T00:00:00.000Z",
      lastReinforcedAt: "2026-09-23T00:00:00.000Z",
      dormantAt: null,
    },
  };
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "sleeping topic",
      "source-1",
      "2026-09-23T00:00:00.000Z",
      payload,
    ),
  ]);
  const service = new TopicEvolutionService(port, {
    maxReinforcementSources: 16,
    dormantAfterHours: 168,
  });

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-30T00:00:01.000Z",
  });

  assert.equal(result.active, 0);
  assert.equal(result.dormant, 1);
  assert.equal(result.dormantTransitions, 1);
  assert.equal(port.updates[0]?.reason, "dormant");
  assert.equal(port.updates[0]?.evolution.phase, "dormant");
  assert.equal(
    port.updates[0]?.evolution.dormantAt,
    "2026-09-30T00:00:01.000Z",
  );
});

test("duplicate evidence from the same source cannot reactivate a dormant Topic", async () => {
  const payload = {
    topic_v1: {
      phase: "dormant",
      role: "anchor",
      threadKey: topicThreadKey("same source topic"),
      anchorStateId: "11111111-1111-4111-8111-111111111111",
      reinforcementCount: 1,
      reinforcementSources: ["message-1"],
      lastEvolvedAt: "2026-09-30T00:00:00.000Z",
      lastReinforcedAt: "2026-09-23T00:00:00.000Z",
      dormantAt: "2026-09-30T00:00:00.000Z",
    },
  };
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "same source topic",
      "message-1",
      "2026-09-23T00:00:00.000Z",
      payload,
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "same source topic",
      "message-1",
      "2026-10-01T00:00:00.000Z",
    ),
  ]);
  const service = new TopicEvolutionService(port, {
    maxReinforcementSources: 16,
    dormantAfterHours: 168,
  });

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-01T00:01:00.000Z",
  });

  assert.equal(result.active, 0);
  assert.equal(result.dormant, 1);
  const anchor = port.updates.find(
    (update) => update.stateId === "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(anchor, undefined);
});

test("new independent evidence reactivates a dormant Topic thread", async () => {
  const payload = {
    topic_v1: {
      phase: "dormant",
      role: "anchor",
      threadKey: topicThreadKey("returning topic"),
      anchorStateId: "11111111-1111-4111-8111-111111111111",
      reinforcementCount: 1,
      reinforcementSources: ["message-1"],
      lastEvolvedAt: "2026-09-30T00:00:00.000Z",
      lastReinforcedAt: "2026-09-23T00:00:00.000Z",
      dormantAt: "2026-09-30T00:00:00.000Z",
    },
  };
  const port = new Port([
    candidate(
      "11111111-1111-4111-8111-111111111111",
      "returning topic",
      "message-1",
      "2026-09-23T00:00:00.000Z",
      payload,
    ),
    candidate(
      "22222222-2222-4222-8222-222222222222",
      "returning topic",
      "message-2",
      "2026-10-01T00:00:00.000Z",
    ),
  ]);
  const service = new TopicEvolutionService(port, {
    maxReinforcementSources: 16,
    dormantAfterHours: 168,
  });

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-10-01T00:01:00.000Z",
  });

  assert.equal(result.active, 1);
  assert.equal(result.dormant, 0);
  assert.ok(result.reactivated >= 1);
  const anchor = port.updates.find(
    (update) => update.stateId === "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(anchor?.reason, "reactivate");
  assert.equal(anchor?.evolution.phase, "active");
  assert.equal(anchor?.evolution.dormantAt, null);
  assert.equal(anchor?.evolution.reinforcementCount, 2);
});


test("derived Topic semantic grouping merges paraphrases into the older canonical pool", async () => {
  const anchorId = "56565656-5656-4656-8656-565656565656";
  const anchorText = "runtime lifecycle design";
  const anchorPayload = writeTopicEvolution(null, {
    phase: "active",
    role: "anchor",
    threadKey: topicThreadKey(anchorText),
    anchorStateId: anchorId,
    reinforcementCount: 1,
    reinforcementSources: ["curiosity-1"],
    lastEvolvedAt: "2026-09-26T10:00:00.000Z",
    lastReinforcedAt: "2026-09-26T10:00:00.000Z",
    dormantAt: null,
  });
  const paraphraseId = "78787878-7878-4878-8878-787878787878";
  const paraphraseText = "designing the runtime state lifecycle";
  const port = new Port([
    candidate(
      anchorId,
      anchorText,
      "curiosity-1",
      "2026-09-26T10:00:00.000Z",
      anchorPayload,
    ),
    candidate(
      paraphraseId,
      paraphraseText,
      "curiosity-2",
      "2026-09-27T00:00:00.000Z",
    ),
  ]);
  const semanticGrouping = {
    async reconcile(
      _input: Parameters<MindSemanticGroupingService["reconcile"]>[0],
    ) {
      return {
        canonicalThreadKeyByThread: new Map([
          [topicThreadKey(paraphraseText), topicThreadKey(anchorText)],
        ]),
        staged: 0,
      };
    },
  };
  const service = new TopicEvolutionService(
    port,
    {
      maxReinforcementSources: 16,
      dormantAfterHours: 168,
    },
    semanticGrouping,
  );

  const result = await service.runOnce({
    userId: "u1",
    subjectId: "G",
    now: "2026-09-27T00:01:00.000Z",
  });

  assert.equal(result.threads, 1);
  const anchor = port.updates.find((update) => update.stateId === anchorId);
  const reinforcement = port.updates.find(
    (update) => update.stateId === paraphraseId,
  );
  assert.equal(anchor?.evolution.reinforcementCount, 2);
  assert.equal(reinforcement?.evolution.role, "reinforcement");
  assert.equal(reinforcement?.evolution.anchorStateId, anchorId);
  assert.equal(
    reinforcement?.evolution.threadKey,
    topicThreadKey(anchorText),
  );
});
