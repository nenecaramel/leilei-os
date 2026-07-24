import { Router, type RequestHandler } from "express";
import type { SyncHealthInput } from "../domains/health/health-service.js";

export type HealthApiDependencies = {
  healthService: {
    syncHealth(
      userId: string,
      input: SyncHealthInput,
    ): Promise<unknown>;
  };
};

export function createHealthApiRouter(
  dependencies: HealthApiDependencies,
): Router {
  const router = Router();

  router.post("/", createSyncHealthApiHandler(dependencies));

  return router;
}

export function createSyncHealthApiHandler(
  dependencies: HealthApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!request.webUserId) {
      response.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Web API authentication is required.",
        },
      });
      return;
    }

    try {
      const data = await dependencies.healthService.syncHealth(
        request.webUserId,
        {
          date: request.body.date,
          steps: request.body.steps,
          periodStartDate: request.body.periodStartDate,
        },
      );

      response.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error(
        "Web Health API failed",
        error instanceof Error ? error.name : "UnknownError",
      );

      response.status(503).json({
        success: false,
        error: {
          code: "HEALTH_UNAVAILABLE",
          message: "Health sync is temporarily unavailable.",
        },
      });
    }
  };
} 