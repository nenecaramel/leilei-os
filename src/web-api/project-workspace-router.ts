import {
  Router,
  type RequestHandler,
  type Response,
} from "express";
import {
  ProjectWorkspaceServiceError,
  type ProjectWorkspaceService,
} from "../domains/project-workspace/project-workspace-service.js";

export type ProjectWorkspaceApiDependencies = {
  projectWorkspaceService: Pick<
    ProjectWorkspaceService,
    | "listProductWorkspaces"
    | "getProductWorkspace"
    | "createProductWorkspace"
    | "updateProductWorkspace"
    | "deleteProductWorkspace"
    | "listWorkspaceResources"
    | "getWorkspaceResource"
    | "createWorkspaceResource"
    | "updateWorkspaceResource"
    | "deleteWorkspaceResource"
    | "listWorkspaceConversations"
    | "attachWorkspaceConversation"
    | "detachWorkspaceConversation"
  >;
};

export function createProjectWorkspaceApiRouter(
  dependencies: ProjectWorkspaceApiDependencies,
): Router {
  const router = Router();

  router.get("/workspaces", handler(async (request) => {
    rejectIdentity(request.query as Record<string, unknown>);
    return dependencies.projectWorkspaceService.listProductWorkspaces({
      userId: request.webUserId!,
      ...(request.query.conversation_id === undefined
        ? {}
        : {
            conversationId:
              scalarQuery(request.query.conversation_id),
          }),
    });
  }));

  router.post("/workspaces", createHandler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    return dependencies.projectWorkspaceService.createProductWorkspace({
      userId: request.webUserId!,
      name: body.name,
      description: body.description,
      idempotencyKey: request.get("Idempotency-Key"),
    });
  }));

  router.get("/workspaces/:workspaceId", handler(async (request) =>
    dependencies.projectWorkspaceService.getProductWorkspace({
      userId: request.webUserId!,
      workspaceId: routeParam(request.params.workspaceId),
    })));

  router.patch("/workspaces/:workspaceId", handler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    return dependencies.projectWorkspaceService.updateProductWorkspace({
      userId: request.webUserId!,
      workspaceId: routeParam(request.params.workspaceId),
      expectedVersion: body.expected_version,
      ...(Object.prototype.hasOwnProperty.call(body, "name")
        ? { name: body.name }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "description")
        ? { description: body.description }
        : {}),
    });
  }));

  router.delete("/workspaces/:workspaceId", emptyHandler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    await dependencies.projectWorkspaceService.deleteProductWorkspace({
      userId: request.webUserId!,
      workspaceId: routeParam(request.params.workspaceId),
      expectedVersion: body.expected_version,
    });
  }));

  router.get("/workspaces/:workspaceId/resources", handler(async (request) => {
    rejectIdentity(request.query as Record<string, unknown>);
    return dependencies.projectWorkspaceService.listWorkspaceResources({
      userId: request.webUserId!,
      workspaceId: routeParam(request.params.workspaceId),
      ...(request.query.kind === undefined
        ? {}
        : { kind: scalarQuery(request.query.kind) }),
    });
  }));

  router.get(
    "/workspaces/:workspaceId/resources/:resourceId",
    handler(async (request) =>
      dependencies.projectWorkspaceService.getWorkspaceResource({
        userId: request.webUserId!,
        workspaceId: routeParam(request.params.workspaceId),
        resourceId: routeParam(request.params.resourceId),
      })),
  );

  router.post(
    "/workspaces/:workspaceId/resources",
    createHandler(async (request) => {
      const body = bodyRecord(request.body);
      rejectIdentity(body);
      return dependencies.projectWorkspaceService.createWorkspaceResource({
        userId: request.webUserId!,
        workspaceId: routeParam(request.params.workspaceId),
        kind: body.kind,
        key: body.key,
        title: body.title,
        content: body.content,
        metadata: body.metadata,
        idempotencyKey: request.get("Idempotency-Key"),
      });
    }),
  );

  router.patch(
    "/workspaces/:workspaceId/resources/:resourceId",
    handler(async (request) => {
      const body = bodyRecord(request.body);
      rejectIdentity(body);
      return dependencies.projectWorkspaceService.updateWorkspaceResource({
        userId: request.webUserId!,
        workspaceId: routeParam(request.params.workspaceId),
        resourceId: routeParam(request.params.resourceId),
        expectedVersion: body.expected_version,
        ...(Object.prototype.hasOwnProperty.call(body, "title")
          ? { title: body.title }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "content")
          ? { content: body.content }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(body, "metadata")
          ? { metadata: body.metadata }
          : {}),
      });
    }),
  );

  router.delete(
    "/workspaces/:workspaceId/resources/:resourceId",
    emptyHandler(async (request) => {
      const body = bodyRecord(request.body);
      rejectIdentity(body);
      await dependencies.projectWorkspaceService.deleteWorkspaceResource({
        userId: request.webUserId!,
        workspaceId: routeParam(request.params.workspaceId),
        resourceId: routeParam(request.params.resourceId),
        expectedVersion: body.expected_version,
      });
    }),
  );

  router.get(
    "/workspaces/:workspaceId/conversations",
    handler(async (request) =>
      dependencies.projectWorkspaceService.listWorkspaceConversations({
        userId: request.webUserId!,
        workspaceId: routeParam(request.params.workspaceId),
      })),
  );

  router.put(
    "/workspaces/:workspaceId/conversations/:conversationId",
    handler(async (request) =>
      dependencies.projectWorkspaceService.attachWorkspaceConversation({
        userId: request.webUserId!,
        workspaceId: routeParam(request.params.workspaceId),
        conversationId: routeParam(request.params.conversationId),
      })),
  );

  router.delete(
    "/workspaces/:workspaceId/conversations/:conversationId",
    handler(async (request) =>
      dependencies.projectWorkspaceService.detachWorkspaceConversation({
        userId: request.webUserId!,
        workspaceId: routeParam(request.params.workspaceId),
        conversationId: routeParam(request.params.conversationId),
      })),
  );

  return router;
}

function handler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<unknown>,
): RequestHandler {
  return async (request, response) => {
    if (!requireUser(response, request.webUserId)) return;
    try {
      rejectIdentity(request.query);
      rejectIdentity(request.body);
      const data = await operation(request);
      response.json({ success: true, data });
    } catch (error) {
      mapError(response, error);
    }
  };
}

function createHandler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<unknown>,
): RequestHandler {
  return async (request, response) => {
    if (!requireUser(response, request.webUserId)) return;
    try {
      rejectIdentity(request.query);
      rejectIdentity(request.body);
      const data = await operation(request);
      response.status(201).json({ success: true, data });
    } catch (error) {
      mapError(response, error);
    }
  };
}

function emptyHandler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<void>,
): RequestHandler {
  return async (request, response) => {
    if (!requireUser(response, request.webUserId)) return;
    try {
      rejectIdentity(request.query);
      rejectIdentity(request.body);
      await operation(request);
      response.status(204).end();
    } catch (error) {
      mapError(response, error);
    }
  };
}

function requireUser(
  response: Response,
  userId: string | undefined,
): userId is string {
  if (userId) return true;
  response.status(401).json({
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "Web API authentication is required.",
    },
  });
  return false;
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectWorkspaceServiceError(
      "INVALID_WORKSPACE",
      "Request body must be an object.",
    );
  }
  return value as Record<string, unknown>;
}

function scalarQuery(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function routeParam(
  value: string | string[] | undefined,
): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function rejectIdentity(value: unknown): void {
  const walk = (candidate: unknown, seen = new Set<object>()): boolean => {
    if (!candidate || typeof candidate !== "object") return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (
      Object.prototype.hasOwnProperty.call(candidate, "user_id")
      || Object.prototype.hasOwnProperty.call(candidate, "userId")
    ) {
      return true;
    }
    if (Array.isArray(candidate)) {
      return candidate.some((item) => walk(item, seen));
    }
    return Object.values(candidate).some((item) => walk(item, seen));
  };
  if (walk(value)) {
    throw new ProjectWorkspaceServiceError(
      "INVALID_WORKSPACE",
      "Client identity selectors are not accepted.",
    );
  }
}

function mapError(
  response: Response,
  error: unknown,
): void {
  if (!(error instanceof ProjectWorkspaceServiceError)) {
    response.status(503).json({
      success: false,
      error: {
        code: "WORKSPACES_UNAVAILABLE",
        message: "Workspaces are temporarily unavailable.",
      },
    });
    return;
  }

  if (
    error.code === "USER_NOT_FOUND"
    || error.code === "USER_DISABLED"
  ) {
    response.status(403).json({
      success: false,
      error: {
        code: "WORKSPACES_UNAVAILABLE",
        message: "Workspaces are unavailable.",
      },
    });
    return;
  }

  if (error.code === "INVALID_WORKSPACE") {
    response.status(400).json({
      success: false,
      error: {
        code: "INVALID_WORKSPACE",
        message: "Workspace request is invalid.",
      },
    });
    return;
  }

  if (error.code === "INVALID_IDEMPOTENCY_KEY") {
    response.status(400).json({
      success: false,
      error: {
        code: "INVALID_IDEMPOTENCY_KEY",
        message:
          "Idempotency-Key is required for durable create requests.",
      },
    });
    return;
  }

  if (error.code === "IDEMPOTENCY_CONFLICT") {
    response.status(409).json({
      success: false,
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message:
          "Idempotency-Key was already used for a different request.",
      },
    });
    return;
  }

  if (error.code === "WORKSPACE_IN_USE") {
    response.status(409).json({
      success: false,
      error: {
        code: "WORKSPACE_IN_USE",
        message:
          "Workspace still owns canonical provider-session execution state.",
      },
    });
    return;
  }

  if (
    error.code === "VERSION_CONFLICT"
    || error.code === "RESOURCE_CONFLICT"
  ) {
    response.status(409).json({
      success: false,
      error: {
        code: error.code,
        message:
          error.code === "VERSION_CONFLICT"
            ? "Workspace data changed on another device."
            : "Workspace resource already exists.",
      },
    });
    return;
  }

  if (
    error.code === "WORKSPACE_NOT_FOUND"
    || error.code === "RESOURCE_NOT_FOUND"
    || error.code === "CONVERSATION_NOT_FOUND"
  ) {
    response.status(404).json({
      success: false,
      error: {
        code: error.code,
        message: "Workspace resource was not found.",
      },
    });
    return;
  }

  response.status(503).json({
    success: false,
    error: {
      code: "WORKSPACES_UNAVAILABLE",
      message: "Workspaces are temporarily unavailable.",
    },
  });
}
