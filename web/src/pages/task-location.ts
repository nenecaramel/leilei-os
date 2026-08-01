export type TaskDueFilter =
  | ""
  | "no_due_date"
  | "overdue"
  | "today"
  | "next_7_days"
  | "custom";

export type TaskFilters = {
  q: string;
  status: string;
  priority: string;
  tag: string;
  due: TaskDueFilter;
  dueFrom: string;
  dueTo: string;
};

const ALLOWED_DUE_FILTERS = new Set<TaskDueFilter>([
  "",
  "no_due_date",
  "overdue",
  "today",
  "next_7_days",
  "custom",
]);
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export const EMPTY_TASK_FILTERS: TaskFilters = {
  q: "",
  status: "",
  priority: "",
  tag: "",
  due: "",
  dueFrom: "",
  dueTo: "",
};

export function readTaskFilters(search: string): TaskFilters {
  const parameters = new URLSearchParams(search);
  const dueCandidate = parameters.get("due") ?? "";
  const due = ALLOWED_DUE_FILTERS.has(dueCandidate as TaskDueFilter)
    ? (dueCandidate as TaskDueFilter)
    : "";

  return {
    q: parameters.get("q") ?? "",
    status: parameters.get("status") ?? "",
    priority: parameters.get("priority") ?? "",
    tag: parameters.get("tag") ?? "",
    due,
    dueFrom: parameters.get("due_from") ?? "",
    dueTo: parameters.get("due_to") ?? "",
  };
}

export function getTaskDetailLocation(search: string): {
  taskId: string | null;
  returnTo: string;
  activeReturnTo: string;
  archived: boolean;
} {
  const parameters = new URLSearchParams(search);
  const taskCandidate = parameters.get("task")?.trim() ?? "";
  const taskId = TASK_ID_PATTERN.test(taskCandidate)
    ? taskCandidate
    : null;
  const archived = parameters.get("archived") === "1";
  const archivedDetail = archived && taskId !== null;
  const returnTo = archivedDetail
    ? getSafeTaskArchiveReturnTo(parameters.get("returnTo"))
    : getSafeTaskReturnTo(parameters.get("returnTo"));

  return {
    taskId,
    returnTo,
    activeReturnTo: archivedDetail
      ? getTaskArchiveLocation(new URL(returnTo, "https://leilei-os.invalid").search).returnTo
      : returnTo,
    archived,
  };
}

export function createTaskArchiveLocation(returnTo = "/task"): string {
  const parameters = new URLSearchParams();
  parameters.set("archived", "1");
  const safe = getSafeTaskReturnTo(returnTo);
  if (safe !== "/task") parameters.set("returnTo", safe);
  return `/task?${parameters.toString()}`;
}

export function createArchivedTaskDetailLocation(taskId: string, returnTo = "/task?archived=1"): string {
  const parameters = new URLSearchParams();
  parameters.set("archived", "1");
  parameters.set("task", taskId);
  parameters.set("returnTo", getSafeTaskArchiveReturnTo(returnTo));
  return `/task?${parameters.toString()}`;
}

export function getTaskArchiveLocation(search: string): {
  archived: boolean;
  returnTo: string;
} {
  const parameters = new URLSearchParams(search);
  return {
    archived:
      parameters.get("archived") === "1" &&
      !parameters.has("task"),
    returnTo: getSafeTaskReturnTo(parameters.get("returnTo")),
  };
}

export function getSafeTaskArchiveReturnTo(value: string | null): string {
  if (!value) return createTaskArchiveLocation("/task");

  try {
    const parsed = new URL(value, "https://leilei-os.invalid");
    const keys = [...parsed.searchParams.keys()];
    if (
      parsed.origin !== "https://leilei-os.invalid" ||
      parsed.pathname !== "/task" ||
      keys.some((key) => !["archived", "returnTo"].includes(key)) ||
      parsed.searchParams.getAll("archived").length !== 1 ||
      parsed.searchParams.get("archived") !== "1" ||
      parsed.searchParams.getAll("returnTo").length > 1
    ) {
      return createTaskArchiveLocation("/task");
    }
    return createTaskArchiveLocation(
      getSafeTaskReturnTo(parsed.searchParams.get("returnTo")),
    );
  } catch {
    return createTaskArchiveLocation("/task");
  }
}

export function createTaskDetailLocation(
  taskId: string,
  returnTo: string,
): string {
  const parameters = new URLSearchParams();
  parameters.set("task", taskId);
  parameters.set("returnTo", getSafeTaskReturnTo(returnTo));
  return `/task?${parameters.toString()}`;
}

export function getSafeTaskReturnTo(value: string | null): string {
  if (!value) return "/task";

  try {
    const parsed = new URL(value, "https://leilei-os.invalid");
    if (
      parsed.origin !== "https://leilei-os.invalid" ||
      parsed.pathname !== "/task"
    ) {
      return "/task";
    }

    const allowed = new Set([
      "q", "status", "priority", "tag", "due", "due_from", "due_to",
    ]);
    if (
      [...parsed.searchParams.keys()].some((key) => !allowed.has(key)) ||
      [...allowed].some((key) => parsed.searchParams.getAll(key).length > 1)
    ) {
      return "/task";
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/task";
  }
}
