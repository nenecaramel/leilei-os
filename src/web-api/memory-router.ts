import { Router, type RequestHandler } from "express";
import {
  MemoryDomainError,
  type ReadMemoryDetailResult,
  type ReadMemoryResult,
} from "../domains/memory/memory-service.js";

export type MemoryApiDependencies = {
  memoryService: {
    readMemory(input: {
      userId: string;
      query?: string;
      categories?: readonly string[];
      tag?: string;
      includeSource?: boolean;
    }): Promise<ReadMemoryResult>;

    listAvailableCategories(
      userId: string,
    ): Promise<Array<"profile" | "preference" | "goal" | "project">>;

    listAvailableTags(userId: string): Promise<string[]>;

    readMemoryDetail(input: {
      userId: string;
      id: string;
    }): Promise<ReadMemoryDetailResult>;

    createMemory(input: {
      userId: string;
      category: "profile" | "preference" | "goal" | "project";
      key: string;
      content: string;
      tags?: readonly string[];
    }): Promise<void>;

    updateMemory(input: {
      userId: string;
      id: string;
      content: string;
      tags?: readonly string[];
    }): Promise<void>;

    archiveMemory(input: {
      userId: string;
      id: string;
    }): Promise<void>;
  };
};

export function createMemoryApiRouter(
  dependencies: MemoryApiDependencies,
): Router {
  const router = Router();

  router.get("/", createReadMemoryApiHandler(dependencies));
  router.get("/:id", createReadMemoryDetailApiHandler(dependencies));
  router.post("/", createCreateMemoryApiHandler(dependencies));
  router.patch("/", createUpdateMemoryApiHandler(dependencies));
  router.delete("/", createArchiveMemoryApiHandler(dependencies));

  return router;
}

export function createReadMemoryDetailApiHandler(
  dependencies: MemoryApiDependencies,
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
      const data = await dependencies.memoryService.readMemoryDetail({
        userId: request.webUserId,
        id: getRouteParam(request.params.id),
      });

      response.json({
        success: true,
        data,
      });
    } catch (error) {
      if (error instanceof MemoryDomainError) {
        if (error.code === "MEMORY_NOT_FOUND") {
          response.status(404).json({
            success: false,
            error: {
              code: "MEMORY_NOT_FOUND",
              message: "Memory was not found.",
            },
          });
          return;
        }

        if (
          error.code === "USER_NOT_FOUND" ||
          error.code === "USER_DISABLED"
        ) {
          response.status(403).json({
            success: false,
            error: {
              code: "MEMORY_UNAVAILABLE",
              message: "Memory is unavailable for the authenticated user.",
            },
          });
          return;
        }
      }

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

export function createReadMemoryApiHandler(
  dependencies: MemoryApiDependencies,
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
      const category = getQueryParam(request.query.category);
      const [data, categories, tags] = await Promise.all([
        dependencies.memoryService.readMemory({
          userId: request.webUserId,
          query: getQueryParam(request.query.q),
          categories: category ? [category] : undefined,
          tag: getQueryParam(request.query.tag),
          includeSource: true,
        }),
        dependencies.memoryService.listAvailableCategories(
          request.webUserId,
        ),
        dependencies.memoryService.listAvailableTags(
          request.webUserId,
        ),
      ]);

      response.json({
        success: true,
        data: {
          ...data,
          metadata: {
            ...data.metadata,
            categories,
            tags,
          },
        },
      });
    } catch (error) {
      if (error instanceof MemoryDomainError) {
        const unavailable =
          error.code === "USER_NOT_FOUND" ||
          error.code === "USER_DISABLED";

        response.status(unavailable ? 403 : 400).json({
          success: false,
          error: {
            code: unavailable
              ? "MEMORY_UNAVAILABLE"
              : "INVALID_REQUEST",
            message: unavailable
              ? "Memory is unavailable for the authenticated user."
              : "The memory request is invalid.",
          },
        });

        return;
      }

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

export function createCreateMemoryApiHandler(
  dependencies: MemoryApiDependencies,
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
      await dependencies.memoryService.createMemory({
        userId: request.webUserId,
        category: request.body.category,
        key: request.body.key,
        content: request.body.content,
        tags: request.body.tags,
      });

      response.json({
        success: true,
      });
    } catch {
      response.status(400).json({
        success: false,
        error: {
          code: "CREATE_MEMORY_FAILED",
          message: "Unable to create memory.",
        },
      });
    }
  };
}

export function createUpdateMemoryApiHandler(
  dependencies: MemoryApiDependencies,
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
      await dependencies.memoryService.updateMemory({
        userId: request.webUserId,
        id: request.body.id,
        content: request.body.content,
        tags: request.body.tags,
      });

      response.json({
        success: true,
      });
    } catch {
      response.status(400).json({
        success: false,
        error: {
          code: "UPDATE_MEMORY_FAILED",
          message: "Unable to update memory.",
        },
      });
    }
  };
}

export function createArchiveMemoryApiHandler(
  dependencies: MemoryApiDependencies,
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
      await dependencies.memoryService.archiveMemory({
        userId: request.webUserId,
        id: request.body.id,
      });

      response.json({
        success: true,
      });
    } catch {
      response.status(400).json({
        success: false,
        error: {
          code: "ARCHIVE_MEMORY_FAILED",
          message: "Unable to archive memory.",
        },
      });
    }
  };
}

function getRouteParam(
  value: string | string[] | undefined,
): string {
  return Array.isArray(value)
    ? value[0] ?? ""
    : value ?? "";
}

function getQueryParam(
  value: unknown,
): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string"
      ? value[0]
      : undefined;
  }
  return typeof value === "string"
    ? value
    : undefined;
}
