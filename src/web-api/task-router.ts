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
  import type { ContentAuthor } from "../domains/content-author.js";
  
  export type TaskApiDependencies = {
    taskService: {
      listTasks(input: {
        userId: string;
        limit?: number;
        query?: import("../domains/task/task-service.js").RawTaskListQuery;
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
        dueTime?: string | null;
        timezone?: string;
        tags?: readonly string[];
        author?: ContentAuthor;
      }): Promise<TaskEntryResult>;
  
      updateWebTaskStatus(input: {
        userId: string;
        id: string;
        status: string;
      }): Promise<TaskEntryResult>;

      reopenTask(input: {
        userId: string;
        id: string;
      }): Promise<TaskEntryResult>;

      updateWebTask(input: {
        userId: string;
        id: string;
        title: string;
        description: string;
        priority: string;
        dueTime?: string | null;
        timezone?: string;
        tags?: readonly string[];
        author?: ContentAuthor;
      }): Promise<TaskEntryResult>;
      listArchivedTasks?(input: { userId: string; limit?: number }): Promise<ListTasksResult>;
      readArchivedTask?(input: { userId: string; id: string }): Promise<TaskEntryResult>;
      archiveTask?(input: { userId: string; id: string }): Promise<void>;
      restoreTask?(input: { userId: string; id: string }): Promise<void>;
      permanentlyDeleteTask?(input: { userId: string; id: string }): Promise<void>;
    };
  };
  
  export function createTaskApiRouter(
    dependencies: TaskApiDependencies,
  ): Router {
    const router = Router();
  
    router.get("/archived", createListArchivedTasksApiHandler(dependencies));
    router.get("/archived/:id", createReadArchivedTaskApiHandler(dependencies));
    router.post("/archived/:id/restore", createRestoreTaskApiHandler(dependencies));
    router.delete("/archived/:id/permanent", createTaskPermanentDeleteApiHandler(dependencies));
    router.post("/:id/reopen", createReopenTaskApiHandler(dependencies));
    router.get("/", createListTasksApiHandler(dependencies));
    router.get("/:id", createReadTaskApiHandler(dependencies));
    router.post("/", createCreateTaskApiHandler(dependencies));
    router.delete("/:id", createArchiveTaskApiHandler(dependencies));
    router.patch("/:id", createUpdateTaskApiHandler(dependencies));
    router.patch(
      "/:id/status",
      createUpdateTaskStatusApiHandler(dependencies),
    );
  
    return router;
  }

  export function createListArchivedTasksApiHandler(dependencies: TaskApiDependencies): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) return sendUnauthorized(response);
      try { response.json({ success: true, data: await dependencies.taskService.listArchivedTasks!({ userId: request.webUserId }) }); }
      catch (error) { sendTaskError(response, error); }
    };
  }

  export function createReadArchivedTaskApiHandler(dependencies: TaskApiDependencies): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) return sendUnauthorized(response);
      try { response.json({ success: true, data: await dependencies.taskService.readArchivedTask!({ userId: request.webUserId, id: getRouteParam(request.params.id) }) }); }
      catch (error) { sendTaskError(response, error); }
    };
  }

  export function createArchiveTaskApiHandler(dependencies: TaskApiDependencies): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) return sendUnauthorized(response);
      try { await dependencies.taskService.archiveTask!({ userId: request.webUserId, id: getRouteParam(request.params.id) }); response.json({ success: true, data: {} }); }
      catch (error) { sendTaskError(response, error); }
    };
  }

  export function createRestoreTaskApiHandler(dependencies: TaskApiDependencies): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) return sendUnauthorized(response);
      try { await dependencies.taskService.restoreTask!({ userId: request.webUserId, id: getRouteParam(request.params.id) }); response.json({ success: true, data: {} }); }
      catch (error) { sendTaskError(response, error); }
    };
  }

  export function createTaskPermanentDeleteApiHandler(dependencies: TaskApiDependencies): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) return sendUnauthorized(response);
      try {
        await dependencies.taskService.permanentlyDeleteTask!({
          userId: request.webUserId,
          id: getRouteParam(request.params.id),
        });
        response.status(204).end();
      } catch (error) {
        sendTaskError(response, error);
      }
    };
  }

  export function createReopenTaskApiHandler(dependencies: TaskApiDependencies): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) return sendUnauthorized(response);
      try {
        const data = await dependencies.taskService.reopenTask({
          userId: request.webUserId,
          id: getRouteParam(request.params.id),
        });
        response.json({ success: true, data });
      } catch (error) {
        sendTaskError(response, error);
      }
    };
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
          query: {
            q: getQueryParam(request.query.q),
            status: getQueryParam(request.query.status),
            priority: getQueryParam(request.query.priority),
            tag: getQueryParam(request.query.tag),
            due: getQueryParam(request.query.due),
            dueFrom: getQueryParam(request.query.due_from),
            dueTo: getQueryParam(request.query.due_to),
          },
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
          author: request.body.author,
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

  export function createUpdateTaskApiHandler(
    dependencies: TaskApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }

      try {
        const data = await dependencies.taskService.updateWebTask({
          userId: request.webUserId,
          id: getRouteParam(request.params.id),
          title: request.body.title,
          description: request.body.description,
          priority: request.body.priority,
          dueTime: request.body.dueTime,
          timezone: request.body.timezone,
          tags: request.body.tags,
          ...(request.body.author === undefined ? {} : { author: request.body.author }),
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
      if (error.code === "AUTHOR_REQUIRED") {
        response.status(400).json({
          success: false,
          error: {
            code: "AUTHOR_REQUIRED",
            message: "Author selection is required.",
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

      if (error.code === "INVALID_TASK_STATUS_TRANSITION") {
        response.status(409).json({
          success: false,
          error: {
            code: "INVALID_TASK_STATUS_TRANSITION",
            message: error.message,
          },
        });
        return;
      }

      if (error.code === "INVALID_TASK_REOPEN_STATE" || error.code === "TASK_STATUS_CONFLICT") {
        response.status(409).json({
          success: false,
          error: {
            code: error.code,
            message: error.code === "TASK_STATUS_CONFLICT"
              ? "Task status changed; please retry."
              : "Task cannot be reopened.",
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

  function getQueryParam(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }
