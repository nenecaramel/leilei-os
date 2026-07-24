import { Router } from "express";
import {
  createMemoryApiRouter,
  type MemoryApiDependencies,
} from "./memory-router.js";
import {
  createDiaryApiRouter,
  type DiaryApiDependencies,
} from "./diary-router.js";
import {
  createTaskApiRouter,
  type TaskApiDependencies,
} from "./task-router.js";
import {
  createHealthApiRouter,
  type HealthApiDependencies,
} from "./health-router.js";

export type WebApiRouterDependencies = {
  memory: MemoryApiDependencies;
  diary: DiaryApiDependencies;
  task: TaskApiDependencies;
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
      data: {
        authenticated: true,
      },
    });
  });

  router.use(
    "/memory",
    createMemoryApiRouter(dependencies.memory),
  );

  router.use(
    "/diary",
    createDiaryApiRouter(dependencies.diary),
  );

  router.use(
    "/task",
    createTaskApiRouter(dependencies.task),
  );

  router.use(
    "/health",
    createHealthApiRouter(dependencies.health),
  );

  return router;
}