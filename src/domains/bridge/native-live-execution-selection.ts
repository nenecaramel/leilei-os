export const NATIVE_LIVE_CLAUDE_MODELS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5",
  "claude-opus-4-6",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
] as const;

export const NATIVE_LIVE_THINKING_MODES = [
  "adaptive",
  "between_tools",
  "disabled",
] as const;

export const NATIVE_LIVE_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type NativeLiveClaudeModel =
  (typeof NATIVE_LIVE_CLAUDE_MODELS)[number];
export type NativeLiveThinkingMode =
  (typeof NATIVE_LIVE_THINKING_MODES)[number];
export type NativeLiveEffortLevel =
  (typeof NATIVE_LIVE_EFFORT_LEVELS)[number];

export type NativeLiveExecutionSelection = {
  model: NativeLiveClaudeModel;
  thinking?: NativeLiveThinkingMode;
  effort?: NativeLiveEffortLevel;
};

const CAPABILITIES: Record<
  NativeLiveClaudeModel,
  {
    thinking: readonly NativeLiveThinkingMode[];
    effort: readonly NativeLiveEffortLevel[];
  }
> = {
  "claude-opus-5-5": {
    thinking: ["adaptive"],
    effort: ["low", "medium", "high", "xhigh", "max"],
  },
  "claude-sonnet-5-5": {
    thinking: ["adaptive", "between_tools"],
    effort: ["low", "medium", "high", "xhigh", "max"],
  },
  "claude-opus-5": {
    thinking: ["adaptive", "disabled"],
    effort: ["low", "medium", "high", "xhigh", "max"],
  },
  "claude-opus-4-6": {
    thinking: ["adaptive", "disabled"],
    effort: ["low", "medium", "high", "max"],
  },
  "claude-sonnet-5": {
    thinking: ["adaptive", "disabled"],
    effort: ["low", "medium", "high", "xhigh", "max"],
  },
  "claude-sonnet-4-6": {
    thinking: ["adaptive", "disabled"],
    effort: ["low", "medium", "high", "max"],
  },
};

export class NativeLiveExecutionSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeLiveExecutionSelectionError";
  }
}

export function parseNativeLiveExecutionSelection(
  value: unknown,
): NativeLiveExecutionSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NativeLiveExecutionSelectionError(
      "execution must be an object.",
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some(
      (key) =>
        key !== "model"
        && key !== "thinking"
        && key !== "effort",
    )
  ) {
    throw new NativeLiveExecutionSelectionError(
      "execution contains an unexpected field.",
    );
  }

  const model = record.model;
  if (
    typeof model !== "string"
    || !NATIVE_LIVE_CLAUDE_MODELS.includes(
      model as NativeLiveClaudeModel,
    )
  ) {
    throw new NativeLiveExecutionSelectionError(
      "execution.model is not supported.",
    );
  }

  const capabilities = CAPABILITIES[model as NativeLiveClaudeModel];
  const thinking = record.thinking;
  if (
    thinking !== undefined
    && (
      typeof thinking !== "string"
      || !capabilities.thinking.includes(
        thinking as NativeLiveThinkingMode,
      )
    )
  ) {
    throw new NativeLiveExecutionSelectionError(
      "execution.thinking is not supported by the selected model.",
    );
  }

  const effort = record.effort;
  if (
    effort !== undefined
    && (
      typeof effort !== "string"
      || !capabilities.effort.includes(
        effort as NativeLiveEffortLevel,
      )
    )
  ) {
    throw new NativeLiveExecutionSelectionError(
      "execution.effort is not supported by the selected model.",
    );
  }

  if (
    model === "claude-sonnet-5-5"
    && thinking === "between_tools"
    && (effort === "xhigh" || effort === "max")
  ) {
    throw new NativeLiveExecutionSelectionError(
      "execution.thinking=between_tools is only supported up to effort=high by claude-sonnet-5-5.",
    );
  }

  if (
    model === "claude-opus-5"
    && thinking === "disabled"
    && (effort === "xhigh" || effort === "max")
  ) {
    throw new NativeLiveExecutionSelectionError(
      "execution.thinking=disabled is only supported up to effort=high by claude-opus-5.",
    );
  }

  return {
    model: model as NativeLiveClaudeModel,
    ...(thinking === undefined
      ? {}
      : { thinking: thinking as NativeLiveThinkingMode }),
    ...(effort === undefined
      ? {}
      : { effort: effort as NativeLiveEffortLevel }),
  };
}
