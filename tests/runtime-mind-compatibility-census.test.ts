import assert from "node:assert/strict";
import test from "node:test";
import {
  MindCompatibilityCensusService,
} from "../src/domains/runtime/mind-compatibility-census.js";

test("Mind compatibility census returns only aggregate legacy/recovery counts", async () => {
  const rows = [
    [{
      legacy_dream_states: 2,
      legacy_authored_topic_states: 3,
      legacy_memory_recall_without_ledger: 4,
    }],
    [{
      legacy_open_mind_followups: 5,
      legacy_open_dream_intents: 1,
      legacy_open_topic_intents: 4,
      quarantined_mind_followups: 6,
    }],
  ];
  let calls = 0;
  const db = {
    async execute() {
      return rows[calls++]!;
    },
  };

  const census = await new MindCompatibilityCensusService(
    db as never,
  ).read({
    userId: "11111111-1111-4111-8111-111111111111",
    subjectId: "G",
  });

  assert.deepEqual(census, {
    legacyDreamStates: 2,
    legacyAuthoredTopicStates: 3,
    legacyMemoryRecallWithoutLedger: 4,
    legacyOpenMindFollowUps: 5,
    legacyOpenDreamIntents: 1,
    legacyOpenTopicIntents: 4,
    quarantinedMindFollowUps: 6,
  });
  assert.equal(calls, 2);
});
