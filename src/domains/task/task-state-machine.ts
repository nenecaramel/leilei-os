import type { TaskStatus } from "./task-repository.js";

export type TaskAction = "start" | "complete" | "cancel";

const transitions: Record<TaskStatus, Partial<Record<TaskAction, TaskStatus>>> = {
  pending: {
    start: "in_progress",
    cancel: "cancelled",
  },
  in_progress: {
    complete: "completed",
    cancel: "cancelled",
  },
  completed: {},
  cancelled: {},
};

export class TaskStateTransitionError extends Error {
  constructor(current: TaskStatus, next: TaskStatus) {
    super(`Task cannot transition from ${current} to ${next}.`);
    this.name = "TaskStateTransitionError";
  }
}

export function getAllowedTaskActions(status: TaskStatus): TaskAction[] {
  return Object.keys(transitions[status]) as TaskAction[];
}

export function assertTaskStatusTransition(
  current: TaskStatus,
  next: TaskStatus,
): void {
  if (current === next) return;

  const allowed = Object.values(transitions[current]);
  if (!allowed.includes(next)) {
    throw new TaskStateTransitionError(current, next);
  }
}
