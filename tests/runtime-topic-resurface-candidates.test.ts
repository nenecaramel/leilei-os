import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicResurfaceCandidateService,
  type TopicResurfaceCandidatePort,
  type TopicResurfaceCandidateRow,
} from "../src/domains/runtime/topic-resurface-candidates.js";
import {
  topicThreadKey,
  writeTopicEvolution,
} from "../src/domains/runtime/topic-evolution.js";

function row(input: {
  id: string;
  text: string;
  phase: "active" | "dormant";
  role?: "anchor" | "reinforcement";
}): TopicResurfaceCandidateRow {
  const dormantAt =
    input.phase === "dormant"
      ? "2026-09-30T00:00:00.000Z"
      : null;
  return {
    stateId: input.id,
    text: input.text,
    payload: writeTopicEvolution(null, {
      phase: input.phase,
      role: input.role ?? "anchor",
      threadKey: topicThreadKey(input.text),
      anchorStateId: "11111111-1111-4111-8111-111111111111",
      reinforcementCount: 2,
      reinforcementSources: ["message-1", "message-2"],
      lastEvolvedAt: "2026-09-30T00:00:00.000Z",
      lastReinforcedAt: "2026-09-23T00:00:00.000Z",
      dormantAt,
    }),
  };
}

class Port implements TopicResurfaceCandidatePort {
  calls: Array<{ userId: string; subjectId: string; limit: number }> = [];

  constructor(
    private readonly rows: TopicResurfaceCandidateRow[],
  ) {}

  async listDormantAnchors(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<TopicResurfaceCandidateRow[]> {
    this.calls.push(input);
    return this.rows.slice(0, input.limit);
  }
}

test("Topic resurface candidates expose dormant anchors without mutating lifecycle state", async () => {
  const dormant = row({
    id: "11111111-1111-4111-8111-111111111111",
    text: "  再聊 Topic Pool  ",
    phase: "dormant",
  });
  const active = row({
    id: "22222222-2222-4222-8222-222222222222",
    text: "active topic",
    phase: "active",
  });
  const reinforcement = row({
    id: "33333333-3333-4333-8333-333333333333",
    text: "reinforcement topic",
    phase: "dormant",
    role: "reinforcement",
  });
  const before = structuredClone(dormant);
  const port = new Port([dormant, active, reinforcement]);
  const service = new TopicResurfaceCandidateService(port);

  const result = await service.list({
    userId: "user-1",
    subjectId: "G",
    limit: 10,
  });

  assert.deepEqual(port.calls, [{
    userId: "user-1",
    subjectId: "G",
    limit: 10,
  }]);
  assert.deepEqual(result.candidates, [{
    stateId: dormant.stateId,
    text: "再聊 Topic Pool",
    threadKey: topicThreadKey("再聊 Topic Pool"),
    reinforcementCount: 2,
    lastReinforcedAt: "2026-09-23T00:00:00.000Z",
    dormantAt: "2026-09-30T00:00:00.000Z",
  }]);
  assert.deepEqual(dormant, before);
});

test("Topic resurface candidate list requires an explicit positive bound", async () => {
  const service = new TopicResurfaceCandidateService(new Port([]));

  await assert.rejects(
    service.list({
      userId: "user-1",
      subjectId: "G",
      limit: 0,
    }),
    /positive integer/,
  );
});

test("malformed Topic lifecycle payloads fail closed out of resurface candidates", async () => {
  const malformed: TopicResurfaceCandidateRow = {
    stateId: "11111111-1111-4111-8111-111111111111",
    text: "broken topic",
    payload: {
      topic_v1: {
        phase: "dormant",
        role: "anchor",
      },
    },
  };
  const service = new TopicResurfaceCandidateService(
    new Port([malformed]),
  );

  assert.deepEqual(
    await service.list({
      userId: "user-1",
      subjectId: "G",
      limit: 1,
    }),
    { candidates: [] },
  );
});
