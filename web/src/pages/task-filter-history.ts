import { buildTaskListRequest } from "./task-list-request";
import {
  readTaskFilters,
  type TaskFilters,
} from "./task-location";

type TaskHistoryTarget = Pick<Window, "history" | "location">;
type TaskHistoryListenerTarget = TaskHistoryTarget &
  Pick<Window, "addEventListener" | "removeEventListener">;

type TaskFilterDebouncerOptions = {
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
  const currentRequest = buildTaskListRequest(
    readTaskFilters(target.location.search),
  );
  const currentLocation =
    `${target.location.pathname}${currentRequest.search}`;
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

  return readTaskFilterHistorySnapshot(
    buildTaskListRequest(filters).search,
  );
}

export function readTaskFilterHistorySnapshot(
  search: string,
): TaskFilters {
  const filters = readTaskFilters(search);
  if (!filters.dueFrom && !filters.dueTo) {
    return filters;
  }

  return {
    ...filters,
    dueFrom: toDateTimeLocalValue(filters.dueFrom),
    dueTo: toDateTimeLocalValue(filters.dueTo),
  };
}

export function subscribeToTaskFilterHistory(
  target: TaskHistoryListenerTarget,
  restore: (filters: TaskFilters) => void,
): () => void {
  const onPopState = () => {
    restore(readTaskFilterHistorySnapshot(target.location.search));
  };

  target.addEventListener("popstate", onPopState);
  return () => target.removeEventListener("popstate", onPopState);
}

function toDateTimeLocalValue(value: string): string {
  if (!value) return "";

  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    return value;
  }

  const localTime = new Date(
    instant.getTime() - instant.getTimezoneOffset() * 60_000,
  );
  return localTime.toISOString().slice(0, 16);
}

export function createTaskFilterDebouncer({
  delayMs,
  commit,
  setTimeout,
  clearTimeout,
}: TaskFilterDebouncerOptions) {
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
