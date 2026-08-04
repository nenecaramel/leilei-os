export function navigateWithinApp(
  location: string,
  state: unknown = null,
): void {
  window.history.pushState(state, "", location);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function isSearchLocation(location: string): boolean {
  try {
    const parsed = new URL(location, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname === "/search";
  } catch {
    return false;
  }
}
