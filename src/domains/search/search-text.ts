export const MAX_SEARCH_SNIPPET_CODE_POINTS = 240;

export function normalizeSearchQuery(value: unknown, maxCodePoints = 200): string {
  if (typeof value !== "string") throw new Error("Search query is invalid.");
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalized || [...normalized].length > maxCodePoints) {
    throw new Error("Search query is invalid.");
  }
  return normalized;
}

function flexibleQueryPattern(query: string): RegExp {
  const escaped = query
    .normalize("NFC")
    .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    .replace(/\s+/gu, "\\s+");
  return new RegExp(escaped, "iu");
}

export function createSearchSnippet(
  value: string,
  query: string,
  maxCodePoints = MAX_SEARCH_SNIPPET_CODE_POINTS,
  errorMessage = "Search repository returned a non-matching snippet source.",
): string {
  const source = value.normalize("NFC");
  const match = flexibleQueryPattern(query).exec(source);
  if (!match) throw new Error(errorMessage);

  const sourcePoints = [...source];
  const matchStart = [...source.slice(0, match.index)].length;
  const matchLength = [...match[0]].length;
  const matchEnd = matchStart + matchLength;
  let start = Math.max(0, matchStart - 80);
  let end = Math.min(sourcePoints.length, Math.max(matchEnd, start + maxCodePoints));
  start = Math.max(0, Math.min(start, end - maxCodePoints));

  let leading = start > 0;
  let trailing = end < sourcePoints.length;
  let contentBudget = maxCodePoints - Number(leading) - Number(trailing);
  if (end - start > contentBudget) {
    const before = Math.min(matchStart, Math.floor((contentBudget - matchLength) / 2));
    start = Math.max(0, matchStart - Math.max(0, before));
    end = Math.min(sourcePoints.length, start + contentBudget);
    if (end < matchEnd) {
      end = matchEnd;
      start = Math.max(0, end - contentBudget);
    }
    leading = start > 0;
    trailing = end < sourcePoints.length;
    contentBudget = maxCodePoints - Number(leading) - Number(trailing);
    if (end - start > contentBudget) end = start + contentBudget;
  }
  return `${leading ? "…" : ""}${sourcePoints.slice(start, end).join("")}${trailing ? "…" : ""}`;
}
