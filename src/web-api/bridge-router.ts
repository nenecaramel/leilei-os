import { Router, type RequestHandler, type Response } from "express";
import {
  BridgeDomainError,
  type BridgeService,
} from "../domains/bridge/bridge-service.js";
import type { BridgeEventRecord } from "../domains/bridge/bridge-event-types.js";

export type BridgeApiDependencies = {
  bridgeService: Pick<BridgeService, "createPwaEvent" | "getEvent">;
};

export function createBridgeApiRouter(
  dependencies: BridgeApiDependencies,
): Router {
  const router = Router();
  router.post("/events", createBridgeEventHandler(dependencies));
  router.get("/events/:id", readBridgeEventHandler(dependencies));
  return router;
}

export function createBridgeEventHandler(
  dependencies: BridgeApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    const body = request.body;
    if (!isCreateBridgeEventBody(body)) {
      sendError(response, 400, "INVALID_BRIDGE_EVENT", "Bridge request is invalid.");
      return;
    }

    const idempotencyKey = request.header("Idempotency-Key");
    if (!idempotencyKey) {
      sendError(response, 400, "INVALID_BRIDGE_EVENT", "Bridge request is invalid.");
      return;
    }

    try {
      const result = await dependencies.bridgeService.createPwaEvent(
        request.webUserId,
        body.text,
        idempotencyKey,
      );
      response.status(result.created ? 201 : 200).json({
        success: true,
        data: compactEvent(result.event),
      });
    } catch (error) {
      sendBridgeError(response, error);
    }
  };
}

export function readBridgeEventHandler(
  dependencies: BridgeApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    try {
      const event = await dependencies.bridgeService.getEvent(
        request.webUserId,
        routeParam(request.params.id),
      );
      response.json({ success: true, data: compactEvent(event) });
    } catch (error) {
      sendBridgeError(response, error);
    }
  };
}

function isCreateBridgeEventBody(
  body: unknown,
): body is { text: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const entries = Object.entries(body);
  return entries.length === 1 && entries[0]?.[0] === "text" && typeof entries[0][1] === "string";
}

function compactEvent(event: BridgeEventRecord): {
  id: string;
  status: BridgeEventRecord["status"];
  createdAt: string;
  processingStatus: BridgeEventRecord["processingState"];
  modelClaimedAt: string | null;
  modelCompletedAt: string | null;
  deliveryReconciledAt: string | null;
} {
  return {
    id: event.id,
    status: event.status,
    createdAt: event.createdAt.toISOString(),
    processingStatus: event.processingState,
    modelClaimedAt: event.modelClaimedAt?.toISOString() ?? null,
    modelCompletedAt: event.modelCompletedAt?.toISOString() ?? null,
    deliveryReconciledAt: event.deliveryReconciledAt?.toISOString() ?? null,
  };
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function requireWebUser(response: Response, userId: string | undefined): userId is string {
  if (userId) return true;
  sendError(response, 401, "UNAUTHORIZED", "Web API authentication is required.");
  return false;
}

function sendBridgeError(response: Response, error: unknown): void {
  if (error instanceof BridgeDomainError) {
    if (error.code === "INVALID_INPUT") {
      sendError(response, 400, "INVALID_BRIDGE_EVENT", "Bridge request is invalid.");
      return;
    }
    if (error.code === "IDEMPOTENCY_CONFLICT") {
      sendError(response, 409, error.code, "Bridge event conflicts with an existing request.");
      return;
    }
    if (error.code === "EVENT_NOT_FOUND") {
      sendError(response, 404, "BRIDGE_EVENT_NOT_FOUND", "Bridge event was not found.");
      return;
    }
  }
  sendError(response, 503, "BRIDGE_UNAVAILABLE", "Bridge is temporarily unavailable.");
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({
    success: false,
    error: { code, message },
  });
}
