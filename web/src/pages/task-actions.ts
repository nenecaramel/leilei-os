export type TaskAction = "start" | "complete" | "cancel" | "reopen";

const actionOrder: TaskAction[] = ["start", "complete", "cancel", "reopen"];

export function getTaskActionControls(
  allowedActions: readonly TaskAction[],
): TaskAction[] {
  const allowed = new Set(allowedActions);
  return actionOrder.filter((action) => allowed.has(action));
}
