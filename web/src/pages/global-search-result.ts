import {
  createArchivedDiaryDetailLocation,
  createDiaryDetailLocation,
} from "./diary-location";
import {
  createArchivedMemoryDetailLocation,
  createMemoryDetailLocation,
} from "./memory-location";
import {
  createArchivedTaskDetailLocation,
  createTaskDetailLocation,
} from "./task-location";
import type { SearchModule } from "./global-search-location";

export type GlobalSearchResult = {
  entity_type: SearchModule;
  entity_id: string;
  stable_name: string;
  snippet: string;
  matched_field: string;
  match_reason: string;
  lifecycle_status: "active" | "archived";
  business_time: string;
  time_basis: string;
  updated_at: string;
  detail_tool: "get_memory" | "get_diary" | "get_task" | null;
  detail_arguments: {
    id: string;
    scope: "active" | "archived";
  } | null;
};

export const GLOBAL_SEARCH_MODULE_LABELS: Record<SearchModule, string> = {
  memory: "Memory",
  diary: "Diary",
  task: "Task",
  universe: "Universe",
};

export function formatGlobalSearchBusinessDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("/");
}

export function createGlobalSearchResultDetailLocation(
  result: GlobalSearchResult,
  returnTo: string,
): string {
  if (result.entity_type === "memory") {
    return result.lifecycle_status === "archived"
      ? createArchivedMemoryDetailLocation(result.entity_id, returnTo)
      : createMemoryDetailLocation(result.entity_id, returnTo);
  }

  if (result.entity_type === "diary") {
    return result.lifecycle_status === "archived"
      ? createArchivedDiaryDetailLocation(result.entity_id, returnTo)
      : createDiaryDetailLocation(result.entity_id, returnTo);
  }

  if (result.entity_type === "universe") {
    const params = new URLSearchParams({ node: result.entity_id });
    return `/universe?${params.toString()}`;
  }

  return result.lifecycle_status === "archived"
    ? createArchivedTaskDetailLocation(result.entity_id, returnTo)
    : createTaskDetailLocation(result.entity_id, returnTo);
}
