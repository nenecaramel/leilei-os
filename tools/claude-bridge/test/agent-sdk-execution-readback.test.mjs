import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAgentSdkExecutionReadback,
} from "../src/agent-sdk-execution-readback.mjs";

test("normalizes applied model/effort and matching SDK model capability", () => {
  assert.deepEqual(
    normalizeAgentSdkExecutionReadback({
      requested: {
        model: "claude-sonnet-5",
        thinking: "adaptive",
        effort: "xhigh",
      },
      settings: {
        applied: {
          model: "claude-sonnet-5",
          effort: "xhigh",
        },
      },
      supportedModels: [
        {
          value: "claude-sonnet-5",
          displayName: "Claude Sonnet 5",
          description: "test",
          supportsEffort: true,
          supportedEffortLevels: [
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
          ],
          supportsAdaptiveThinking: true,
          supportsFastMode: true,
          supportsAutoMode: false,
        },
      ],
    }),
    {
      requested: {
        model: "claude-sonnet-5",
        thinking: "adaptive",
        effort: "xhigh",
      },
      applied: {
        model: "claude-sonnet-5",
        effort: "xhigh",
      },
      capability: {
        value: "claude-sonnet-5",
        display_name: "Claude Sonnet 5",
        description: "test",
        supports_effort: true,
        supported_effort_levels: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ],
        supports_adaptive_thinking: true,
        supports_fast_mode: true,
        supports_auto_mode: false,
      },
      supported_models: [
        {
          value: "claude-sonnet-5",
          display_name: "Claude Sonnet 5",
          description: "test",
          supports_effort: true,
          supported_effort_levels: [
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
          ],
          supports_adaptive_thinking: true,
          supports_fast_mode: true,
          supports_auto_mode: false,
        },
      ],
    },
  );
});

test("missing supported-model entry does not erase applied settings", () => {
  const result = normalizeAgentSdkExecutionReadback({
    requested: {
      model: "claude-opus-5-5",
      thinking: "adaptive",
      effort: "medium",
    },
    settings: {
      applied: {
        model: "claude-opus-5-5",
        effort: "medium",
      },
    },
    supportedModels: [
      {
        value: "default",
        displayName: "Default",
        description: "provider default",
      },
    ],
  });

  assert.deepEqual(result.applied, {
    model: "claude-opus-5-5",
    effort: "medium",
  });
  assert.equal(result.capability, null);
  assert.equal(result.supported_models.length, 1);
});
