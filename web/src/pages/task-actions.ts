export type TaskAction = "start" | "complete" | "cancel";

const actionOrder: TaskAction[] = ["start", "complete", "cancel"];

export function getTaskActionControls(
  allowedActions: readonly TaskAction[],
): TaskAction[] {
  const allowed = new Set(allowedActions);
  return actionOrder.filter((action) => allowed.has(action));
}
