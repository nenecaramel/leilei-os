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
): TaskListRequest {
  const parameters = new URLSearchParams();
  setTrimmedParameter(parameters, "q", filters.q);
  setTrimmedParameter(parameters, "status", filters.status);
  setTrimmedParameter(parameters, "priority", filters.priority);
  setTrimmedParameter(parameters, "tag", filters.tag);

  if (filters.due) parameters.set("due", filters.due);

  if (filters.due === "custom") {
    setLocalDateTimeParameter(parameters, "due_from", filters.dueFrom);
    setLocalDateTimeParameter(parameters, "due_to", filters.dueTo);
  }

  const search = parameters.size > 0
    ? `?${parameters.toString()}`
    : "";

  return {
    search,
    url: `/task${search}`,
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

function setLocalDateTimeParameter(
  parameters: URLSearchParams,
  name: string,
  value: string,
): void {
  if (!value) return;
  parameters.set(name, value.trim());
}
