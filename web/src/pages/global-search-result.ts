import {
  createArchivedDiaryDetailLocation,
  createDiaryDetailLocation,
} from "./diary-location";
import type { SearchModule } from "./global-search-location";

export type GlobalSearchResult = {
  entity_type: SearchModule;
  entity_id: string;
  stable_name: string;
  snippet: string;
  matched_field: string;
  match_reason: string;
  lifecycle_status: "active" | "archived";
  business_time: string | null;
  time_basis: string;
  updated_at: string;
  author: "L" | "G" | "C" | null;
  detail_tool: "get_diary" | "read_todo_day" | "get_universe_node" | "get_memory" | null;
  detail_arguments: {
    id: string;
    scope: "active" | "archived";
  } | { id: string } | { date: string } | null;
};

export const GLOBAL_SEARCH_MODULE_LABELS: Record<SearchModule, string> = {
  diary: "Diary",
  universe: "Universe",
  todo: "Todo",
  mind: "Mind",
};

export function globalSearchResultTitle(result: GlobalSearchResult): string {
  return result.entity_type === "mind" ? result.snippet : result.stable_name || "未命名记录";
}

export function globalSearchResultSnippet(result: GlobalSearchResult): string {
  return result.entity_type === "mind" ? "" : result.snippet;
}

export function formatGlobalSearchBusinessDate(value: string | null, timeBasis?: string): string {
  if (value === null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (timeBasis === "memory_date") {
    const parts = new Intl.DateTimeFormat("en", {timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit"}).formatToParts(date);
    return `${parts.find(part => part.type === "month")?.value}/${parts.find(part => part.type === "day")?.value}`;
  }
  return [date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("/");
}

export function createGlobalSearchResultDetailLocation(
  result: GlobalSearchResult,
  returnTo: string,
): string {
  if (result.entity_type === "diary") {
    return result.lifecycle_status === "archived"
      ? createArchivedDiaryDetailLocation(result.entity_id, returnTo)
      : createDiaryDetailLocation(result.entity_id, returnTo);
  }

  if (result.entity_type === "mind") {
    const params = new URLSearchParams({ memoryId: result.entity_id, returnTo });
    return `/mind?${params.toString()}`;
  }
  if (result.entity_type === "universe") {
    const params = new URLSearchParams({ node: result.entity_id });
    return `/universe?${params.toString()}`;
  }

  if (result.entity_type === "todo") {
    const params = new URLSearchParams({ date: result.detail_arguments && "date" in result.detail_arguments ? result.detail_arguments.date : result.business_time?.slice(0, 10) ?? "" });
    if (result.author) params.set("author", result.author);
    return `/day-space?${params.toString()}`;
  }

  return "/search";
}
