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

function syncUniverseDiaryThemeColor(targetPathname: string): void {
  const themeColor =
    targetPathname === "/universe"
      ? "#0b0c12"
      : targetPathname === "/diary"
        ? "#ebeae4"
        : null;
  if (!themeColor) return;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", themeColor);
}

export function navigateWithinApp(
  location: string,
  state: unknown = null,
  options: NavigateWithinAppOptions = {},
): void {
  const targetPathname = new URL(location, window.location.origin).pathname;
  const nextState = asHistoryState(state);
  delete nextState[ROUTE_SCROLL_STATE_KEY];
  if (options.resetScroll !== false && targetPathname !== window.location.pathname) {
    const marker: RouteScrollMarker = {
      version: 1,
      pathname: targetPathname,
    };
    nextState[ROUTE_SCROLL_STATE_KEY] = marker;
  }
  syncUniverseDiaryThemeColor(targetPathname);
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
