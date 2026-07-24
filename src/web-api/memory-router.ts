import { Router, type RequestHandler } from "express";
import {
  MemoryDomainError,
  type ReadMemoryResult,
} from "../domains/memory/memory-service.js";

export type MemoryApiDependencies = {
  memoryService: {
    readMemory(input: { userId: string }): Promise<ReadMemoryResult>;
  };
};

export function createMemoryApiRouter(
  dependencies: MemoryApiDependencies,
): Router {
  const router = Router();
  router.get("/", createReadMemoryApiHandler(dependencies));
  return router;
}

export function createReadMemoryApiHandler(
  dependencies: MemoryApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!request.webUserId) {
      response.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Web API authentication is required." },
      });
      return;
    }

    try {
      const data = await dependencies.memoryService.readMemory({
        userId: request.webUserId,
      });
      response.json({ success: true, data });
    } catch (error) {
      if (error instanceof MemoryDomainError) {
        const unavailable =
          error.code === "USER_NOT_FOUND" || error.code === "USER_DISABLED";
        response.status(unavailable ? 403 : 400).json({
          success: false,
          error: {
            code: unavailable ? "MEMORY_UNAVAILABLE" : "INVALID_REQUEST",
            message: unavailable
              ? "Memory is unavailable for the authenticated user."
              : "The memory request is invalid.",
          },
        });
        return;
      }

      console.error(
        "Web Memory API failed",
        error,
      );
      response.status(503).json({
        success: false,
        error: {
          code: "MEMORY_UNAVAILABLE",
          message: "Memory is temporarily unavailable.",
        },
      });
    }
  };
}
