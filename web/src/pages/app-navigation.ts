export const ROUTE_SCROLL_STATE_KEY = "__leilei_route_scroll";

type RouteScrollMarker = {
  version: 1;
  pathname: string;
};

export type NavigateWithinAppOptions = {
  resetScroll?: boolean;
};

function asHistoryState(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return {};
  }
  return { ...(state as Record<string, unknown>) };
}

export function shouldReloadAcrossVisualSurface(
  currentPathname: string,
  targetPathname: string,
): boolean {
  return (
    (currentPathname === "/universe" && targetPathname === "/diary") ||
    (currentPathname === "/diary" && targetPathname === "/universe")
  );
}

export function navigateWithinApp(
  location: string,
  state: unknown = null,
  options: NavigateWithinAppOptions = {},
): void {
  const targetPathname = new URL(location, window.location.origin).pathname;
  if (shouldReloadAcrossVisualSurface(window.location.pathname, targetPathname)) {
    window.location.assign(location);
    return;
  }

  const nextState = asHistoryState(state);
  delete nextState[ROUTE_SCROLL_STATE_KEY];
  if (options.resetScroll !== false && targetPathname !== window.location.pathname) {
    const marker: RouteScrollMarker = {
      version: 1,
      pathname: targetPathname,
    };
    nextState[ROUTE_SCROLL_STATE_KEY] = marker;
  }
  window.history.pushState(nextState, "", location);
  window.dispatchEvent(new window.PopStateEvent("popstate"));
}

export function isSearchLocation(location: string): boolean {
  try {
    const parsed = new URL(location, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname === "/search";
  } catch {
    return false;
  }
}
