import { useLayoutEffect, useRef } from "react";
import {
  useLocation,
  useNavigationType,
} from "react-router-dom";
import { ROUTE_SCROLL_STATE_KEY } from "../pages/app-navigation";

const TOP_LEVEL_PATHNAMES = new Set([
  "/",
  "/memory",
  "/diary",
  "/task",
  "/day-space",
  "/search",
  "/settings/account",
  "/settings/status",
  "/settings/data",
  "/settings/about",
  "/settings",
  "/universe",
]);

type RouteScrollMarker = {
  version: 1;
  pathname: string;
};

function readRouteScrollMarker(state: unknown): RouteScrollMarker | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }
  const marker = (state as Record<string, unknown>)[ROUTE_SCROLL_STATE_KEY];
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
    return null;
  }
  const candidate = marker as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    typeof candidate.pathname !== "string" ||
    !TOP_LEVEL_PATHNAMES.has(candidate.pathname)
  ) {
    return null;
  }
  return {
    version: 1,
    pathname: candidate.pathname,
  };
}

function consumeRouteScrollMarker(): RouteScrollMarker | null {
  const marker = readRouteScrollMarker(window.history.state);
  if (!marker) return null;
  const state = window.history.state;
  const nextState = {
    ...(state as Record<string, unknown>),
  };
  delete nextState[ROUTE_SCROLL_STATE_KEY];
  window.history.replaceState(nextState, "", window.location.href);
  return marker;
}

export function RouteScrollManager() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const previousPathname = useRef<string | null>(null);

  useLayoutEffect(() => {
    const previous = previousPathname.current;
    previousPathname.current = pathname;
    const marker = consumeRouteScrollMarker();

    if (previous === null || !TOP_LEVEL_PATHNAMES.has(pathname)) return;

    const pathnameChanged = previous !== pathname;
    const pushedOrReplaced =
      navigationType === "PUSH" || navigationType === "REPLACE";
    const markerRequestsReset =
      marker?.pathname === pathname && marker.pathname !== previous;

    if ((pathnameChanged && pushedOrReplaced) || markerRequestsReset) {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: "auto",
      });
    }
  }, [navigationType, pathname]);

  return null;
}
