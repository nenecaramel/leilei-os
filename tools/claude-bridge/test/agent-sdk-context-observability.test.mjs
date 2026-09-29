import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("missing provider usage stays unavailable without inventing values", () => {
  assert.equal(normalizeAgentSdkContextUsage(null), null);
});
