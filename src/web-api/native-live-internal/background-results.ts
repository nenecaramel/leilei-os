import type { RequestHandler, Response } from "express";
import { NativeLiveBackgroundResultError, parseBackgroundPrepareBody, parseBackgroundSubmitBody } from "../../domains/bridge/protocol/native-live-background-result.js";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import { parseReservationId, requireInternalUser, sendInvalid } from "./http.js";

function failure(response: Response, error: unknown): void {
  const code = error instanceof NativeLiveBackgroundResultError ? error.code : "BACKGROUND_UNAVAILABLE";
  const status = code === "INVALID_BACKGROUND_RESULT" ? 400 : code === "BACKGROUND_NOT_FOUND" ? 404 : code === "BACKGROUND_CONFLICT" ? 409 : 503;
  response.status(status).json({ success: false, error: { code, message: "Native background result could not be accepted." } });
}
export function prepareBackgroundResultHandler(dependencies: NativeLiveRelayInternalDependencies): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId); if (!userId) return;
    const sourcePrepareId = parseReservationId(request.params.reservationId);
    let body; try { body = parseBackgroundPrepareBody(request.body); } catch { sendInvalid(response); return; }
    if (!sourcePrepareId) { sendInvalid(response); return; }
    try {
      if (!dependencies.relayService.prepareBackgroundResult) throw new NativeLiveBackgroundResultError("BACKGROUND_UNAVAILABLE");
      const data = await dependencies.relayService.prepareBackgroundResult({ userId, sourcePrepareId, ...body });
      response.json({ success: true, data });
    } catch (error) { failure(response, error); }
  };
}
export function submitBackgroundResultHandler(dependencies: NativeLiveRelayInternalDependencies): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId); if (!userId) return;
    const sourcePrepareId = parseReservationId(request.params.reservationId), receiptId = parseReservationId(request.params.receiptId);
    let body; try { body = parseBackgroundSubmitBody(request.body); } catch { sendInvalid(response); return; }
    if (!sourcePrepareId || !receiptId) { sendInvalid(response); return; }
    try {
      if (!dependencies.relayService.submitBackgroundResult) throw new NativeLiveBackgroundResultError("BACKGROUND_UNAVAILABLE");
      const data = await dependencies.relayService.submitBackgroundResult({ userId, sourcePrepareId, receiptId, ...body });
      response.json({ success: true, data });
    } catch (error) { failure(response, error); }
  };
}
