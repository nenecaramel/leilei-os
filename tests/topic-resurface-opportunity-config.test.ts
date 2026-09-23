import assert from "node:assert/strict";
import test from "node:test";
import {
  getTopicResurfaceOpportunityConfig,
} from "../src/config/env.js";

test("Topic resurface opportunity config is disabled unless both explicit knobs are set", () => {
  assert.equal(
    getTopicResurfaceOpportunityConfig({
      NATIVE_LIVE_TOPIC_RESURFACE_MIN_INTERVAL_SECONDS: undefined,
      NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT: undefined,
    }),
    undefined,
  );

  assert.throws(
    () => getTopicResurfaceOpportunityConfig({
      NATIVE_LIVE_TOPIC_RESURFACE_MIN_INTERVAL_SECONDS: 60,
      NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT: undefined,
    }),
    /must be configured together/,
  );
});

test("Topic resurface opportunity config converts explicit seconds to milliseconds", () => {
  assert.deepEqual(
    getTopicResurfaceOpportunityConfig({
      NATIVE_LIVE_TOPIC_RESURFACE_MIN_INTERVAL_SECONDS: 90,
      NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT: 7,
    }),
    {
      minIntervalMs: 90_000,
      candidateLimit: 7,
    },
  );
});
