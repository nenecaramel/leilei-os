import {
    Router,
    type RequestHandler,
    type Response,
  } from "express";
  import {
    TaskDomainError,
    type ListTasksResult,
    type TaskEntryResult,
  } from "../domains/task/task-service.js";
  
  export type TaskApiDependencies = {
    taskService: {
      listTasks(input: {
        userId: string;
        limit?: number;
      }): Promise<ListTasksResult>;
  
      readTask(input: {
        userId: string;
        id: string;
      }): Promise<TaskEntryResult>;
  
      createWebTask(input: {
        userId: string;
        title: string;
        description: string;
        priority: string;
        dueTime: string;
        timezone: string;
        tags?: readonly string[];
      }): Promise<TaskEntryResult>;
  
      updateWebTaskStatus(input: {
        userId: string;
        id: string;
        status: string;
      }): Promise<TaskEntryResult>;
    };
  };
  
  export function createTaskApiRouter(
    dependencies: TaskApiDependencies,
  ): Router {
    const router = Router();
  
    router.get("/", createListTasksApiHandler(dependencies));
    router.get("/:id", createReadTaskApiHandler(dependencies));
    router.post("/", createCreateTaskApiHandler(dependencies));
    router.patch(
      "/:id/status",
      createUpdateTaskStatusApiHandler(dependencies),
    );
  
    return router;
  }
  
  export function createListTasksApiHandler(
    dependencies: TaskApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
  
      try {
        const data = await dependencies.taskService.listTasks({
          userId: request.webUserId,
        });
  
        response.json({
          success: true,
          data,
        });
      } catch (error) {
        sendTaskError(response, error);
      }
    };
  }
  
  export function createReadTaskApiHandler(
    dependencies: TaskApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
  
      try {
        const data = await dependencies.taskService.readTask({
          userId: request.webUserId,
          id: getRouteParam(request.params.id),
        });
  
        response.json({
          success: true,
          data,
        });
      } catch (error) {
        sendTaskError(response, error);
      }
    };
  }
  
  export function createCreateTaskApiHandler(
    dependencies: TaskApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
  
      try {
        const data = await dependencies.taskService.createWebTask({
          userId: request.webUserId,
          title: request.body.title,
          description: request.body.description,
          priority: request.body.priority,
          dueTime: request.body.dueTime,
          timezone: request.body.timezone,
          tags: request.body.tags,
        });
  
        response.status(201).json({
          success: true,
          data,
        });
      } catch (error) {
        sendTaskError(response, error);
      }
    };
  }
  
  export function createUpdateTaskStatusApiHandler(
    dependencies: TaskApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
  
      try {
        const data =
          await dependencies.taskService.updateWebTaskStatus({
            userId: request.webUserId,
            id: getRouteParam(request.params.id),
            status: request.body.status,
          });
  
        response.json({
          success: true,
          data,
        });
      } catch (error) {
        sendTaskError(response, error);
      }
    };
  }
  
  function sendUnauthorized(response: Response): void {
    response.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Web API authentication is required.",
      },
    });
  }
  
  function sendTaskError(
    response: Response,
    error: unknown,
  ): void {
    if (error instanceof TaskDomainError) {
      if (
        error.code === "USER_NOT_FOUND" ||
        error.code === "USER_DISABLED"
      ) {
        response.status(403).json({
          success: false,
          error: {
            code: "TASK_UNAVAILABLE",
            message:
              "Tasks are unavailable for the authenticated user.",
          },
        });
        return;
      }
  
      if (error.code === "TASK_NOT_FOUND") {
        response.status(404).json({
          success: false,
          error: {
            code: "TASK_NOT_FOUND",
            message: "Task was not found.",
          },
        });
        return;
      }
  
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_TASK_REQUEST",
          message: "The task request is invalid.",
        },
      });
      return;
    }
  
    response.status(503).json({
      success: false,
      error: {
        code: "TASK_UNAVAILABLE",
        message: "Tasks are temporarily unavailable.",
      },
    });
  }
  
  function getRouteParam(
    value: string | string[] | undefined,
  ): string {
    return Array.isArray(value)
      ? value[0] ?? ""
      : value ?? "";
  }