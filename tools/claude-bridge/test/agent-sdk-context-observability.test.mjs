import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_SDK_COMPACTION_POLICY,
  evaluateTurnBoundaryCompaction,
  normalizeAgentSdkContextUsage,
} from "../src/agent-sdk-context-observability.mjs";

test("normalizes Agent SDK context usage into a stable LeileiOS shape", () => {
  assert.deepEqual(
    normalizeAgentSdkContextUsage({
      model: "claude-sonnet-5",
      totalTokens: 75000,
      maxTokens: 100000,
      rawMaxTokens: 110000,
      percentage: 75,
      categories: [
        {
          name: "Messages",
          tokens: 42000,
          kind: "used",
          isDeferred: false,
          color: "blue",
        },
      ],
      gridRows: [["provider-only"]],
    }),
    {
      model: "claude-sonnet-5",
      total_tokens: 75000,
      max_tokens: 100000,
      raw_max_tokens: 110000,
      percentage: 75,
      categories: [
        {
          name: "Messages",
          tokens: 42000,
          kind: "used",
          is_deferred: false,
        },
      ],
    },
  );
});

test("turn-boundary policy is advisory and deterministic at the default 75 percent threshold", () => {
  assert.deepEqual(
    evaluateTurnBoundaryCompaction({ percentage: 74.9 }),
    {
      due: false,
      threshold_percent: 75,
      observed_percent: 74.9,
      reason: "below_threshold",
    },
  );

  assert.deepEqual(
    evaluateTurnBoundaryCompaction({ percentage: 75 }),
    {
      due: true,
      threshold_percent: 75,
      observed_percent: 75,
      reason: "turn_boundary_threshold_reached",
    },
  );
});

test("turn-boundary policy remains inside the initial 70–80 percent experiment band", () => {
  assert.equal(
    evaluateTurnBoundaryCompaction(
      { percentage: 71 },
      { thresholdPercent: 70 },
    ).due,
    true,
  );
  assert.equal(
    evaluateTurnBoundaryCompaction(
      { percentage: 79 },
      { thresholdPercent: 80 },
    ).due,
    false,
  );

  assert.throws(
    () =>
      evaluateTurnBoundaryCompaction(
        { percentage: 90 },
        { thresholdPercent: 69 },
      ),
    /between 70 and 80 percent/i,
  );
  assert.throws(
    () =>
      evaluateTurnBoundaryCompaction(
        { percentage: 90 },
        { thresholdPercent: 81 },
      ),
    /between 70 and 80 percent/i,
  );
});

test("missing provider usage never causes compaction by guess", () => {
  assert.deepEqual(
    evaluateTurnBoundaryCompaction(null),
    {
      due: false,
      threshold_percent:
        AGENT_SDK_COMPACTION_POLICY.default_threshold_percent,
      observed_percent: null,
      reason: "context_usage_unavailable",
    },
  );
});
