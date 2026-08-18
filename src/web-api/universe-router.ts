import { Router, type RequestHandler, type Response } from "express";
import { UniverseServiceError, type UniverseService } from "../domains/universe/universe-service.js";

export type UniverseApiDependencies = {
  universeService: Pick<UniverseService,
    | "loadUniverse"
    | "saveUniverse"
    | "createNode"
    | "updateNode"
    | "deleteNode"
    | "createRelation"
    | "deleteRelation"
    | "latestRevision"
    | "restoreLatestRevision"
    | "createBackup"
    | "latestBackup"
    | "restoreBackup"
    | "ensureDailyBackup"
  >;
};

/**
 * The Universe API intentionally exposes command-shaped endpoints rather than
 * generic store CRUD. Every response is private because the payload is the
 * authenticated user's complete personal graph.
 */
export function createUniverseApiRouter(dependencies: UniverseApiDependencies): Router {
  const router = Router();
  router.get("/", handler(dependencies, async (request) => dependencies.universeService.loadUniverse(request.webUserId!)));
  router.put("/", handler(dependencies, async (request) => {
    const body = bodyRecord(request.body);
    const expectedVersion = readExpectedVersion(body);
    const snapshot = body.snapshot ?? omit(body, "expected_version");
    return dependencies.universeService.saveUniverse(request.webUserId!, snapshot, expectedVersion);
  }));

  router.post("/nodes", handler(dependencies, async (request) => {
    const body = bodyRecord(request.body);
    const expectedVersion = readExpectedVersion(body);
    return dependencies.universeService.createNode(request.webUserId!, body.node ?? omit(body, "expected_version"), expectedVersion);
  }));
  router.patch("/nodes/:id", handler(dependencies, async (request) => {
    const body = bodyRecord(request.body);
    const expectedVersion = readExpectedVersion(body);
    const patch = body.patch ?? omit(body, "expected_version", "reason");
    const reason = body.reason === undefined ? "update" : readString(body.reason, "reason");
    return dependencies.universeService.updateNode(request.webUserId!, routeParam(request.params.id), patch as never, reason, expectedVersion);
  }));
  router.delete("/nodes/:id", handler(dependencies, async (request) => {
    const body = bodyRecord(request.body);
    const expectedVersion = readExpectedVersion(body);
    return dependencies.universeService.deleteNode(request.webUserId!, routeParam(request.params.id), expectedVersion);
  }));

  router.post("/relations", handler(dependencies, async (request) => {
    const body = bodyRecord(request.body);
    const expectedVersion = readExpectedVersion(body);
    return dependencies.universeService.createRelation(request.webUserId!, body.relation ?? omit(body, "expected_version"), expectedVersion);
  }));
  router.delete("/relations/:id", handler(dependencies, async (request) => {
    const body = bodyRecord(request.body);
    const expectedVersion = readExpectedVersion(body);
    return dependencies.universeService.deleteRelation(request.webUserId!, routeParam(request.params.id), expectedVersion);
  }));

  router.get("/nodes/:id/revisions/latest", handler(dependencies, async (request) =>
    dependencies.universeService.latestRevision(request.webUserId!, routeParam(request.params.id))));
  router.post("/nodes/:id/revisions/restore", handler(dependencies, async (request) => {
    const body = bodyRecord(request.body);
    return dependencies.universeService.restoreLatestRevision(
      request.webUserId!,
      routeParam(request.params.id),
      readExpectedVersion(body),
    );
  }));

  router.post("/backups", handler(dependencies, async (request) => {
    const body = bodyRecord(request.body);
    const reason = body.reason === undefined ? "manual" : readString(body.reason, "reason");
    return dependencies.universeService.createBackup(request.webUserId!, reason);
  }));
  router.get("/backups/latest", handler(dependencies, async (request) =>
    dependencies.universeService.latestBackup(request.webUserId!)));
  router.post("/backups/daily", handler(dependencies, async (request) =>
    dependencies.universeService.ensureDailyBackup(request.webUserId!)));
  router.post("/backups/:id/restore", handler(dependencies, async (request) => {
    const body = bodyRecord(request.body);
    return dependencies.universeService.restoreBackup(
      request.webUserId!,
      routeParam(request.params.id),
      readExpectedVersion(body),
    );
  }));
  return router;
}

function handler(
  _dependencies: UniverseApiDependencies,
  operation: (request: Parameters<RequestHandler>[0]) => Promise<unknown>,
): RequestHandler {
  return async (request, response) => {
    noStore(response);
    if (!requireUser(response, request.webUserId)) return;
    try {
      rejectClientIdentity(request.body, request.query);
      const data = await operation(request);
      response.json({ success: true, data });
    } catch (error) {
      sendUniverseError(response, error);
    }
  };
}

function noStore(response: Response): void {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Pragma", "no-cache");
}

function requireUser(response: Response, userId: string | undefined): userId is string {
  if (userId) return true;
  response.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Web API authentication is required." } });
  return false;
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UniverseServiceError("INVALID_UNIVERSE", "Universe request body must be an object.");
  }
  return value as Record<string, unknown>;
}

function readExpectedVersion(body: Record<string, unknown>): number {
  const value = body.expected_version;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new UniverseServiceError("INVALID_UNIVERSE", "expected_version must be a non-negative integer.");
  }
  return value as number;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new UniverseServiceError("INVALID_UNIVERSE", `${field} must be a non-empty string.`);
  }
  return value;
}

function omit(body: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(body).filter(([key]) => !excluded.has(key)));
}

function rejectClientIdentity(body: unknown, query: Record<string, unknown>): void {
  const has = (value: unknown, seen = new Set<object>()): boolean => {
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    if (Object.prototype.hasOwnProperty.call(value, "user_id") || Object.prototype.hasOwnProperty.call(value, "userId")) return true;
    if (Array.isArray(value)) return value.some((item) => has(item, seen));
    return Object.values(value).some((item) => has(item, seen));
  };
  if (has(body) || has(query)) {
    throw new UniverseServiceError("INVALID_UNIVERSE", "Client identity selectors are not accepted.");
  }
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sendUniverseError(response: Response, error: unknown): void {
  if (!(error instanceof UniverseServiceError)) {
    response.status(503).json({ success: false, error: { code: "UNIVERSE_FAILED", message: "Universe is temporarily unavailable." } });
    return;
  }
  const code = error.code;
  if (code === "USER_NOT_FOUND" || code === "USER_DISABLED") {
    response.status(403).json({ success: false, error: { code: "UNIVERSE_UNAVAILABLE", message: "Universe is unavailable." } });
    return;
  }
  if (code === "VERSION_CONFLICT") {
    response.status(409).json({ success: false, error: { code, message: "Universe changed on another device." } });
    return;
  }
  if (code === "RELATION_CONFLICT") {
    response.status(409).json({ success: false, error: { code, message: "The relation already exists." } });
    return;
  }
  if (code === "NODE_CONFLICT") {
    response.status(409).json({ success: false, error: { code, message: "The node already exists." } });
    return;
  }
  if (code === "INVALID_UNIVERSE" || code === "RELATION_INVALID") {
    response.status(400).json({ success: false, error: { code, message: "Universe request is invalid." } });
    return;
  }
  if (code === "UNIVERSE_NOT_INITIALIZED" || code === "NODE_NOT_FOUND" || code === "RELATION_NOT_FOUND" ||
      code === "REVISION_NOT_FOUND" || code === "BACKUP_NOT_FOUND") {
    response.status(404).json({ success: false, error: { code, message: "Universe resource was not found." } });
    return;
  }
  response.status(503).json({ success: false, error: { code: "UNIVERSE_FAILED", message: "Universe is temporarily unavailable." } });
}
