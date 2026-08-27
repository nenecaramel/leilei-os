import { AsyncLocalStorage } from "node:async_hooks";

export type RouteClass =
  | "health"
  | "ready"
  | "web_api"
  | "mcp_public"
  | "mcp_internal"
  | "oauth_metadata"
  | "other";

const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function runWithRequestContext<T>(
  context: { requestId: string },
  callback: () => T,
): T {
  return requestContext.run(context, callback);
}

export function runWithoutRequestContext<T>(callback: () => T): T {
  return requestContext.exit(callback);
}

export function getCurrentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

function matchesRoute(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function classifyRoute(pathname: string): RouteClass {
  const pathOnly = pathname.split("?", 1)[0] ?? pathname;

  if (pathOnly === "/health") return "health";
  if (pathOnly === "/ready") return "ready";
  if (matchesRoute(pathOnly, "/api/v1")) return "web_api";
  if (matchesRoute(pathOnly, "/mcp")) return "mcp_public";
  if (matchesRoute(pathOnly, "/internal/mcp")) return "mcp_internal";
  if (
    pathOnly === "/oauth" ||
    pathOnly === "/.well-known/oauth-protected-resource" ||
    pathOnly === "/.well-known/oauth-protected-resource/mcp"
  ) {
    return "oauth_metadata";
  }
  return "other";
}
