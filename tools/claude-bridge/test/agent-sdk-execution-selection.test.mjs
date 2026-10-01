import assert from "node:assert/strict";
import test from "node:test";
import {
  LEILEIOS_CLAUDE_MODELS,
  agentSdkExecutionCapabilities,
  normalizeAgentSdkExecutionSelection,
} from "../src/agent-sdk-execution-selection.mjs";

test("LeileiOS exposes the six approved Claude model ids", () => {
  assert.deepEqual(LEILEIOS_CLAUDE_MODELS, [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-opus-5",
    "claude-opus-4-6",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
  ]);
});

test("Sonnet 5.5 supports adaptive at all effort levels and between_tools through high", () => {
  assert.deepEqual(
    normalizeAgentSdkExecutionSelection({
      model: "claude-sonnet-5-5",
      thinking: "adaptive",
      effort: "max",
    }),
    {
      model: "claude-sonnet-5-5",
      thinking: { type: "adaptive" },
      effort: "max",
    },
  );

  assert.deepEqual(
    normalizeAgentSdkExecutionSelection({
      model: "claude-sonnet-5-5",
      thinking: "between_tools",
      effort: "high",
    }),
    {
      model: "claude-sonnet-5-5",
      thinking: { type: "between_tools" },
      effort: "high",
    },
  );

  assert.throws(
    () =>
      normalizeAgentSdkExecutionSelection({
        model: "claude-sonnet-5-5",
        thinking: "disabled",
        effort: "high",
      }),
    /not supported by claude-sonnet-5-5/i,
  );

  for (const effort of ["xhigh", "max"]) {
    assert.throws(
      () =>
        normalizeAgentSdkExecutionSelection({
          model: "claude-sonnet-5-5",
          thinking: "between_tools",
          effort,
        }),
      /only supported up to effort=high/i,
    );
  }
});

test("Opus 5.5 requires adaptive thinking and accepts xhigh", () => {
  assert.deepEqual(
    normalizeAgentSdkExecutionSelection({
      model: "claude-opus-5-5",
      thinking: "adaptive",
      effort: "xhigh",
    }),
    {
      model: "claude-opus-5-5",
      thinking: { type: "adaptive" },
      effort: "xhigh",
    },
  );

  assert.throws(
    () =>
      normalizeAgentSdkExecutionSelection({
        model: "claude-opus-5-5",
        thinking: "disabled",
        effort: "high",
      }),
    /not supported by claude-opus-5-5/i,
  );
});

test("Opus 5 supports full effort range with adaptive thinking and bounds disabled thinking to high", () => {
  assert.deepEqual(
    normalizeAgentSdkExecutionSelection({
      model: "claude-opus-5",
      thinking: "adaptive",
      effort: "max",
    }),
    {
      model: "claude-opus-5",
      thinking: { type: "adaptive" },
      effort: "max",
    },
  );

  assert.deepEqual(
    normalizeAgentSdkExecutionSelection({
      model: "claude-opus-5",
      thinking: "disabled",
      effort: "high",
    }),
    {
      model: "claude-opus-5",
      thinking: { type: "disabled" },
      effort: "high",
    },
  );

  for (const effort of ["xhigh", "max"]) {
    assert.throws(
      () =>
        normalizeAgentSdkExecutionSelection({
          model: "claude-opus-5",
          thinking: "disabled",
          effort,
        }),
      /only supported up to effort=high/i,
    );
  }
});

test("Sonnet 5 supports disabled thinking and xhigh", () => {
  assert.deepEqual(
    normalizeAgentSdkExecutionSelection({
      model: "claude-sonnet-5",
      thinking: "disabled",
      effort: "xhigh",
    }),
    {
      model: "claude-sonnet-5",
      thinking: { type: "disabled" },
      effort: "xhigh",
    },
  );
});

test("4.6 models reject xhigh but support max", () => {
  for (const model of [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
  ]) {
    assert.throws(
      () =>
        normalizeAgentSdkExecutionSelection({
          model,
          thinking: "adaptive",
          effort: "xhigh",
        }),
      /Effort xhigh is not supported/i,
    );

    assert.deepEqual(
      normalizeAgentSdkExecutionSelection({
        model,
        thinking: "adaptive",
        effort: "max",
      }),
      {
        model,
        thinking: { type: "adaptive" },
        effort: "max",
      },
    );
  }
});

test("manual thinking budgets and unknown product fields are not in the new contract", () => {
  assert.throws(
    () =>
      normalizeAgentSdkExecutionSelection({
        model: "claude-sonnet-5",
        thinking: "enabled",
      }),
    /Thinking mode enabled is not supported/i,
  );

  assert.throws(
    () =>
      normalizeAgentSdkExecutionSelection({
        model: "claude-sonnet-5",
        effort: "high",
        budget_tokens: 4096,
      }),
    /Unexpected Agent SDK execution selection field/i,
  );
});

test("capability readback is bounded to the product allowlist", () => {
  assert.deepEqual(
    agentSdkExecutionCapabilities("claude-sonnet-4-6"),
    {
      model: "claude-sonnet-4-6",
      thinking: ["adaptive", "disabled"],
      effort: ["low", "medium", "high", "max"],
    },
  );
  assert.equal(
    agentSdkExecutionCapabilities("claude-unknown"),
    null,
  );
});
