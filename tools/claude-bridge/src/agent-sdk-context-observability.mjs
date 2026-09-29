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
