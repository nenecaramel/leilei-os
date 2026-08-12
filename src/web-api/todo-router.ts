import { Router, type RequestHandler, type Response } from "express";
import { TodoServiceError, type TodoService } from "../domains/todo/todo-service.js";

export type TodoApiDependencies = { todoService: Pick<TodoService, "readDay" | "listDates" | "replacePaper"> };

export function createTodoApiRouter(dependencies: TodoApiDependencies): Router {
  const router = Router();
  router.get("/dates", listDatesHandler(dependencies));
  router.get("/:date", readDayHandler(dependencies));
  router.put("/:date/:author", replacePaperHandler(dependencies));
  return router;
}

function requireUser(response: Response, userId: string | undefined): userId is string {
  if (userId) return true;
  response.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Web API authentication is required." } });
  return false;
}

function listDatesHandler({ todoService }: TodoApiDependencies): RequestHandler {
  return async (request, response) => {
    if (!requireUser(response, request.webUserId)) return;
    try { response.json({ success: true, data: { dates: await todoService.listDates(request.webUserId) } }); }
    catch { unavailable(response); }
  };
}

function readDayHandler({ todoService }: TodoApiDependencies): RequestHandler {
  return async (request, response) => {
    if (!requireUser(response, request.webUserId)) return;
    try { response.json({ success: true, data: await todoService.readDay(request.webUserId, routeParam(request.params.date)) }); }
    catch (error) { mapError(response, error); }
  };
}

function replacePaperHandler({ todoService }: TodoApiDependencies): RequestHandler {
  return async (request, response) => {
    if (!requireUser(response, request.webUserId)) return;
    try {
      const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
      const paper = await todoService.replacePaper({
        userId: request.webUserId,
        date: routeParam(request.params.date),
        author: routeParam(request.params.author),
        revision: body.revision,
        entries: body.entries,
      });
      response.json({ success: true, data: paper });
    } catch (error) { mapError(response, error); }
  };
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function mapError(response: Response, error: unknown): void {
  if (error instanceof TodoServiceError) {
    if (error.code === "TODO_PAPER_CONFLICT") {
      response.status(409).json({ success: false, error: { code: error.code, message: "Todo paper changed on another device." } });
      return;
    }
    response.status(400).json({ success: false, error: { code: error.code, message: "Todo request is invalid." } });
    return;
  }
  unavailable(response);
}

function unavailable(response: Response): void {
  response.status(503).json({ success: false, error: { code: "TODO_UNAVAILABLE", message: "Todo is temporarily unavailable." } });
}
