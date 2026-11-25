import { beginNativeContinuationRelease, cancelNativeContinuationRelease, validateNativeContinuationReleaseBegin, validateNativeContinuationReleaseCancel, validateNativeContinuationInput, type attachNativeContinuation, type releaseNativeContinuation, type readNativeContinuationState } from "../domains/conversation/native-session-continuation-repository.js";
import type { listReferencedNativeSessions, listNativeSessionSwitchChoices } from "../domains/conversation/native-session-history-repository.js";
import { Router, type RequestHandler, type Response } from "express";

export type NativeLiveProviderSessionStoreInternalDependencies = {
  beginNativeContinuationRelease?: (input: Parameters<typeof beginNativeContinuationRelease>[1]) => ReturnType<typeof beginNativeContinuationRelease>;
  cancelNativeContinuationRelease?: (input: Parameters<typeof cancelNativeContinuationRelease>[1]) => ReturnType<typeof cancelNativeContinuationRelease>;
  attachNativeContinuation?: (input: Parameters<typeof attachNativeContinuation>[1]) => ReturnType<typeof attachNativeContinuation>;
  releaseNativeContinuation?: (input: Parameters<typeof releaseNativeContinuation>[1]) => ReturnType<typeof releaseNativeContinuation>;
  readNativeContinuationState?: (input: Parameters<typeof readNativeContinuationState>[1]) => ReturnType<typeof readNativeContinuationState>;
  listNativeHistoryChoices?: (input: Parameters<typeof listNativeSessionSwitchChoices>[1]) => ReturnType<typeof listNativeSessionSwitchChoices>;
  listReferencedNativeSessions?: (input: Parameters<typeof listReferencedNativeSessions>[1]) => ReturnType<typeof listReferencedNativeSessions>;
};

export function createNativeLiveProviderSessionStoreInternalRouter(
  dependencies: NativeLiveProviderSessionStoreInternalDependencies,
): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.post("/native-history/continuation-state", nativeContinuationHandler(dependencies, "state"));
  router.post("/native-history/continuation-attach", nativeContinuationHandler(dependencies, "attach"));
  router.post("/native-history/continuation-release-begin", nativeContinuationHandler(dependencies, "begin"));
  router.post("/native-history/continuation-release-cancel", nativeContinuationHandler(dependencies, "cancel"));
  router.post("/native-history/continuation-release", nativeContinuationHandler(dependencies, "release"));
  // Continuation-only ownership endpoints and the metadata-only picker; the
  // former full-history copy/restore routes are gone.
  router.post("/native-history/choices", nativeHistoryChoicesHandler(dependencies));
  router.post("/native-history/referenced-sessions", async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    if (!body || Object.keys(body).length) { sendInvalid(response); return; }
    if (!dependencies.listReferencedNativeSessions) { sendNativeHistoryError(response, null); return; }
    try { response.json({ success: true, data: await dependencies.listReferencedNativeSessions({ userId }) }); }
    catch (error) { sendNativeHistoryError(response, error); }
  });
  return router;
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

function sendNativeHistoryError(response: Response, error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const conflicts = new Set(["NATIVE_SESSION_SWITCHING", "NATIVE_CONVERSATION_BUSY", "STALE_NATIVE_PROJECTION", "NATIVE_RELEASE_BEGIN_REQUIRED", "CANONICAL_CHECKPOINT_CHANGED", "NATIVE_SOURCE_BINDING_REQUIRED", "EXPLICIT_BRANCH_SELECTION_REQUIRED", "CLEANUP_IN_PROGRESS", "NATIVE_CONVERSATION_NOT_FOUND", "NATIVE_SESSION_ALREADY_ATTACHED"]);
  const invalid = new Set(["INVALID_NATIVE_PROJECTION"]);
  response.status(conflicts.has(code) ? 409 : invalid.has(code) ? 400 : 503).json({ success: false, error: {
    code: conflicts.has(code) || invalid.has(code) ? code : "NATIVE_HISTORY_UNAVAILABLE",
    message: "Native history restore could not be completed.",
  } });
}

function nativeContinuationHandler(dependencies: NativeLiveProviderSessionStoreInternalDependencies, operation: 'state' | 'attach' | 'release' | 'begin' | 'cancel'): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = readRecord(request.body);
    const keys = operation === 'begin' ? ['conversationId','sessionId','expectedHeadMessageId','expectedRevision']
      : operation === 'cancel' ? ['conversationId','expectedRevision']
      : operation === 'state' ? ['conversationId', 'sessionId'] : ['conversationId', 'sessionId', 'checkpointId', 'revision',
      'effectiveWorkingDirectory', 'expectedHeadMessageId', 'expectedRevision', 'checkpointIds', 'completedTurnCheckpointIds', ...(operation === 'attach' ? ['recoveredFailedTurnId'] : [])];
    if (!body || Object.keys(body).some(key => !keys.includes(key))) { sendInvalid(response); return; }
    try {
      if (operation === 'begin') {
        const input={...body,userId} as Parameters<typeof beginNativeContinuationRelease>[1];
        try {validateNativeContinuationReleaseBegin(input);} catch {sendInvalid(response);return;}
        if(!dependencies.beginNativeContinuationRelease){sendNativeHistoryError(response,null);return;}
        response.json({success:true,data:await dependencies.beginNativeContinuationRelease(input)});return;
      }
      if (operation === 'cancel') {
        const input={...body,userId} as Parameters<typeof cancelNativeContinuationRelease>[1];
        try {validateNativeContinuationReleaseCancel(input);} catch {sendInvalid(response);return;}
        if(!dependencies.cancelNativeContinuationRelease){sendNativeHistoryError(response,null);return;}
        response.json({success:true,data:await dependencies.cancelNativeContinuationRelease(input)});return;
      }
      if (operation === 'state') {
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (typeof body.conversationId !== 'string' || !uuid.test(body.conversationId) || typeof body.sessionId !== 'string' || !uuid.test(body.sessionId)) { sendInvalid(response); return; }
        if (!dependencies.readNativeContinuationState) { sendNativeHistoryError(response, null); return; }
        response.json({ success: true, data: await dependencies.readNativeContinuationState({ userId, conversationId: body.conversationId, sessionId: body.sessionId }) });
      } else {
        const input = { ...body, userId } as Parameters<typeof attachNativeContinuation>[1];
        try { validateNativeContinuationInput(input); } catch { sendInvalid(response); return; }
        const change = operation === 'attach' ? dependencies.attachNativeContinuation : dependencies.releaseNativeContinuation;
        if (!change) { sendNativeHistoryError(response, null); return; }
        response.json({ success: true, data: await change(input) });
      }
    } catch (error) { sendNativeHistoryError(response, error); }
  };
}
