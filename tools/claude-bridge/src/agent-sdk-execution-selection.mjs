export const LEILEIOS_CLAUDE_MODELS = Object.freeze([
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5",
  "claude-opus-4-6",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
]);

export const LEILEIOS_EFFORT_LEVELS = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const LEILEIOS_THINKING_MODES = Object.freeze([
  "adaptive",
  "between_tools",
  "disabled",
]);

const CAPABILITIES = Object.freeze({
  "claude-opus-5-5": Object.freeze({
    thinking: Object.freeze(["adaptive"]),
    effort: Object.freeze(["low", "medium", "high", "xhigh", "max"]),
  }),
  "claude-sonnet-5-5": Object.freeze({
    thinking: Object.freeze(["adaptive", "between_tools"]),
    effort: Object.freeze(["low", "medium", "high", "xhigh", "max"]),
  }),
  "claude-opus-5": Object.freeze({
    thinking: Object.freeze(["adaptive", "disabled"]),
    effort: Object.freeze(["low", "medium", "high", "xhigh", "max"]),
  }),
  "claude-opus-4-6": Object.freeze({
    thinking: Object.freeze(["adaptive", "disabled"]),
    effort: Object.freeze(["low", "medium", "high", "max"]),
  }),
  "claude-sonnet-5": Object.freeze({
    thinking: Object.freeze(["adaptive", "disabled"]),
    effort: Object.freeze(["low", "medium", "high", "xhigh", "max"]),
  }),
  "claude-sonnet-4-6": Object.freeze({
    thinking: Object.freeze(["adaptive", "disabled"]),
    effort: Object.freeze(["low", "medium", "high", "max"]),
  }),
});

function invalid(message) {
  throw Object.assign(new Error(message), {
    runtimeCode: "RUNTIME_UNAVAILABLE",
  });
}

function isOneOf(value, allowed) {
  return typeof value === "string" && allowed.includes(value);
}

/**
 * Normalizes LeileiOS model/thinking/effort execution metadata into the
 * Claude Agent SDK query() option shape.
 *
 * Omitted selection means "use provider defaults". LeileiOS only validates
 * explicit model-specific combinations here; live SDK capability readback
 * remains an execution-time guard for future model-list changes.
 */
export function normalizeAgentSdkExecutionSelection(selection = null) {
  if (selection == null) return {};

  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    invalid("Agent SDK execution selection must be an object.");
  }

  const keys = Object.keys(selection);
  for (const key of keys) {
    if (!["model", "thinking", "effort"].includes(key)) {
      invalid(`Unexpected Agent SDK execution selection field: ${key}`);
    }
  }

  const { model, thinking, effort } = selection;
  if (!isOneOf(model, LEILEIOS_CLAUDE_MODELS)) {
    invalid("Agent SDK model is not in the LeileiOS allowlist.");
  }

  const capabilities = CAPABILITIES[model];

  if (
    thinking !== undefined
    && !isOneOf(thinking, capabilities.thinking)
  ) {
    invalid(`Thinking mode ${String(thinking)} is not supported by ${model}.`);
  }

  if (
    effort !== undefined
    && !isOneOf(effort, capabilities.effort)
  ) {
    invalid(`Effort ${String(effort)} is not supported by ${model}.`);
  }

  if (
    model === "claude-sonnet-5-5"
    && thinking === "between_tools"
    && (effort === "xhigh" || effort === "max")
  ) {
    invalid(
      "Thinking mode between_tools is only supported up to effort=high by claude-sonnet-5-5.",
    );
  }

  if (
    model === "claude-opus-5"
    && thinking === "disabled"
    && (effort === "xhigh" || effort === "max")
  ) {
    invalid(
      "Thinking mode disabled is only supported up to effort=high by claude-opus-5.",
    );
  }

  return {
    model,
    ...(thinking === undefined
      ? {}
      : { thinking: { type: thinking } }),
    ...(effort === undefined ? {} : { effort }),
  };
}

export function agentSdkExecutionCapabilities(model) {
  if (!isOneOf(model, LEILEIOS_CLAUDE_MODELS)) {
    return null;
  }
  const capabilities = CAPABILITIES[model];
  return {
    model,
    thinking: [...capabilities.thinking],
    effort: [...capabilities.effort],
  };
}
