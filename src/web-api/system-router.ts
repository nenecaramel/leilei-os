import { Router, type RequestHandler, type Response } from "express";
import type { SystemActivityItem, SystemConnections, SystemDataSummary } from "../domains/system/system-service.js";

export type SystemApiDependencies = {
  systemService: {
    readConnections(): SystemConnections;
    readDataSummary(userId: string): Promise<SystemDataSummary>;
    readActivity(userId: string): Promise<SystemActivityItem[]>;
  };
};

export function createSystemApiRouter(
  dependencies: SystemApiDependencies,
): Router {
  const router = Router();
  router.get("/connections", createConnectionsSystemApiHandler(dependencies));
  router.get("/data", createDataSystemApiHandler(dependencies));
  router.get("/activity", createActivitySystemApiHandler(dependencies));
  return router;
}

export function createConnectionsSystemApiHandler(
  dependencies: SystemApiDependencies,
): RequestHandler {
  return (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    try {
      response.json({ success: true, data: dependencies.systemService.readConnections() });
    } catch {
      sendSystemUnavailable(response);
    }
  };
}

export function createDataSystemApiHandler(
  dependencies: SystemApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    try {
      const data = await dependencies.systemService.readDataSummary(request.webUserId!);
      response.json({ success: true, data });
    } catch {
      sendSystemUnavailable(response);
    }
  };
}

export function createActivitySystemApiHandler(
  dependencies: SystemApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    try {
      const events = await dependencies.systemService.readActivity(request.webUserId!);
      response.json({ success: true, data: { events } });
    } catch {
      sendSystemUnavailable(response);
    }
  };
}

function requireWebUser(response: Response, userId: string | undefined): userId is string {
  if (userId) return true;
  response.status(401).json({
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "Web API authentication is required.",
    },
  });
  return false;
}

function sendSystemUnavailable(response: Response): void {
  response.status(503).json({
    success: false,
    error: {
      code: "SYSTEM_UNAVAILABLE",
      message: "System data is temporarily unavailable.",
    },
  });
}
