import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import type { SafeLogger } from "./logger.js";
import { classifyRoute, runWithRequestContext } from "./request-context.js";

export function createHttpObservabilityMiddleware(options: {
  logger: SafeLogger;
  generateRequestId?: () => string;
  now?: () => number;
}): RequestHandler {
  const generateRequestId = options.generateRequestId ?? randomUUID;
  const now = options.now ?? Date.now;

  return (request, response, next) => {
    const requestId = generateRequestId();
    const startedAt = now();
    const routeClass = classifyRoute(request.path);
    let completed = false;

    const complete = (): void => {
      if (completed) return;
      completed = true;
      runWithRequestContext({ requestId }, () => {
        options.logger.info("http_request_completed", {
          method: request.method,
          routeClass,
          status: response.statusCode,
          durationMs: Math.max(0, now() - startedAt),
        });
      });
    };

    response.setHeader("x-request-id", requestId);
    runWithRequestContext({ requestId }, () => {
      response.once("finish", complete);
      response.once("close", complete);
      next();
    });
  };
}
