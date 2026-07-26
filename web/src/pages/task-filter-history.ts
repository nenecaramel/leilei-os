import { buildTaskListRequest } from "./task-list-request";
import {
  readTaskFilters,
  type TaskFilters,
} from "./task-location";

type TaskHistoryTarget = Pick<Window, "history" | "location">;
type TaskHistoryListenerTarget = TaskHistoryTarget &
  Pick<Window, "addEventListener" | "removeEventListener">;

type TaskSearchDebouncerOptions = {
  delayMs: number;
  commit: (query: string) => void;
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (timerId: number) => void;
};

export function pushTaskFilterHistory(
  target: TaskHistoryTarget,
  filters: TaskFilters,
): boolean {
  const request = buildTaskListRequest(filters);
  const currentLocation = `${target.location.pathname}${target.location.search}`;
  const nextLocation = `${target.location.pathname}${request.search}`;

  if (currentLocation === nextLocation) {
    return false;
  }

  target.history.pushState(null, "", nextLocation);
  return true;
}

export function createTaskFilterHistorySnapshot(
  filters: TaskFilters,
): TaskFilters {
  if (
    filters.due !== "today" &&
    filters.due !== "next_7_days"
  ) {
    return filters;
  }

  return readTaskFilters(buildTaskListRequest(filters).search);
}

export function subscribeToTaskFilterHistory(
  target: TaskHistoryListenerTarget,
  restore: (filters: TaskFilters) => void,
): () => void {
  const onPopState = () => {
    restore(readTaskFilters(target.location.search));
  };

  target.addEventListener("popstate", onPopState);
  return () => target.removeEventListener("popstate", onPopState);
}

export function createTaskSearchDebouncer({
  delayMs,
  commit,
  setTimeout,
  clearTimeout,
}: TaskSearchDebouncerOptions) {
  let timerId: number | null = null;

  return {
    schedule(query: string) {
      if (timerId !== null) {
        clearTimeout(timerId);
      }

      timerId = setTimeout(() => {
        timerId = null;
        commit(query);
      }, delayMs);
    },

    cancel() {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
  };
}
