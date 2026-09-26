import assert from "node:assert/strict";
import test from "node:test";
import {
  CuriosityTopicProjectionService,
  curiosityTopicStateId,
  curiosityToTopic,
  type CuriosityTopicSeedCandidate,
} from "../src/domains/runtime/curiosity-topic-projection.js";

function candidate(
  overrides: Partial<CuriosityTopicSeedCandidate> = {},
): CuriosityTopicSeedCandidate {
  return {
    stateId: "11111111-1111-4111-8111-111111111111",
    text: "为什么 dormant Topic 会重新活跃",
    visibility: "subject_private",
    sensitivity: "normal",
    audience: ["G"],
    causedBy: "assistant-message-1",
    ...overrides,
  };
}

test("Curiosity projects to one deterministic derived Topic seed with source provenance", () => {
  const source = candidate();
  const topic = curiosityToTopic({
    userId: "user-1",
    subjectId: "G",
    candidate: source,
  });

  assert.equal(topic.id, curiosityTopicStateId(source.stateId));
  assert.equal(topic.kind, "topic");
  assert.equal(topic.text, source.text);
  assert.equal(topic.envelope.authority, "derived");
  assert.equal(topic.envelope.producer.kind, "process");
  assert.equal(
    topic.envelope.provenance.causedBy,
    "assistant-message-1",
  );
  assert.deepEqual(topic.envelope.provenance.sources, [{
    kind: "persistent_state",
    id: source.stateId,
  }]);
  assert.deepEqual(
    topic.envelope.provenance.derivedFrom,
    [source.stateId],
  );
  assert.deepEqual(topic.payload, {
    topic_seed_v1: {
      source_kind: "curiosity",
      source_state_id: source.stateId,
    },
  });
});

test("Curiosity projection is deterministic across retries", async () => {
  const appended: unknown[][] = [];
  const source = candidate();
  const service = new CuriosityTopicProjectionService({
    async listCandidates() {
      return [source];
    },
    async appendTopics(input) {
      appended.push([...input.topics]);
    },
  });

  const first = await service.runOnce({
    userId: "user-1",
    subjectId: "G",
    now: "2026-09-23T00:00:00.000Z",
  });
  const second = await service.runOnce({
    userId: "user-1",
    subjectId: "G",
    now: "2026-09-23T01:00:00.000Z",
  });

  assert.equal(first.projected, 1);
  assert.equal(second.projected, 1);
  assert.deepEqual(appended[0], appended[1]);
});
