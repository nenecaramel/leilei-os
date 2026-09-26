export type QuickCreateTarget = "diary";

const QUICK_CREATE_TARGETS: readonly QuickCreateTarget[] = [
  "diary",
];

export function isQuickCreateTarget(
  value: unknown,
): value is QuickCreateTarget {
  return value === "diary";
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
  if (
    !state
    || typeof state !== "object"
    || !Object.prototype.hasOwnProperty.call(
      state,
      "quickCreate",
    )
  ) {
    return false;
  }
  const target =
    (state as { quickCreate?: unknown }).quickCreate;
  const matches =
    target === expected
    && isQuickCreateTarget(target);
  const nextState = {
    ...(state as Record<string, unknown>),
  };
  delete nextState.quickCreate;
  window.history.replaceState(
    nextState,
    "",
    window.location.href,
  );
  return matches;
}
