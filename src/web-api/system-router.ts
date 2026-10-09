import { Router, type RequestHandler, type Response } from "express";
import {
  SystemServiceError,
  type ClaudeAccountUsageSnapshot,
  type SystemConnections,
  type SystemDataSummary,
} from "../domains/system/system-service.js";

export type SystemApiDependencies = {
  systemService: {
    readConnections(userId: string): Promise<SystemConnections>;
    readDataSummary(userId: string): Promise<SystemDataSummary>;
    readClaudeUsage(userId: string): Promise<ClaudeAccountUsageSnapshot | null>;
  };
};

export function createSystemApiRouter(
  dependencies: SystemApiDependencies,
): Router {
  const router = Router();
  router.get("/connections", createConnectionsSystemApiHandler(dependencies));
  router.get("/data", createDataSystemApiHandler(dependencies));
  router.get("/claude-usage", createClaudeUsageSystemApiHandler(dependencies));
  return router;
}

export function createConnectionsSystemApiHandler(
  dependencies: SystemApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    try {
      response.json({ success: true, data: await dependencies.systemService.readConnections(request.webUserId!) });
    } catch (error) {
      sendSystemError(response, error);
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
    } catch (error) {
      sendSystemError(response, error);
    }
  };
}

export function createClaudeUsageSystemApiHandler(
  dependencies: SystemApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    try {
      response.json({
        success: true,
        data:
          await dependencies.systemService.readClaudeUsage(
            request.webUserId!,
          ),
      });
    } catch (error) {
      sendSystemError(response, error);
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

function sendSystemError(response: Response, error: unknown): void {
  const forbidden = error instanceof SystemServiceError && (error.code === "USER_NOT_FOUND" || error.code === "USER_DISABLED");
  response.status(forbidden ? 403 : 503).json({
    success: false,
    error: {
      code: "SYSTEM_UNAVAILABLE",
      message: "System data is temporarily unavailable.",
    },
  });
}
