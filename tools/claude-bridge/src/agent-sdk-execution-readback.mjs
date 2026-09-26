function nonblankString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeModelInfo(model) {
  if (!model || typeof model !== "object") return null;
  return {
    value: nonblankString(model.value),
    display_name: nonblankString(model.displayName),
    description: nonblankString(model.description),
    supports_effort:
      typeof model.supportsEffort === "boolean"
        ? model.supportsEffort
        : null,
    supported_effort_levels:
      Array.isArray(model.supportedEffortLevels)
        ? model.supportedEffortLevels.filter(
            (level) => typeof level === "string",
          )
        : [],
    supports_adaptive_thinking:
      typeof model.supportsAdaptiveThinking === "boolean"
        ? model.supportsAdaptiveThinking
        : null,
    supports_fast_mode:
      typeof model.supportsFastMode === "boolean"
        ? model.supportsFastMode
        : null,
    supports_auto_mode:
      typeof model.supportsAutoMode === "boolean"
        ? model.supportsAutoMode
        : null,
  };
}

export function normalizeAgentSdkExecutionReadback({
  requested = null,
  settings = null,
  supportedModels = null,
} = {}) {
  const appliedModel =
    nonblankString(settings?.applied?.model);
  const appliedEffort =
    nonblankString(settings?.applied?.effort);

  const models = Array.isArray(supportedModels)
    ? supportedModels.map(normalizeModelInfo).filter(Boolean)
    : [];

  const requestedModel =
    nonblankString(requested?.model);
  const capability =
    models.find(
      (model) =>
        model.value === appliedModel
        || model.value === requestedModel,
    ) ?? null;

  return {
    requested: requested
      ? {
          model: requestedModel,
          thinking:
            nonblankString(requested?.thinking),
          effort: nonblankString(requested?.effort),
        }
      : null,
    applied: {
      model: appliedModel,
      effort: appliedEffort,
    },
    capability,
    supported_models: models,
  };
}
