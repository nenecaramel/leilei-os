import type { TaskFilters } from "./task-location";

export type TaskListRequest = {
  search: string;
  url: string;
};

export type TaskRequestTicket = {
  isCurrent(): boolean;
};

export type TaskRequestTracker = {
  begin(): TaskRequestTicket;
  invalidate(): void;
};

export async function settleLatestTaskRequest<T>(input: {
  request: Promise<T>;
  ticket: TaskRequestTicket;
  signal: AbortSignal;
  onSuccess(value: T): void;
  onError(): void;
}): Promise<void> {
  try {
    const value = await input.request;
    if (input.ticket.isCurrent()) {
      input.onSuccess(value);
    }
  } catch {
    if (
      input.ticket.isCurrent() &&
      !input.signal.aborted
    ) {
      input.onError();
    }
  }
}

export function buildTaskListRequest(
  filters: TaskFilters,
  now = new Date(),
): TaskListRequest {
  const parameters = new URLSearchParams();
  setTrimmedParameter(parameters, "q", filters.q);
  setTrimmedParameter(parameters, "status", filters.status);
  setTrimmedParameter(parameters, "priority", filters.priority);
  setTrimmedParameter(parameters, "tag", filters.tag);

  if (filters.due) parameters.set("due", filters.due);

  if (filters.due === "custom") {
    setInstantParameter(parameters, "due_from", filters.dueFrom);
    setInstantParameter(parameters, "due_to", filters.dueTo);
  } else {
    const range =
      getStoredPresetRange(filters) ??
      getPresetRange(filters.due, now);
    if (range) {
      parameters.set("due_from", range.from);
      parameters.set("due_to", range.to);
    }
  }

  const search = parameters.size > 0
    ? `?${parameters.toString()}`
    : "";

  return {
    search,
    url: `/task${search}`,
  };
}

function getStoredPresetRange(
  filters: TaskFilters,
): { from: string; to: string } | null {
  if (
    filters.due !== "today" &&
    filters.due !== "next_7_days"
  ) {
    return null;
  }

  const from = new Date(filters.dueFrom);
  const to = new Date(filters.dueTo);
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from >= to
  ) {
    return null;
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export function createLatestTaskRequestTracker(): TaskRequestTracker {
  let latestRequest = 0;

  return {
    begin() {
      const request = ++latestRequest;
      return {
        isCurrent: () => request === latestRequest,
      };
    },
    invalidate() {
      latestRequest += 1;
    },
  };
}

export function cancelLatestTaskRequest(
  tracker: TaskRequestTracker,
  controller: AbortController | null,
): void {
  tracker.invalidate();
  controller?.abort();
}

function setTrimmedParameter(
  parameters: URLSearchParams,
  name: string,
  value: string,
): void {
  const normalized = value.trim();
  if (normalized) parameters.set(name, normalized);
}

function setInstantParameter(
  parameters: URLSearchParams,
  name: string,
  value: string,
): void {
  if (!value) return;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    parameters.set(name, parsed.toISOString());
  }
}

function getPresetRange(
  due: TaskFilters["due"],
  now: Date,
): { from: string; to: string } | null {
  const start = new Date(now);
  const end = new Date(now);

  if (due === "today") {
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
  } else if (due === "next_7_days") {
    end.setDate(end.getDate() + 7);
  } else {
    return null;
  }

  return {
    from: start.toISOString(),
    to: end.toISOString(),
  };
}
