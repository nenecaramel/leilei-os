import {
    Router,
    type RequestHandler,
    type Response,
  } from "express";
  import { 
    DiaryDomainError,
    type DiaryEntryResult,
    type ListDiariesResult,
  } from "../domains/diary/diary-service.js";
  
  export type DiaryApiDependencies = {
    diaryService: {
      listDiaries(input: {
        userId: string;
        limit?: number;
      }): Promise<ListDiariesResult>;
  
      readDiary(input: {
        userId: string;
        id: string;
      }): Promise<DiaryEntryResult>;
  
      createWebDiary(input: {
        userId: string;
        title: string;
        content: string;
        date: string;
        tags?: readonly string[];
        mood?: string | null;
      }): Promise<DiaryEntryResult>;
  
      updateWebDiary(input: {
        userId: string;
        id: string;
        title: string;
        content: string;
        date: string;
        tags?: readonly string[];
        mood?: string | null;
      }): Promise<DiaryEntryResult>;
    };
  };
  
  export function createDiaryApiRouter(
    dependencies: DiaryApiDependencies,
  ): Router {
    const router = Router();
  
    router.get("/", createListDiariesApiHandler(dependencies));
    router.get("/:id", createReadDiaryApiHandler(dependencies));
    router.post("/", createCreateDiaryApiHandler(dependencies));
    router.patch("/:id", createUpdateDiaryApiHandler(dependencies));
  
    return router;
  }
  
  export function createListDiariesApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
  
      try {
        const data = await dependencies.diaryService.listDiaries({
          userId: request.webUserId,
        });
  
        response.json({
          success: true,
          data,
        });
      } catch (error) {
        sendDiaryError(response, error);
      }
    };
  }
  
  export function createReadDiaryApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
  
      try {
        const data = await dependencies.diaryService.readDiary({
          userId: request.webUserId,
          id: getRouteParam(request.params.id),
        });
  
        response.json({
          success: true,
          data,
        });
      } catch (error) {
        sendDiaryError(response, error);
      }
    };
  }
  
  export function createCreateDiaryApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
  
      try {
        const data = await dependencies.diaryService.createWebDiary({
          userId: request.webUserId,
          title: request.body.title,
          content: request.body.content,
          date: request.body.date,
          tags: request.body.tags,
          mood: request.body.mood,
        });
  
        response.status(201).json({
          success: true,
          data,
        });
      } catch (error) {
        sendDiaryError(response, error);
      }
    };
  }
  
  export function createUpdateDiaryApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
  
      try {
        const data = await dependencies.diaryService.updateWebDiary({
          userId: request.webUserId,
          id: getRouteParam(request.params.id),
          title: request.body.title,
          content: request.body.content,
          date: request.body.date,
          tags: request.body.tags,
          mood: request.body.mood,
        });
  
        response.json({
          success: true,
          data,
        });
      } catch (error) {
        sendDiaryError(response, error);
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
  
  function sendDiaryError(
    response: Response,
    error: unknown,
  ): void {
    if (error instanceof DiaryDomainError) {
      if (
        error.code === "USER_NOT_FOUND" ||
        error.code === "USER_DISABLED"
      ) {
        response.status(403).json({
          success: false,
          error: {
            code: "DIARY_UNAVAILABLE",
            message: "Diary is unavailable for the authenticated user.",
          },
        });
        return;
      }
  
      if (error.code === "DIARY_NOT_FOUND") {
        response.status(404).json({
          success: false,
          error: {
            code: "DIARY_NOT_FOUND",
            message: "Diary entry was not found.",
          },
        });
        return;
      }
  
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_DIARY_REQUEST",
          message: "The diary request is invalid.",
        },
      });
      return;
    }
  
    response.status(503).json({
      success: false,
      error: {
        code: "DIARY_UNAVAILABLE",
        message: "Diary is temporarily unavailable.",
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