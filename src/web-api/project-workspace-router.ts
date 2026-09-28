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
    | "listWorkspaces"
    | "createWorkspace"
    | "updateWorkspace"
    | "deleteWorkspace"
    | "listProjects"
    | "getProject"
    | "createProject"
    | "updateProject"
    | "deleteProject"
    | "listResources"
    | "getResource"
    | "createResource"
    | "updateResource"
    | "deleteResource"
    | "listProjectConversations"
    | "attachConversation"
    | "detachConversation"
  >;
};

export function createProjectWorkspaceApiRouter(
  dependencies: ProjectWorkspaceApiDependencies,
): Router {
  const router = Router();

  router.get("/workspaces", workspaceHandler(async (request) => {
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

  router.post("/workspaces", workspaceCreateHandler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    return dependencies.projectWorkspaceService.createProductWorkspace({
      userId: request.webUserId!,
      name: body.name,
      description: body.description,
    });
  }));

  router.get("/workspaces/:workspaceId", workspaceHandler(async (request) =>
    dependencies.projectWorkspaceService.getProductWorkspace({
      userId: request.webUserId!,
      workspaceId: routeParam(request.params.workspaceId),
    })));

  router.patch("/workspaces/:workspaceId", workspaceHandler(async (request) => {
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

  router.delete("/workspaces/:workspaceId", workspaceEmptyHandler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    await dependencies.projectWorkspaceService.deleteProductWorkspace({
      userId: request.webUserId!,
      workspaceId: routeParam(request.params.workspaceId),
      expectedVersion: body.expected_version,
    });
  }));

  router.get("/workspaces/:workspaceId/resources", workspaceHandler(async (request) => {
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
    workspaceHandler(async (request) =>
      dependencies.projectWorkspaceService.getWorkspaceResource({
        userId: request.webUserId!,
        workspaceId: routeParam(request.params.workspaceId),
        resourceId: routeParam(request.params.resourceId),
      })),
  );

  router.post(
    "/workspaces/:workspaceId/resources",
    workspaceCreateHandler(async (request) => {
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
      });
    }),
  );

  router.patch(
    "/workspaces/:workspaceId/resources/:resourceId",
    workspaceHandler(async (request) => {
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
    workspaceEmptyHandler(async (request) => {
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
    workspaceHandler(async (request) =>
      dependencies.projectWorkspaceService.listWorkspaceConversations({
        userId: request.webUserId!,
        workspaceId: routeParam(request.params.workspaceId),
      })),
  );

  router.put(
    "/workspaces/:workspaceId/conversations/:conversationId",
    workspaceHandler(async (request) =>
      dependencies.projectWorkspaceService.attachWorkspaceConversation({
        userId: request.webUserId!,
        workspaceId: routeParam(request.params.workspaceId),
        conversationId: routeParam(request.params.conversationId),
      })),
  );

  router.delete(
    "/workspaces/:workspaceId/conversations/:conversationId",
    workspaceHandler(async (request) =>
      dependencies.projectWorkspaceService.detachWorkspaceConversation({
        userId: request.webUserId!,
        workspaceId: routeParam(request.params.workspaceId),
        conversationId: routeParam(request.params.conversationId),
      })),
  );

  // Legacy two-layer persistence surface. Product clients must use
  // /workspaces; these routes exist only for transition/export tooling.
  router.get("/legacy/project-workspaces", handler(async (request) =>
    dependencies.projectWorkspaceService.listWorkspaces(
      request.webUserId!,
    )));

  router.post("/legacy/project-workspaces", createHandler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    return dependencies.projectWorkspaceService.createWorkspace({
      userId: request.webUserId!,
      name: body.name,
      description: body.description,
    });
  }));

  router.patch("/legacy/project-workspaces/:workspaceId", handler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    return dependencies.projectWorkspaceService.updateWorkspace({
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

  router.delete("/legacy/project-workspaces/:workspaceId", emptyHandler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    await dependencies.projectWorkspaceService.deleteWorkspace({
      userId: request.webUserId!,
      workspaceId: routeParam(request.params.workspaceId),
      expectedVersion: body.expected_version,
    });
  }));

  router.get("/projects", handler(async (request) => {
    rejectIdentity(request.query as Record<string, unknown>);
    return dependencies.projectWorkspaceService.listProjects({
      userId: request.webUserId!,
      ...(request.query.workspace_id === undefined
        ? {}
        : { workspaceId: scalarQuery(request.query.workspace_id) }),
      ...(request.query.conversation_id === undefined
        ? {}
        : {
            conversationId:
              scalarQuery(request.query.conversation_id),
          }),
    });
  }));

  router.post("/projects", createHandler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    return dependencies.projectWorkspaceService.createProject({
      userId: request.webUserId!,
      workspaceId: body.workspace_id,
      name: body.name,
      description: body.description,
    });
  }));

  router.get("/projects/:projectId", handler(async (request) =>
    dependencies.projectWorkspaceService.getProject({
      userId: request.webUserId!,
      projectId: routeParam(request.params.projectId),
    })));

  router.patch("/projects/:projectId", handler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    return dependencies.projectWorkspaceService.updateProject({
      userId: request.webUserId!,
      projectId: routeParam(request.params.projectId),
      expectedVersion: body.expected_version,
      ...(Object.prototype.hasOwnProperty.call(body, "name")
        ? { name: body.name }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "description")
        ? { description: body.description }
        : {}),
    });
  }));

  router.delete("/projects/:projectId", emptyHandler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    await dependencies.projectWorkspaceService.deleteProject({
      userId: request.webUserId!,
      projectId: routeParam(request.params.projectId),
      expectedVersion: body.expected_version,
    });
  }));

  router.get("/projects/:projectId/resources", handler(async (request) => {
    rejectIdentity(request.query as Record<string, unknown>);
    return dependencies.projectWorkspaceService.listResources({
      userId: request.webUserId!,
      projectId: routeParam(request.params.projectId),
      ...(request.query.kind === undefined
        ? {}
        : { kind: scalarQuery(request.query.kind) }),
    });
  }));

  router.get(
    "/projects/:projectId/resources/:resourceId",
    handler(async (request) =>
      dependencies.projectWorkspaceService.getResource({
        userId: request.webUserId!,
        projectId: routeParam(request.params.projectId),
        resourceId: routeParam(request.params.resourceId),
      })),
  );

  router.post("/projects/:projectId/resources", createHandler(async (request) => {
    const body = bodyRecord(request.body);
    rejectIdentity(body);
    return dependencies.projectWorkspaceService.createResource({
      userId: request.webUserId!,
      projectId: routeParam(request.params.projectId),
      kind: body.kind,
      key: body.key,
      title: body.title,
      content: body.content,
      metadata: body.metadata,
    });
  }));

  router.patch(
    "/projects/:projectId/resources/:resourceId",
    handler(async (request) => {
      const body = bodyRecord(request.body);
      rejectIdentity(body);
      return dependencies.projectWorkspaceService.updateResource({
        userId: request.webUserId!,
        projectId: routeParam(request.params.projectId),
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
    "/projects/:projectId/resources/:resourceId",
    emptyHandler(async (request) => {
      const body = bodyRecord(request.body);
      rejectIdentity(body);
      await dependencies.projectWorkspaceService.deleteResource({
        userId: request.webUserId!,
        projectId: routeParam(request.params.projectId),
        resourceId: routeParam(request.params.resourceId),
        expectedVersion: body.expected_version,
      });
    }),
  );

  router.get(
    "/projects/:projectId/conversations",
    handler(async (request) =>
      dependencies.projectWorkspaceService.listProjectConversations({
        userId: request.webUserId!,
        projectId: routeParam(request.params.projectId),
      })),
  );

  router.put(
    "/projects/:projectId/conversations/:conversationId",
    handler(async (request) =>
      dependencies.projectWorkspaceService.attachConversation({
        userId: request.webUserId!,
        projectId: routeParam(request.params.projectId),
        conversationId: routeParam(request.params.conversationId),
      })),
  );

  router.delete(
    "/projects/:projectId/conversations/:conversationId",
    handler(async (request) =>
      dependencies.projectWorkspaceService.detachConversation({
        userId: request.webUserId!,
        projectId: routeParam(request.params.projectId),
        conversationId: routeParam(request.params.conversationId),
      })),
  );

  return router;
}

function workspaceHandler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<unknown>,
): RequestHandler {
  return surfaceHandler(operation, "workspace");
}

function workspaceCreateHandler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<unknown>,
): RequestHandler {
  return surfaceCreateHandler(operation, "workspace");
}

function workspaceEmptyHandler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<void>,
): RequestHandler {
  return surfaceEmptyHandler(operation, "workspace");
}

function handler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<unknown>,
): RequestHandler {
  return surfaceHandler(operation, "project");
}

function surfaceHandler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<unknown>,
  surface: "workspace" | "project",
): RequestHandler {
  return async (request, response) => {
    if (!requireUser(response, request.webUserId)) return;
    try {
      rejectIdentity(request.query);
      rejectIdentity(request.body);
      const data = await operation(request);
      response.json({ success: true, data });
    } catch (error) {
      mapError(response, error, surface);
    }
  };
}

function createHandler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<unknown>,
): RequestHandler {
  return surfaceCreateHandler(operation, "project");
}

function surfaceCreateHandler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<unknown>,
  surface: "workspace" | "project",
): RequestHandler {
  return async (request, response) => {
    if (!requireUser(response, request.webUserId)) return;
    try {
      rejectIdentity(request.query);
      rejectIdentity(request.body);
      const data = await operation(request);
      response.status(201).json({ success: true, data });
    } catch (error) {
      mapError(response, error, surface);
    }
  };
}

function emptyHandler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<void>,
): RequestHandler {
  return surfaceEmptyHandler(operation, "project");
}

function surfaceEmptyHandler(
  operation: (
    request: Parameters<RequestHandler>[0],
  ) => Promise<void>,
  surface: "workspace" | "project",
): RequestHandler {
  return async (request, response) => {
    if (!requireUser(response, request.webUserId)) return;
    try {
      rejectIdentity(request.query);
      rejectIdentity(request.body);
      await operation(request);
      response.status(204).end();
    } catch (error) {
      mapError(response, error, surface);
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
      "INVALID_PROJECT",
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
      "INVALID_PROJECT",
      "Client identity selectors are not accepted.",
    );
  }
}

function mapError(
  response: Response,
  error: unknown,
  surface: "workspace" | "project" = "project",
): void {
  if (!(error instanceof ProjectWorkspaceServiceError)) {
    response.status(503).json({
      success: false,
      error: {
        code:
          surface === "workspace"
            ? "WORKSPACES_UNAVAILABLE"
            : "PROJECTS_UNAVAILABLE",
        message:
          surface === "workspace"
            ? "Workspaces are temporarily unavailable."
            : "Projects are temporarily unavailable.",
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
        code:
          surface === "workspace"
            ? "WORKSPACES_UNAVAILABLE"
            : "PROJECTS_UNAVAILABLE",
        message:
          surface === "workspace"
            ? "Workspaces are unavailable."
            : "Projects are unavailable.",
      },
    });
    return;
  }

  if (error.code === "INVALID_PROJECT") {
    response.status(400).json({
      success: false,
      error: {
        code:
          surface === "workspace"
            ? "INVALID_WORKSPACE"
            : error.code,
        message:
          surface === "workspace"
            ? "Workspace request is invalid."
            : "Project request is invalid.",
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
            ? surface === "workspace"
              ? "Workspace data changed on another device."
              : "Project data changed on another device."
            : surface === "workspace"
              ? "Workspace resource already exists."
              : "Project resource already exists.",
      },
    });
    return;
  }

  if (
    error.code === "WORKSPACE_NOT_FOUND"
    || error.code === "PROJECT_NOT_FOUND"
    || error.code === "RESOURCE_NOT_FOUND"
    || error.code === "CONVERSATION_NOT_FOUND"
  ) {
    response.status(404).json({
      success: false,
      error: {
        code: error.code,
        message:
          surface === "workspace"
            ? "Workspace resource was not found."
            : "Project resource was not found.",
      },
    });
    return;
  }

  response.status(503).json({
    success: false,
    error: {
      code:
        surface === "workspace"
          ? "WORKSPACES_UNAVAILABLE"
          : "PROJECTS_UNAVAILABLE",
      message:
        surface === "workspace"
          ? "Workspaces are temporarily unavailable."
          : "Projects are temporarily unavailable.",
    },
  });
}
