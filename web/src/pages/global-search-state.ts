import { SEARCH_MODULES } from "./global-search-location";
import type { GlobalSearchResult } from "./global-search-result";

export type SearchSnapshot = {
  version: 1;
  url: string;
  results: GlobalSearchResult[];
  cursor: string | null;
  scrollY: number;
  focusKey: string | null;
};

export function keyOf(result: GlobalSearchResult): string {
  return `${result.entity_type}:${result.entity_id}`;
}

export function uniqueResults(results: GlobalSearchResult[]): GlobalSearchResult[] {
  return [
    ...new Map(results.map((result) => [keyOf(result), result])).values(),
  ];
}

export function decodeSearchSnapshot(candidate: Partial<SearchSnapshot> | null | undefined, url: string): SearchSnapshot | null {

  if (
    !candidate ||
    candidate.version !== 1 ||
    candidate.url !== url ||
    !Array.isArray(candidate.results)
  ) {
    return null;
  }

  if (
    candidate.cursor !== null &&
    typeof candidate.cursor !== "string"
  ) {
    return null;
  }

  if (
    !Number.isFinite(candidate.scrollY) ||
    (
      typeof candidate.focusKey !== "string" &&
      candidate.focusKey !== null
    )
  ) {
    return null;
  }

  return candidate as SearchSnapshot;
}

export function groupGlobalSearchResults(results: GlobalSearchResult[]) {
  return SEARCH_MODULES
        .map((module) => ({
          module,
          items: results.filter(
            (result) =>
              result.entity_type === module,
          ),
        }))
        .filter((group) => group.items.length > 0);
}
