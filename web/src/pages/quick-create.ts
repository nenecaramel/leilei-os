export type QuickCreateTarget = "memory" | "diary" | "task";

const QUICK_CREATE_TARGETS: readonly QuickCreateTarget[] = [
  "memory",
  "diary",
  "task",
];

export function isQuickCreateTarget(
  value: unknown,
): value is QuickCreateTarget {
  return typeof value === "string" &&
    QUICK_CREATE_TARGETS.includes(value as QuickCreateTarget);
}

export function createQuickCreateState(
  state: unknown,
  target: QuickCreateTarget,
): Record<string, unknown> {
  return {
    ...(state && typeof state === "object" ? state : {}),
    quickCreate: target,
  };
}

export function consumeQuickCreateTarget(
  expected: QuickCreateTarget,
): boolean {
  if (typeof window === "undefined") return false;
  const state = window.history.state;
  const target = state && typeof state === "object"
    ? (state as { quickCreate?: unknown }).quickCreate
    : undefined;
  if (target !== expected || !isQuickCreateTarget(target)) return false;

  const nextState = { ...(state as Record<string, unknown>) };
  delete nextState.quickCreate;
  window.history.replaceState(nextState, "", window.location.href);
  return true;
}
