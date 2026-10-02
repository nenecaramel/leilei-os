import { Router, type RequestHandler, type Response } from "express";
import {
  NativeLiveProviderSessionStoreError,
  type NativeLiveProviderSessionStoreEntry,
  type NativeLiveProviderSessionStoreKey,
  type NativeLiveProviderSessionStoreService,
} from "../domains/bridge/provider-session/native-live-provider-session-store.js";

export type NativeLiveProviderSessionStoreInternalDependencies = {
  providerSessionStoreService: Pick<
    NativeLiveProviderSessionStoreService,
    "append" | "load" | "listSessions" | "delete" | "listSubkeys"
    | "getStatus" | "markIncomplete" | "markComplete"
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
  router.post("/status", statusHandler(dependencies));
  router.post("/mark-incomplete", markIncompleteHandler(dependencies));
  router.post("/mark-complete", markCompleteHandler(dependencies));
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
    const appendBatchId =
      body && typeof body.append_batch_id === "string"
        ? body.append_batch_id
        : null;
    if (!key || !entries || !appendBatchId) {
      sendInvalid(response);
      return;
    }
    try {
      await dependencies.providerSessionStoreService.append({
        userId,
        key,
        appendBatchId,
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

function statusHandler(
  dependencies: NativeLiveProviderSessionStoreInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const identity = parseSessionIdentity(request.body);
    if (!identity) {
      sendInvalid(response);
      return;
    }
    try {
      const state =
        await dependencies.providerSessionStoreService.getStatus({
          userId,
          ...identity,
        });
      response.json({ success: true, data: { state } });
    } catch (error) {
      sendStoreError(response, error);
    }
  };
}

function markIncompleteHandler(
  dependencies: NativeLiveProviderSessionStoreInternalDependencies,
): RequestHandler {
  return markStatusHandler(dependencies, "incomplete");
}

function markCompleteHandler(
  dependencies: NativeLiveProviderSessionStoreInternalDependencies,
): RequestHandler {
  return markStatusHandler(dependencies, "complete");
}

function markStatusHandler(
  dependencies: NativeLiveProviderSessionStoreInternalDependencies,
  state: "complete" | "incomplete",
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const identity = parseSessionIdentity(request.body);
    if (!identity) {
      sendInvalid(response);
      return;
    }
    try {
      if (state === "complete") {
        await dependencies.providerSessionStoreService.markComplete({
          userId,
          ...identity,
        });
      } else {
        await dependencies.providerSessionStoreService.markIncomplete({
          userId,
          ...identity,
        });
      }
      response.json({ success: true, data: { state } });
    } catch (error) {
      sendStoreError(response, error);
    }
  };
}

function parseSessionIdentity(
  value: unknown,
): { workspaceId: string; sessionId: string } | null {
  const body = readRecord(value);
  if (
    !body
    || typeof body.workspace_id !== "string"
    || typeof body.session_id !== "string"
  ) {
    return null;
  }
  return {
    workspaceId: body.workspace_id,
    sessionId: body.session_id,
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
