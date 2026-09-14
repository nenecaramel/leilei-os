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
  import type { ContentAuthor } from "../domains/content-author.js";
  import {
    DiaryCommentDomainError,
    type AddDiaryCommentResult,
    type DiaryCommentResult,
    type ListDiaryCommentsResult,
  } from "../domains/diary/diary-comment-service.js";
  
  export type DiaryApiDependencies = {
    diaryService: {
      listDiaryContentDates(input: {
        userId: string;
      }): Promise<import("../domains/diary/diary-service.js").DiaryContentDatesResult>;

      listDiariesByDate(input: {
        userId: string;
        date: string;
      }): Promise<import("../domains/diary/diary-service.js").DiariesByDateResult>;

      listDiaries(input: {
        userId: string;
        limit?: number;
        query?: import("../domains/diary/diary-service.js").RawDiaryListQuery;
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
        author?: ContentAuthor;
      }): Promise<DiaryEntryResult>;
  
      updateWebDiary(input: {
        userId: string;
        id: string;
        title: string;
        content: string;
        date: string;
        tags?: readonly string[];
        mood?: string | null;
        author?: ContentAuthor;
      }): Promise<DiaryEntryResult>;

      listArchivedDiaries(input: {
        userId: string;
      }): Promise<ListDiariesResult>;

      readArchivedDiary(input: {
        userId: string;
        id: string;
      }): Promise<DiaryEntryResult>;

      archiveDiary(input: {
        userId: string;
        id: string;
      }): Promise<void>;

      restoreDiary(input: {
        userId: string;
        id: string;
      }): Promise<void>;

      permanentlyDeleteDiary(input: {
        userId: string;
        id: string;
      }): Promise<void>;
    };
    diaryCommentService?: {
      addWebComment(input: {
        userId: string;
        diaryId: string;
        author: ContentAuthor;
        content: string;
        idempotencyKey?: string;
      }): Promise<AddDiaryCommentResult>;
      getComment(input: {
        userId: string;
        id: string;
        scope?: "active" | "archived";
      }): Promise<DiaryCommentResult>;
      listComments(input: {
        userId: string;
        diaryId: string;
        scope?: "active" | "archived";
        limit?: number;
        before?: string;
      }): Promise<ListDiaryCommentsResult>;
      updateComment(input: {
        userId: string;
        id: string;
        expectedRevision: number;
        content: string;
      }): Promise<DiaryCommentResult>;
      deleteComment(input: {
        userId: string;
        id: string;
        expectedRevision: number;
      }): Promise<{ comment_id: string; deleted: true }>;
    };
  };
  
  export function createDiaryApiRouter(
    dependencies: DiaryApiDependencies,
  ): Router {
    const router = Router();
  
    router.get("/", createListDiariesApiHandler(dependencies));
    router.get("/dates", createListDiaryContentDatesApiHandler(dependencies));
    router.get("/by-date/:date", createListDiariesByDateApiHandler(dependencies));
    router.get(
      "/archived",
      createListArchivedDiariesApiHandler(dependencies),
    );
    router.get(
      "/archived/:id/comments",
      createListArchivedDiaryCommentsApiHandler(dependencies),
    );
    router.get(
      "/archived/:id/comments/:commentId",
      createReadArchivedDiaryCommentApiHandler(dependencies),
    );
    router.get(
      "/archived/:id",
      createReadArchivedDiaryApiHandler(dependencies),
    );
    router.post(
      "/archived/:id/restore",
      createRestoreDiaryApiHandler(dependencies),
    );
    router.delete(
      "/archived/:id/permanent",
      createDiaryPermanentDeleteApiHandler(dependencies),
    );
    router.get("/:id/comments", createListDiaryCommentsApiHandler(dependencies));
    router.post("/:id/comments", createAddDiaryCommentApiHandler(dependencies));
    router.get("/:id/comments/:commentId", createReadDiaryCommentApiHandler(dependencies));
    router.patch("/:id/comments/:commentId", createUpdateDiaryCommentApiHandler(dependencies));
    router.delete("/:id/comments/:commentId", createDeleteDiaryCommentApiHandler(dependencies));
    router.get("/:id", createReadDiaryApiHandler(dependencies));
    router.post("/", createCreateDiaryApiHandler(dependencies));
    router.patch("/:id", createUpdateDiaryApiHandler(dependencies));
    router.delete("/:id", createArchiveDiaryApiHandler(dependencies));
  
  return router;
}

export function createListDiaryContentDatesApiHandler(
  dependencies: DiaryApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!request.webUserId) {
      sendUnauthorized(response);
      return;
    }
    try {
      const data = await dependencies.diaryService.listDiaryContentDates({
        userId: request.webUserId,
      });
      response.json({ success: true, data });
    } catch (error) {
      sendDiaryError(response, error);
    }
  };
}

export function createListDiariesByDateApiHandler(
  dependencies: DiaryApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!request.webUserId) {
      sendUnauthorized(response);
      return;
    }
    try {
      const data = await dependencies.diaryService.listDiariesByDate({
        userId: request.webUserId,
        date: getRouteParam(request.params.date),
      });
      response.json({ success: true, data });
    } catch (error) {
      sendDiaryError(response, error);
    }
  };
}

  export function createListArchivedDiariesApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
      try {
        const data = await dependencies.diaryService.listArchivedDiaries({
          userId: request.webUserId,
        });
        response.json({ success: true, data });
      } catch (error) {
        sendDiaryError(response, error);
      }
    };
  }

  export function createReadArchivedDiaryApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
      try {
        const data = await dependencies.diaryService.readArchivedDiary({
          userId: request.webUserId,
          id: getRouteParam(request.params.id),
        });
        const comments = dependencies.diaryCommentService
          ? await dependencies.diaryCommentService.listComments({
              userId: request.webUserId,
              diaryId: data.id,
              scope: "archived",
              limit: 50,
            })
          : null;
        response.json({
          success: true,
          data: comments
            ? {
                ...data,
                comments: comments.comments,
                comments_metadata: {
                  count: comments.metadata.count,
                  returned: comments.metadata.returned,
                  truncated:
                    comments.metadata.count >
                    comments.metadata.returned,
                },
              }
            : data,
        });
      } catch (error) {
        sendDiaryError(response, error);
      }
    };
  }

  export function createArchiveDiaryApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
      try {
        await dependencies.diaryService.archiveDiary({
          userId: request.webUserId,
          id: getRouteParam(request.params.id),
        });
        response.json({ success: true });
      } catch (error) {
        sendDiaryError(response, error);
      }
    };
  }

  export function createRestoreDiaryApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
      try {
        await dependencies.diaryService.restoreDiary({
          userId: request.webUserId,
          id: getRouteParam(request.params.id),
        });
        response.json({ success: true });
      } catch (error) {
        sendDiaryError(response, error);
      }
    };
  }

  export function createDiaryPermanentDeleteApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
      try {
        await dependencies.diaryService.permanentlyDeleteDiary({
          userId: request.webUserId,
          id: getRouteParam(request.params.id),
        });
        response.status(204).end();
      } catch (error) {
        sendDiaryError(response, error);
      }
    };
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
          query: {
            q: getQueryParam(request.query.q),
            tag: getQueryParam(request.query.tag),
            mood: getQueryParam(request.query.mood),
            dateFrom: getQueryParam(request.query.date_from),
            dateTo: getQueryParam(request.query.date_to),
          },
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
        const comments = dependencies.diaryCommentService
          ? await dependencies.diaryCommentService.listComments({
              userId: request.webUserId,
              diaryId: data.id,
              scope: "active",
              limit: 50,
            })
          : null;
  
        response.json({
          success: true,
          data: comments
            ? {
                ...data,
                comments: comments.comments,
                comments_metadata: {
                  count: comments.metadata.count,
                  returned: comments.metadata.returned,
                  truncated:
                    comments.metadata.count >
                    comments.metadata.returned,
                },
              }
            : data,
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
          author: request.body.author,
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
          ...(request.body.author === undefined
            ? {}
            : { author: request.body.author }),
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
  
  export function createListDiaryCommentsApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return createListCommentsHandler(dependencies, "active");
  }

  export function createListArchivedDiaryCommentsApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return createListCommentsHandler(dependencies, "archived");
  }

  function createListCommentsHandler(
    dependencies: DiaryApiDependencies,
    scope: "active" | "archived",
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
      const service = requireDiaryCommentService(
        dependencies,
        response,
      );
      if (!service) return;
      try {
        const rawLimit = getQueryParam(request.query.limit);
        const data = await service.listComments({
          userId: request.webUserId,
          diaryId: getRouteParam(request.params.id),
          scope,
          limit:
            rawLimit === undefined
              ? undefined
              : Number(rawLimit),
          before: getQueryParam(request.query.before),
        });
        response.json({ success: true, data });
      } catch (error) {
        sendDiaryCommentError(response, error);
      }
    };
  }

  export function createReadDiaryCommentApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return createReadCommentHandler(dependencies, "active");
  }

  export function createReadArchivedDiaryCommentApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return createReadCommentHandler(dependencies, "archived");
  }

  function createReadCommentHandler(
    dependencies: DiaryApiDependencies,
    scope: "active" | "archived",
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
      const service = requireDiaryCommentService(
        dependencies,
        response,
      );
      if (!service) return;
      try {
        const data = await service.getComment({
          userId: request.webUserId,
          id: getRouteParam(request.params.commentId),
          scope,
        });
        if (data.diary_id !== getRouteParam(request.params.id)) {
          throw new DiaryCommentDomainError(
            "COMMENT_NOT_FOUND",
            "Diary comment was not found.",
          );
        }
        response.json({ success: true, data });
      } catch (error) {
        sendDiaryCommentError(response, error);
      }
    };
  }

  export function createAddDiaryCommentApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
      const service = requireDiaryCommentService(
        dependencies,
        response,
      );
      if (!service) return;
      try {
        const data = await service.addWebComment({
          userId: request.webUserId,
          diaryId: getRouteParam(request.params.id),
          author: request.body.author,
          content: request.body.content,
          idempotencyKey: request.body.idempotency_key,
        });
        response.status(data.metadata.created ? 201 : 200).json({
          success: true,
          data,
        });
      } catch (error) {
        sendDiaryCommentError(response, error);
      }
    };
  }

  export function createUpdateDiaryCommentApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
      const service = requireDiaryCommentService(
        dependencies,
        response,
      );
      if (!service) return;
      try {
        const existing = await service.getComment({
          userId: request.webUserId,
          id: getRouteParam(request.params.commentId),
          scope: "active",
        });
        if (existing.diary_id !== getRouteParam(request.params.id)) {
          throw new DiaryCommentDomainError(
            "COMMENT_NOT_FOUND",
            "Diary comment was not found.",
          );
        }
        const data = await service.updateComment({
          userId: request.webUserId,
          id: existing.id,
          expectedRevision: request.body.expected_revision,
          content: request.body.content,
        });
        response.json({ success: true, data });
      } catch (error) {
        sendDiaryCommentError(response, error);
      }
    };
  }

  export function createDeleteDiaryCommentApiHandler(
    dependencies: DiaryApiDependencies,
  ): RequestHandler {
    return async (request, response) => {
      if (!request.webUserId) {
        sendUnauthorized(response);
        return;
      }
      const service = requireDiaryCommentService(
        dependencies,
        response,
      );
      if (!service) return;
      try {
        const existing = await service.getComment({
          userId: request.webUserId,
          id: getRouteParam(request.params.commentId),
          scope: "active",
        });
        if (existing.diary_id !== getRouteParam(request.params.id)) {
          throw new DiaryCommentDomainError(
            "COMMENT_NOT_FOUND",
            "Diary comment was not found.",
          );
        }
        const data = await service.deleteComment({
          userId: request.webUserId,
          id: existing.id,
          expectedRevision: request.body.expected_revision,
        });
        response.json({ success: true, data });
      } catch (error) {
        sendDiaryCommentError(response, error);
      }
    };
  }

  function requireDiaryCommentService(
    dependencies: DiaryApiDependencies,
    response: Response,
  ): NonNullable<DiaryApiDependencies["diaryCommentService"]> | null {
    if (dependencies.diaryCommentService) {
      return dependencies.diaryCommentService;
    }
    response.status(503).json({
      success: false,
      error: {
        code: "DIARY_COMMENTS_UNAVAILABLE",
        message: "Diary comments are temporarily unavailable.",
      },
    });
    return null;
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
  
  function sendDiaryCommentError(
    response: Response,
    error: unknown,
  ): void {
    if (error instanceof DiaryCommentDomainError) {
      if (
        error.code === "USER_NOT_FOUND" ||
        error.code === "USER_DISABLED"
      ) {
        response.status(403).json({
          success: false,
          error: {
            code: "DIARY_COMMENTS_UNAVAILABLE",
            message: "Diary comments are unavailable for the authenticated user.",
          },
        });
        return;
      }
      if (
        error.code === "DIARY_NOT_FOUND" ||
        error.code === "COMMENT_NOT_FOUND"
      ) {
        response.status(404).json({
          success: false,
          error: {
            code: error.code,
            message:
              error.code === "DIARY_NOT_FOUND"
                ? "Diary entry was not found."
                : "Diary comment was not found.",
          },
        });
        return;
      }
      if (error.code === "DIARY_ARCHIVED") {
        response.status(409).json({
          success: false,
          error: {
            code: error.code,
            message: "Archived Diary comments are read-only.",
          },
        });
        return;
      }
      if (error.code === "COMMENT_REVISION_CONFLICT") {
        response.status(409).json({
          success: false,
          error: {
            code: error.code,
            message: "Diary comment revision changed.",
            ...(error.current ? { current: error.current } : {}),
          },
        });
        return;
      }
      if (error.code === "IDEMPOTENCY_CONFLICT") {
        response.status(409).json({
          success: false,
          error: {
            code: error.code,
            message: "The idempotency key was already used for a different Diary comment.",
          },
        });
        return;
      }
      response.status(400).json({
        success: false,
        error: {
          code: error.code,
          message: "The Diary comment request is invalid.",
        },
      });
      return;
    }

    response.status(503).json({
      success: false,
      error: {
        code: "DIARY_COMMENTS_UNAVAILABLE",
        message: "Diary comments are temporarily unavailable.",
      },
    });
  }

  function sendDiaryError(
    response: Response,
    error: unknown,
  ): void {
    if (error instanceof DiaryDomainError) {
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

  function getQueryParam(
    value: unknown,
  ): string | undefined {
    return typeof value === "string" ? value : undefined;
  }
