import { Router } from "express";
import {
  createMemoryApiRouter,
  type MemoryApiDependencies,
} from "./memory-router.js";
import {
  createHealthApiRouter,
  type HealthApiDependencies,
} from "./health-router.js";

export type WebApiRouterDependencies = {
  memory: MemoryApiDependencies;
  health: HealthApiDependencies;
};

export function createWebApiRouter(
  dependencies: WebApiRouterDependencies,
): Router {
  const router = Router();

  router.get("/session", (request, response) => {
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

    response.json({
      success: true,
      data: { authenticated: true },
    });
  });

  router.use("/memory", createMemoryApiRouter(dependencies.memory));

  router.use("/health", createHealthApiRouter(dependencies.health));

  return router;
}