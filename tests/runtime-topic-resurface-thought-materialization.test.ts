import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicResurfaceThoughtMaterializationService,
  topicResurfaceThoughtStateId,
  topicResurfaceToThought,
  type TopicResurfaceThoughtMaterializationConfig,
} from "../src/domains/runtime/topic-resurface-thought-materialization.js";
import type {
  TopicResurfaceCandidate,
} from "../src/domains/runtime/topic-resurface-candidates.js";

const config: TopicResurfaceThoughtMaterializationConfig = {
  ruleVersion: "topic-resurface-thought-v1",
  processVersion: "topic-resurface-thought-materialization-v1",
  deliberationPromptContractVersion: "topic-resurface-deliberation-v1",
  retentionPromptContractVersion: "topic-resurface-retention-v1",
  model: {
    provider: "anthropic",
    model: "claude-code-test",
    configVersion: "test",
    promptContractVersion: "topic-resurface-v1",
  },
};

const candidate: TopicResurfaceCandidate = {
  stateId: "11111111-1111-4111-8111-111111111111",
  text: "旧 Topic",
  threadKey: "topic-thread-1",
  reinforcementCount: 2,
  lastReinforcedAt: "2026-09-20T00:00:00.000Z",
  dormantAt: "2026-09-23T00:00:00.000Z",
};

test("Topic resurface Thought id is deterministic per Topic evidence generation", () => {
  const first = topicResurfaceThoughtStateId(
    candidate.stateId,
    "assistant-message-1",
  );
  const second = topicResurfaceThoughtStateId(
    candidate.stateId,
    "assistant-message-1",
  );
  const otherTopic = topicResurfaceThoughtStateId(
    "22222222-2222-4222-8222-222222222222",
    "assistant-message-1",
  );
  const newerEvidence = topicResurfaceThoughtStateId(
    candidate.stateId,
    "assistant-message-2",
  );

  assert.equal(first, second);
  assert.notEqual(first, otherTopic);
  assert.notEqual(first, newerEvidence);
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
});

test("Topic resurface Thought keeps derived authority, hidden presentation, source provenance and model versions", () => {
  const state = topicResurfaceToThought({
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    subjectId: "G",
    source: {
      stateId: candidate.stateId,
      threadKey: candidate.threadKey,
      visibility: "subject_private",
      sensitivity: "sensitive",
      audience: ["G"],
      evidenceSourceId: "assistant-message-1",
    },
    text: "  我注意到真正持续的是边界问题。  ",
    evaluatedAt: "2026-09-23T01:00:00+00:00",
    config,
  });

  assert.equal(
    state.id,
    topicResurfaceThoughtStateId(
      candidate.stateId,
      "assistant-message-1",
    ),
  );
  assert.equal(state.kind, "thought");
  assert.equal(state.text, "我注意到真正持续的是边界问题。");
  assert.equal(state.envelope.authority, "derived");
  assert.equal(state.envelope.status.presentationStatus, "not_presented");
  assert.equal(state.envelope.status.settlementStatus, "settled");
  assert.equal(state.envelope.scope.applicability, "global");
  assert.equal(state.envelope.scope.sensitivity, "sensitive");
  assert.deepEqual(state.envelope.provenance.sources, [{
    kind: "persistent_state",
    id: candidate.stateId,
  }]);
  assert.equal(
    state.envelope.provenance.causedBy,
    "assistant-message-1",
  );
  assert.deepEqual(
    state.envelope.provenance.derivedFrom,
    [candidate.stateId],
  );
  assert.deepEqual(state.envelope.versions.model, config.model);
  assert.deepEqual(state.payload, {
    thought_seed_v1: {
      source_kind: "topic_resurface",
      source_state_id: candidate.stateId,
      source_thread_key: candidate.threadKey,
      source_evidence_id: "assistant-message-1",
      evaluated_at: "2026-09-23T01:00:00.000Z",
      deliberation_prompt_contract_version:
        "topic-resurface-deliberation-v1",
      retention_prompt_contract_version:
        "topic-resurface-retention-v1",
    },
  });
});

test("Topic resurface Thought materializer only calls persistence after retention produced a seed candidate", async () => {
  let materializeCalls = 0;
  const quiet = new TopicResurfaceThoughtMaterializationService(
    {
      async runOnce() {
        return {
          outcome: "discarded_reflection" as const,
          evaluatedAt: "2026-09-23T01:00:00.000Z",
          candidateCount: 1,
          candidate,
          reflection: "discard me",
        };
      },
    },
    {
      async materialize() {
        materializeCalls += 1;
        return {
          outcome: "materialized" as const,
          stateId: "unexpected",
        };
      },
    },
    config,
  );

  assert.equal(
    (await quiet.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 5,
    })).outcome,
    "discarded_reflection",
  );
  assert.equal(materializeCalls, 0);

  const retained = new TopicResurfaceThoughtMaterializationService(
    {
      async runOnce() {
        return {
          outcome: "thought_seed_candidate" as const,
          evaluatedAt: "2026-09-23T01:00:00.000Z",
          candidateCount: 1,
          candidate,
          text: "derived thought",
        };
      },
    },
    {
      async materialize(input) {
        materializeCalls += 1;
        assert.equal(input.sourceTopicStateId, candidate.stateId);
        assert.equal(input.expectedThreadKey, candidate.threadKey);
        assert.equal(input.text, "derived thought");
        assert.deepEqual(input.config, config);
        return {
          outcome: "materialized" as const,
          stateId: topicResurfaceThoughtStateId(
            candidate.stateId,
            "assistant-message-1",
          ),
        };
      },
    },
    config,
  );

  assert.deepEqual(
    await retained.runOnce({
      userId: "user-1",
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 5,
    }),
    {
      outcome: "materialized",
      stateId: topicResurfaceThoughtStateId(
        candidate.stateId,
        "assistant-message-1",
      ),
    },
  );
  assert.equal(materializeCalls, 1);
});

test("Topic resurface Thought materialization requires explicit model provenance", () => {
  assert.throws(
    () => new TopicResurfaceThoughtMaterializationService(
      { async runOnce() { return { outcome: "quiet" as const, evaluatedAt: "2026-09-23T01:00:00.000Z", candidateCount: 1 }; } },
      { async materialize() { return { outcome: "source_ineligible" as const }; } },
      {
        ...config,
        model: {
          provider: "",
          model: "claude-code-test",
        },
      },
    ),
    /model provenance/,
  );
});
