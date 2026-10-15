import { validateNativeHistoryRestoreInput, type listReferencedNativeSessions, type restoreNativeSessionHistory, type readNativeSessionRestoreState, type releaseNativeSessionToDesktop, type listNativeSessionSwitchChoices } from "../domains/conversation/native-session-history-repository.js";
import { Router, type RequestHandler, type Response } from "express";
import type { readNativeSessionLightState, switchNativeSessionOwnerLight } from "../domains/conversation/native-session-lightweight-handoff.js";
import type { nativeSessionAsset } from "../domains/conversation/native-session-asset-repository.js";
import type { stageNativeDisplayAssets } from "../domains/conversation/native-session-asset-staging.js";
import {
  NativeLiveProviderSessionStoreError,
  type NativeLiveProviderSessionStoreEntry,
  type NativeLiveProviderSessionStoreKey,
  type NativeLiveProviderSessionStoreService,
} from "../domains/bridge/provider-session/native-live-provider-session-store.js";

export type NativeLiveProviderSessionStoreInternalDependencies = {
  listNativeHistoryChoices?: (input: Parameters<typeof listNativeSessionSwitchChoices>[1]) => ReturnType<typeof listNativeSessionSwitchChoices>;
  nativeHistoryAsset?: (input: Parameters<typeof nativeSessionAsset>[1]) => ReturnType<typeof nativeSessionAsset>;
  stageNativeHistoryAssets?: (input: Parameters<typeof stageNativeDisplayAssets>[1]) => ReturnType<typeof stageNativeDisplayAssets>;
  listReferencedNativeSessions?: (input: Parameters<typeof listReferencedNativeSessions>[1]) => ReturnType<typeof listReferencedNativeSessions>;
  restoreNativeHistory?: (input: Parameters<typeof restoreNativeSessionHistory>[1]) => ReturnType<typeof restoreNativeSessionHistory>;
  readNativeHistoryState?: (input: Parameters<typeof readNativeSessionRestoreState>[1]) => ReturnType<typeof readNativeSessionRestoreState>;
  releaseNativeHistory?: (input: Parameters<typeof releaseNativeSessionToDesktop>[1]) => ReturnType<typeof releaseNativeSessionToDesktop>;
  readNativeLightState?: (input: Parameters<typeof readNativeSessionLightState>[1]) => ReturnType<typeof readNativeSessionLightState>;
  switchNativeLightOwner?: (input: Parameters<typeof switchNativeSessionOwnerLight>[1]) => ReturnType<typeof switchNativeSessionOwnerLight>;
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
  router.post("/native-history/restore", nativeHistoryRestoreHandler(dependencies));
  router.post("/native-history/state", nativeHistoryStateHandler(dependencies));
  router.post("/native-history/choices", nativeHistoryChoicesHandler(dependencies));
  router.post("/native-history/release", nativeHistoryReleaseHandler(dependencies));
  router.post("/native-history/light-state", nativeHistoryLightStateHandler(dependencies));
  router.post("/native-history/light-switch", nativeHistoryLightSwitchHandler(dependencies));
  router.post("/native-history/asset", nativeHistoryAssetHandler(dependencies));
  router.post("/native-history/asset-stage", nativeHistoryAssetStageHandler(dependencies));
  router.post("/native-history/referenced-sessions", async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    if (!body || Object.keys(body).length) { sendInvalid(response); return; }
    if (!dependencies.listReferencedNativeSessions) { sendNativeHistoryError(response, null); return; }
    try { response.json({ success: true, data: await dependencies.listReferencedNativeSessions({ userId }) }); }
    catch (error) { sendNativeHistoryError(response, error); }
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
    if (!body || Object.keys(body).length !== 0) {
      sendInvalid(response);
      return;
    }
    try {
      const sessions =
        await dependencies.providerSessionStoreService.listSessions({
          userId,
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
      || Object.keys(body).some(key => key !== "session_id")
    || typeof body.session_id !== "string"
    ) {
      sendInvalid(response);
      return;
    }
    try {
      const subkeys =
        await dependencies.providerSessionStoreService.listSubkeys({
          userId,
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
): { sessionId: string } | null {
  const body = readRecord(value);
  if (
    !body
    || Object.keys(body).some(key => key !== "session_id")
    || typeof body.session_id !== "string"
  ) {
    return null;
  }
  return {
    sessionId: body.session_id,
  };
}

function parseKey(value: unknown): NativeLiveProviderSessionStoreKey | null {
  const record = readRecord(value);
  if (
    !record
    || Object.keys(record).some(key => key !== "session_id" && key !== "subpath")
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

function nativeHistoryChoicesHandler(dependencies: NativeLiveProviderSessionStoreInternalDependencies): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    if (!body || Object.keys(body).length) { sendInvalid(response); return; }
    if (!dependencies.listNativeHistoryChoices) { sendNativeHistoryError(response, null); return; }
    try { response.json({ success: true, data: await dependencies.listNativeHistoryChoices({ userId }) }); }
    catch (error) { sendNativeHistoryError(response, error); }
  };
}

function nativeHistoryRestoreHandler(dependencies: NativeLiveProviderSessionStoreInternalDependencies): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    const allowed = new Set(["conversationId", "expectedHeadMessageId", "expectedRevision", "effectiveWorkingDirectory", "projection", "nativeSnapshot"]);
    if (!body || Object.keys(body).some(key => !allowed.has(key)) || !readRecord(body.nativeSnapshot)) { sendInvalid(response); return; }
    const input = { ...body, userId } as Parameters<typeof restoreNativeSessionHistory>[1];
    try { validateNativeHistoryRestoreInput(input); }
    catch { sendInvalid(response); return; }
    if (!dependencies.restoreNativeHistory) { sendNativeHistoryError(response, null); return; }
    try { response.json({ success: true, data: await dependencies.restoreNativeHistory(input) }); }
    catch (error) { sendNativeHistoryError(response, error); }
  };
}
function nativeHistoryStateHandler(dependencies: NativeLiveProviderSessionStoreInternalDependencies): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    if (!body || Object.keys(body).some(key => key !== "conversationId" && key !== "sessionId") ||
      typeof body.conversationId !== "string" || typeof body.sessionId !== "string") { sendInvalid(response); return; }
    if (!dependencies.readNativeHistoryState) { sendNativeHistoryError(response, null); return; }
    try { response.json({ success: true, data: await dependencies.readNativeHistoryState({ userId, conversationId: body.conversationId, sessionId: body.sessionId }) }); }
    catch (error) { sendNativeHistoryError(response, error); }
  };
}
// Metadata-only handoff. Authenticated internal relay, no transcript body.
function nativeHistoryLightStateHandler(dependencies: NativeLiveProviderSessionStoreInternalDependencies): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!body || Object.keys(body).some(key => key !== "conversationId")
      || typeof body.conversationId !== "string" || !uuid.test(body.conversationId)) { sendInvalid(response); return; }
    if (!dependencies.readNativeLightState) { sendNativeHistoryError(response, null); return; }
    try { response.json({ success: true, data: await dependencies.readNativeLightState({ userId, conversationId: body.conversationId }) }); }
    catch (error) { sendNativeHistoryError(response, error); }
  };
}
function nativeHistoryLightSwitchHandler(dependencies: NativeLiveProviderSessionStoreInternalDependencies): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    const keys = ["conversationId", "sessionId", "expectedHeadMessageId", "expectedProviderCheckpointId",
      "selectedCheckpointId", "effectiveWorkingDirectory", "nativeRevision", "direction"];
    const uuidKeys = keys.slice(0, 5);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!body || Object.keys(body).some(key => !keys.includes(key))
      || uuidKeys.some(key => typeof body[key] !== "string" || !uuid.test(body[key] as string))
      || typeof body.effectiveWorkingDirectory !== "string" || !body.effectiveWorkingDirectory.startsWith("/")
      || typeof body.nativeRevision !== "string" || !/^[0-9a-f]{64}$/.test(body.nativeRevision)
      || !["to_desktop", "to_leileios"].includes(String(body.direction))) { sendInvalid(response); return; }
    if (!dependencies.switchNativeLightOwner) { sendNativeHistoryError(response, null); return; }
    try {
      response.json({ success: true, data: await dependencies.switchNativeLightOwner({
        userId, ...body as Omit<Parameters<typeof switchNativeSessionOwnerLight>[1], "userId">,
      }) });
    } catch (error) { sendNativeHistoryError(response, error); }
  };
}
function nativeHistoryReleaseHandler(dependencies: NativeLiveProviderSessionStoreInternalDependencies): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    const ids = ["conversationId", "sessionId", "expectedHeadMessageId", "expectedCheckpointId"];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!body || Object.keys(body).some(key => ![...ids, "expectedRevision"].includes(key)) ||
      ids.some(key => typeof body[key] !== "string" || !uuid.test(body[key] as string)) ||
      typeof body.expectedRevision !== "string" || !/^[0-9a-f]{64}$/.test(body.expectedRevision)) { sendInvalid(response); return; }
    if (!dependencies.releaseNativeHistory) { sendNativeHistoryError(response, null); return; }
    try { response.json({ success: true, data: await dependencies.releaseNativeHistory({ ...body, userId } as Parameters<typeof releaseNativeSessionToDesktop>[1]) }); }
    catch (error) { sendNativeHistoryError(response, error); }
  };
}
function nativeHistoryAssetHandler(dependencies: NativeLiveProviderSessionStoreInternalDependencies): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    const ids = ["conversationId", "sessionId", "sourceEntryUuid"];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!body || Object.keys(body).some(key => ![...ids, "expectedRevision", "sourceBlockOrdinal", "attachmentId"].includes(key)) ||
      ids.some(key => typeof body[key] !== "string" || !uuid.test(body[key] as string)) ||
      typeof body.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedRevision) ||
      typeof body.sourceBlockOrdinal !== "number" || !Number.isSafeInteger(body.sourceBlockOrdinal) || body.sourceBlockOrdinal < 0 ||
      (body.attachmentId !== undefined && (typeof body.attachmentId !== "string" || !uuid.test(body.attachmentId)))) { sendInvalid(response); return; }
    if (!dependencies.nativeHistoryAsset) { sendNativeHistoryError(response, null); return; }
    try { response.json({ success: true, data: await dependencies.nativeHistoryAsset({ ...body, userId } as Parameters<typeof nativeSessionAsset>[1]) }); }
    catch (error) { sendNativeHistoryError(response, error); }
  };
}
function nativeHistoryAssetStageHandler(dependencies: NativeLiveProviderSessionStoreInternalDependencies): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    if (!body || Object.keys(body).some(key => !["sessionId", "revision", "total", "offset", "entries"].includes(key)) ||
      typeof body.sessionId !== "string" || typeof body.revision !== "string" || typeof body.total !== "number" ||
      typeof body.offset !== "number" || !Array.isArray(body.entries)) { sendInvalid(response); return; }
    if (!dependencies.stageNativeHistoryAssets) { sendNativeHistoryError(response, null); return; }
    try { response.json({ success: true, data: await dependencies.stageNativeHistoryAssets({ ...body, userId } as Parameters<typeof stageNativeDisplayAssets>[1]) }); }
    catch (error) { sendNativeHistoryError(response, error); }
  };
}
function sendNativeHistoryError(response: Response, error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const conflicts = new Set(["NATIVE_CONVERSATION_BUSY", "STALE_NATIVE_PROJECTION", "CANONICAL_HEAD_CHANGED", "CANONICAL_HISTORY_CHANGED", "CANONICAL_CHECKPOINT_CHANGED", "NATIVE_SOURCE_BINDING_REQUIRED", "EXPLICIT_BRANCH_SELECTION_REQUIRED", "NATIVE_HISTORY_REWRITTEN", "NATIVE_TRANSCRIPT_DIVERGED", "NATIVE_SESSION_RECOVERY_REQUIRED", "CLEANUP_IN_PROGRESS", "NATIVE_CONVERSATION_NOT_FOUND", "NATIVE_SESSION_ALREADY_ATTACHED", "NATIVE_SYNC_BASE_CHANGED"]);
  const invalid = new Set(["INVALID_NATIVE_PROJECTION", "INVALID_NATIVE_SNAPSHOT", "INVALID_KEY", "INVALID_ENTRY", "BATCH_TOO_LARGE", "INVALID_NATIVE_ASSET", "NATIVE_ASSET_UNAVAILABLE", "NATIVE_ASSET_MISMATCH"]);
  response.status(conflicts.has(code) ? 409 : invalid.has(code) ? 400 : 503).json({ success: false, error: {
    code: conflicts.has(code) || invalid.has(code) ? code : "NATIVE_HISTORY_UNAVAILABLE",
    message: "Native history restore could not be completed.",
  } });
}
