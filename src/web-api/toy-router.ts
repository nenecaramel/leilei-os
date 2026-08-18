import { Router, type RequestHandler, type Response } from "express";
import {
  ToyCommandService,
  ToyDomainError,
} from "../domains/toy/toy-command-service.js";
import type { ToyCommandRecord } from "../domains/toy/toy-command-types.js";
import { createToyBridgeAuthMiddleware } from "./toy-bridge-auth.js";
import { ActiveUserAuthorizationError } from "../domains/require-active-user.js";

export type ToyApiDependencies = {
  toyService: Pick<ToyCommandService, "create" | "claim" | "ack">;
};

export function createToyUserRouter(dependencies: ToyApiDependencies): Router {
  const router = Router();
  router.post("/commands", createToyCommandHandler(dependencies));
  return router;
}

export function createToyBridgeRouter(
  dependencies: ToyApiDependencies,
  bridgeKey: string | undefined,
): Router {
  const router = Router();
  const authenticateBridge = createToyBridgeAuthMiddleware(bridgeKey);
  router.post(
    "/claim",
    authenticateBridge,
    createClaimToyCommandHandler(dependencies),
  );
  router.post(
    "/:id/ack",
    authenticateBridge,
    createAckToyCommandHandler(dependencies),
  );
  return router;
}

export function createToyCommandHandler(
  dependencies: ToyApiDependencies,
): RequestHandler {
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!request.webUserId) {
      sendError(response, 401, "UNAUTHORIZED", "Web API authentication is required.");
      return;
    }
    try {
      const command = await dependencies.toyService.create(
        request.webUserId,
        request.body,
      );
      response.status(201).json({ success: true, data: serializeUserCommand(command) });
    } catch (error) {
      sendToyError(response, error);
    }
  };
}

export function createClaimToyCommandHandler(
  dependencies: ToyApiDependencies,
): RequestHandler {
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!isEmptyBody(request.body)) {
      sendError(response, 400, "INVALID_TOY_REQUEST", "The toy request is invalid.");
      return;
    }
    try {
      const command = await dependencies.toyService.claim();
      if (!command) {
        response.status(204).send();
        return;
      }
      response.json({ success: true, data: serializeBridgeCommand(command) });
    } catch (error) {
      sendToyError(response, error);
    }
  };
}

export function createAckToyCommandHandler(
  dependencies: ToyApiDependencies,
): RequestHandler {
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const command = await dependencies.toyService.ack(
        getRouteParam(request.params.id),
        request.body,
      );
      response.json({ success: true, data: serializeAck(command) });
    } catch (error) {
      sendToyError(response, error);
    }
  };
}

function serializeUserCommand(command: ToyCommandRecord) {
  return {
    id: command.id,
    action: command.action,
    percent: command.percent,
    durationSeconds: command.action === "set" ? command.durationSeconds : null,
    status: command.status,
    createdAt: command.createdAt.toISOString(),
    expiresAt: command.expiresAt.toISOString(),
  };
}

function serializeBridgeCommand(command: ToyCommandRecord) {
  return {
    id: command.id,
    action: command.action,
    ...(command.action === "set"
      ? { percent: command.percent, durationSeconds: command.durationSeconds }
      : {}),
    expiresAt: command.expiresAt.toISOString(),
  };
}

function serializeAck(command: ToyCommandRecord) {
  return {
    id: command.id,
    status: command.status,
    completedAt: command.completedAt?.toISOString() ?? null,
  };
}

function sendToyError(response: Response, error: unknown): void {
  if (error instanceof ActiveUserAuthorizationError) {
    sendError(response, 503, "TOY_UNAVAILABLE", "Toy command queue is unavailable.");
    return;
  }
  if (!(error instanceof ToyDomainError)) {
    sendError(response, 500, "TOY_ERROR", "The toy request could not be completed.");
    return;
  }
  if (error.code === "INVALID_INPUT") {
    sendError(response, 400, "INVALID_TOY_REQUEST", "The toy request is invalid.");
  } else if (error.code === "TOY_UNAVAILABLE") {
    sendError(response, 503, "TOY_UNAVAILABLE", "Toy command queue is unavailable.");
  } else if (error.code === "TOY_FORBIDDEN") {
    sendError(response, 403, "TOY_FORBIDDEN", "Toy commands are unavailable.");
  } else if (error.code === "COMMAND_NOT_FOUND") {
    sendError(response, 404, "TOY_COMMAND_NOT_FOUND", "Command was not found.");
  } else {
    sendError(response, 409, "TOY_COMMAND_CONFLICT", "Command cannot be acknowledged.");
  }
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({ success: false, error: { code, message } });
}

function isEmptyBody(body: unknown): boolean {
  return body === undefined ||
    (typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0);
}

function getRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
