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
import { createSharedPaperDetailLocation } from "./shared-paper-location";

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
  author: "L" | "G" | "C" | null;
  detail_tool: "get_memory" | "get_diary" | "get_task" | "read_todo_day" | "get_universe_node" | "get_shared_paper" | null;
  detail_arguments: {
    id: string;
    scope: "active" | "archived";
  } | { id: string } | { date: string } | null;
  conversation_id?: string | null;
  conversation_view?: "default" | "all" | null;
};

export const GLOBAL_SEARCH_MODULE_LABELS: Record<SearchModule, string> = {
  memory: "Memory",
  diary: "Diary",
  task: "Task",
  universe: "Universe",
  todo: "Todo",
  shared_paper: "Shared Paper",
  conversation: "Conversations",
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
  if (result.entity_type === "conversation") {
    if (!result.conversation_id) return "/conversations";
    const params = new URLSearchParams({ anchor: result.entity_id });
    if (result.conversation_view === "all") params.set("view", "all");
    return `/conversations/${encodeURIComponent(result.conversation_id)}?${params.toString()}#message-${encodeURIComponent(result.entity_id)}`;
  }

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

  if (result.entity_type === "shared_paper") {
    return createSharedPaperDetailLocation(
      result.entity_id,
      result.lifecycle_status,
      returnTo,
    );
  }

  if (result.entity_type === "todo") {
    const params = new URLSearchParams({ date: result.detail_arguments && "date" in result.detail_arguments ? result.detail_arguments.date : result.business_time.slice(0, 10) });
    if (result.author) params.set("author", result.author);
    return `/day-space?${params.toString()}`;
  }

  return result.lifecycle_status === "archived"
    ? createArchivedTaskDetailLocation(result.entity_id, returnTo)
    : createTaskDetailLocation(result.entity_id, returnTo);
}
