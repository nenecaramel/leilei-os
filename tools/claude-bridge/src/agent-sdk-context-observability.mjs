const DEFAULT_COMPACTION_THRESHOLD_PERCENT = 75;
const MIN_EXPERIMENTAL_THRESHOLD_PERCENT = 70;
const MAX_EXPERIMENTAL_THRESHOLD_PERCENT = 80;

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function normalizeCategory(category) {
  if (!category || typeof category !== "object") return null;
  return {
    name: typeof category.name === "string" ? category.name : null,
    tokens: finiteNumber(category.tokens),
    kind: typeof category.kind === "string" ? category.kind : null,
    is_deferred:
      typeof category.isDeferred === "boolean"
        ? category.isDeferred
        : null,
  };
}

/**
 * Stable LeileiOS projection of Agent SDK getContextUsage().
 *
 * This is observability state only. It does not mutate conversation state and
 * it is never authoritative over Canonical Ledger history.
 */
export function normalizeAgentSdkContextUsage(raw) {
  if (!raw || typeof raw !== "object") return null;

  return {
    model: typeof raw.model === "string" ? raw.model : null,
    total_tokens: finiteNumber(raw.totalTokens),
    max_tokens: finiteNumber(raw.maxTokens),
    raw_max_tokens: finiteNumber(raw.rawMaxTokens),
    percentage: finiteNumber(raw.percentage),
    categories: Array.isArray(raw.categories)
      ? raw.categories.map(normalizeCategory).filter(Boolean)
      : [],
  };
}

/**
 * Deterministic turn-boundary compaction advisory.
 *
 * Nothing calls /compact here. Runtime integration must explicitly act on a
 * due=true decision after the current turn is terminal. The initial experiment
 * intentionally restricts thresholds to the agreed 70–80% band.
 */
export function evaluateTurnBoundaryCompaction(
  usage,
  {
    thresholdPercent = DEFAULT_COMPACTION_THRESHOLD_PERCENT,
  } = {},
) {
  if (
    !Number.isFinite(thresholdPercent)
    || thresholdPercent < MIN_EXPERIMENTAL_THRESHOLD_PERCENT
    || thresholdPercent > MAX_EXPERIMENTAL_THRESHOLD_PERCENT
  ) {
    throw new RangeError(
      "Compaction threshold must be between 70 and 80 percent during the initial experiment.",
    );
  }

  const snapshot = normalizeAgentSdkContextUsage(usage);
  if (!snapshot || !Number.isFinite(snapshot.percentage)) {
    return {
      due: false,
      threshold_percent: thresholdPercent,
      observed_percent: null,
      reason: "context_usage_unavailable",
    };
  }

  return {
    due: snapshot.percentage >= thresholdPercent,
    threshold_percent: thresholdPercent,
    observed_percent: snapshot.percentage,
    reason:
      snapshot.percentage >= thresholdPercent
        ? "turn_boundary_threshold_reached"
        : "below_threshold",
  };
}

export const AGENT_SDK_COMPACTION_POLICY = Object.freeze({
  default_threshold_percent: DEFAULT_COMPACTION_THRESHOLD_PERCENT,
  minimum_experimental_threshold_percent:
    MIN_EXPERIMENTAL_THRESHOLD_PERCENT,
  maximum_experimental_threshold_percent:
    MAX_EXPERIMENTAL_THRESHOLD_PERCENT,
});
