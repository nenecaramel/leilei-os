export type TaskDueFilter =
  | ""
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
  "overdue",
  "today",
  "next_7_days",
  "custom",
]);

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
} {
  const parameters = new URLSearchParams(search);
  const taskId = parameters.get("task")?.trim() || null;

  return {
    taskId,
    returnTo: getSafeTaskReturnTo(parameters.get("returnTo")),
  };
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

    parsed.searchParams.delete("task");
    parsed.searchParams.delete("returnTo");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/task";
  }
}
