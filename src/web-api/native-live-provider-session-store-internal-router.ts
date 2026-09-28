import { Router, type RequestHandler, type Response } from "express";
import {
  NativeLiveProviderSessionStoreError,
  type NativeLiveProviderSessionStoreEntry,
  type NativeLiveProviderSessionStoreKey,
  type NativeLiveProviderSessionStoreService,
} from "../domains/bridge/native-live-provider-session-store.js";

export type NativeLiveProviderSessionStoreInternalDependencies = {
  providerSessionStoreService: Pick<
    NativeLiveProviderSessionStoreService,
    "append" | "load" | "listSessions" | "delete" | "listSubkeys"
  >;
};

export function createNativeLiveProviderSessionStoreInternalRouter(
  dependencies: NativeLiveProviderSessionStoreInternalDependencies,
): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.post("/append", appendHandler(dependencies));
  router.post("/load", loadHandler(dependencies));
  router.post("/list-sessions", listSessionsHandler(dependencies));
  router.post("/delete", deleteHandler(dependencies));
  router.post("/list-subkeys", listSubkeysHandler(dependencies));
  return router;
}

function appendHandler(
  dependencies: NativeLiveProviderSessionStoreInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    const key = body ? parseKey(body.key) : null;
    const entries =
      body && Array.isArray(body.entries)
        ? body.entries as NativeLiveProviderSessionStoreEntry[]
        : null;
    if (!key || !entries) {
      sendInvalid(response);
      return;
    }
    try {
      await dependencies.providerSessionStoreService.append({
        userId,
        key,
        entries,
      });
      response.json({ success: true, data: null });
    } catch (error) {
      sendStoreError(response, error);
    }
  };
}

function loadHandler(
  dependencies: NativeLiveProviderSessionStoreInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    const key = body ? parseKey(body.key) : null;
    if (!key) {
      sendInvalid(response);
      return;
    }
    try {
      const entries =
        await dependencies.providerSessionStoreService.load({
          userId,
          key,
        });
      response.json({ success: true, data: { entries } });
    } catch (error) {
      sendStoreError(response, error);
    }
  };
}

function listSessionsHandler(
  dependencies: NativeLiveProviderSessionStoreInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    if (!body || typeof body.workspace_id !== "string") {
      sendInvalid(response);
      return;
    }
    try {
      const sessions =
        await dependencies.providerSessionStoreService.listSessions({
          userId,
          workspaceId: body.workspace_id,
        });
      response.json({ success: true, data: { sessions } });
    } catch (error) {
      sendStoreError(response, error);
    }
  };
}

function deleteHandler(
  dependencies: NativeLiveProviderSessionStoreInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    const key = body ? parseKey(body.key) : null;
    if (!key) {
      sendInvalid(response);
      return;
    }
    try {
      await dependencies.providerSessionStoreService.delete({
        userId,
        key,
      });
      response.json({ success: true, data: null });
    } catch (error) {
      sendStoreError(response, error);
    }
  };
}

function listSubkeysHandler(
  dependencies: NativeLiveProviderSessionStoreInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    if (
      !body
      || typeof body.workspace_id !== "string"
      || typeof body.session_id !== "string"
    ) {
      sendInvalid(response);
      return;
    }
    try {
      const subkeys =
        await dependencies.providerSessionStoreService.listSubkeys({
          userId,
          workspaceId: body.workspace_id,
          sessionId: body.session_id,
        });
      response.json({ success: true, data: { subkeys } });
    } catch (error) {
      sendStoreError(response, error);
    }
  };
}

function parseKey(value: unknown): NativeLiveProviderSessionStoreKey | null {
  const record = readRecord(value);
  if (
    !record
    || typeof record.workspace_id !== "string"
    || typeof record.session_id !== "string"
    || (
      record.subpath !== undefined
      && record.subpath !== null
      && typeof record.subpath !== "string"
    )
  ) {
    return null;
  }
  return {
    workspaceId: record.workspace_id,
    sessionId: record.session_id,
    ...(typeof record.subpath === "string"
      ? { subpath: record.subpath }
      : {}),
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireInternalUser(
  response: Response,
  userId: string | undefined,
): string | null {
  if (userId) return userId;
  response.status(401).json({
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "A valid internal credential is required.",
    },
  });
  return null;
}

function sendInvalid(response: Response): void {
  response.status(400).json({
    success: false,
    error: {
      code: "INVALID_SESSION_STORE_REQUEST",
      message: "Session store request is invalid.",
    },
  });
}

function sendStoreError(response: Response, error: unknown): void {
  if (error instanceof NativeLiveProviderSessionStoreError) {
    response.status(400).json({
      success: false,
      error: {
        code: error.code,
        message: "Session store request is invalid.",
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "SESSION_STORE_UNAVAILABLE",
      message: "Session store is temporarily unavailable.",
    },
  });
}
