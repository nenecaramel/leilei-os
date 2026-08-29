import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import {
  SentinelDomainError,
  projectSentinelStatus,
  type SentinelService,
} from "../domains/sentinel/sentinel-service.js";
import type { SentinelControlResult } from "../domains/sentinel/sentinel-types.js";

export type SentinelApiDependencies = {
  sentinelService: Pick<SentinelService,
    | "findSentinel"
    | "upsertPolicy"
    | "pause"
    | "resume"
    | "resumeNow"
    | "wakeNow"
    | "recover"
    | "listWakeActivity"
  >;
};

const policyBody = z.object({
  timezone: z.string().min(1).max(64),
  policyPrompt: z.string().max(4_000),
}).strict();

const resumeBody = z.object({
  next_wake_at: z.string().datetime({ offset: true }),
}).strict();
const emptyBody = z.object({}).strict();

export function createSentinelApiRouter(
  dependencies: SentinelApiDependencies,
): Router {
  const router = Router();

  router.get("/", authenticated(async (request, response) => {
    const sentinel = await dependencies.sentinelService.findSentinel(request.webUserId!);
    if (!sentinel) throw new SentinelDomainError("SENTINEL_NOT_FOUND", "Sentinel was not found.");
    const latest = sentinel.activeWakeRunId
      ? (await dependencies.sentinelService.listWakeActivity(request.webUserId!, 100)).find((wake) => wake.id === sentinel.activeWakeRunId)
      : undefined;
    const status = projectSentinelStatus({
      enabled: sentinel.enabled,
      recoveryRequired: latest?.state === "recovery_required",
      processing: latest?.state === "claimed",
      listenerAvailable: false,
      wakePending: latest?.state === "bridge_enqueued",
      nextWakeAt: sentinel.nextWakeAt,
      now: new Date(),
    });
    response.json({ success: true, data: { sentinel, status } });
  }));

  router.put("/", authenticated(async (request, response) => {
    const parsed = policyBody.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, "INVALID_SENTINEL", "Sentinel request is invalid.");
      return;
    }
    const sentinel = await dependencies.sentinelService.upsertPolicy(
      request.webUserId!,
      parsed.data,
    );
    response.json({ success: true, data: { sentinel } });
  }));

  router.post("/pause", controlHandler(dependencies, "pause"));
  router.post("/resume", authenticated(async (request, response) => {
    const parsed = resumeBody.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, "INVALID_SENTINEL", "Sentinel request is invalid.");
      return;
    }
    const result = await dependencies.sentinelService.resume(
      request.webUserId!,
      new Date(parsed.data.next_wake_at),
    );
    sendControlResult(response, result);
  }));
  router.post("/resume-now", controlHandler(dependencies, "resumeNow"));
  router.post("/wake-now", controlHandler(dependencies, "wakeNow"));
  router.post("/recover", controlHandler(dependencies, "recover"));

  router.get("/wakes", authenticated(async (request, response) => {
    const value = request.query.limit;
    if (Array.isArray(value) || (value !== undefined && typeof value !== "string")) {
      sendError(response, 400, "INVALID_SENTINEL", "Sentinel request is invalid.");
      return;
    }
    const limit = value === undefined ? 20 : Number(value);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      sendError(response, 400, "INVALID_SENTINEL", "Sentinel request is invalid.");
      return;
    }
    const wakes = await dependencies.sentinelService.listWakeActivity(request.webUserId!, limit);
    response.json({ success: true, data: { wakes } });
  }));

  return router;
}

type ControlMethod = "pause" | "resumeNow" | "wakeNow" | "recover";

function controlHandler(
  dependencies: SentinelApiDependencies,
  method: ControlMethod,
): RequestHandler {
  return authenticated(async (request, response) => {
    const parsed = emptyBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      sendError(response, 400, "INVALID_SENTINEL", "Sentinel request is invalid.");
      return;
    }
    const result = await dependencies.sentinelService[method](request.webUserId!);
    sendControlResult(response, result);
  });
}

function sendControlResult(response: Response, result: SentinelControlResult): void {
  if (result.outcome === "not_found") {
    throw new SentinelDomainError("SENTINEL_NOT_FOUND", "Sentinel was not found.");
  }
  if (result.outcome === "conflict") {
    throw new SentinelDomainError("SENTINEL_WAKE_CONFLICT", "Sentinel control conflicts with current state.");
  }
  response.json({ success: true, data: result });
}

function authenticated(operation: (request: Parameters<RequestHandler>[0], response: Response) => Promise<void>): RequestHandler {
  return async (request, response) => {
    if (!request.webUserId) {
      sendError(response, 401, "UNAUTHORIZED", "Web API authentication is required.");
      return;
    }
    try {
      rejectIdentity(request.body, request.query);
      await operation(request, response);
    } catch (error) {
      sendSentinelError(response, error);
    }
  };
}

function rejectIdentity(body: unknown, query: unknown): void {
  const has = (value: unknown, seen = new Set<object>()): boolean => {
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    if (Object.prototype.hasOwnProperty.call(value, "user_id") || Object.prototype.hasOwnProperty.call(value, "userId")) return true;
    return Array.isArray(value)
      ? value.some((item) => has(item, seen))
      : Object.values(value).some((item) => has(item, seen));
  };
  if (has(body) || has(query)) throw new SentinelDomainError("INVALID_CONTROL_REVISION", "Client identity selectors are not accepted.");
}

function sendSentinelError(response: Response, error: unknown): void {
  if (!(error instanceof SentinelDomainError)) {
    sendError(response, 503, "SENTINEL_UNAVAILABLE", "Sentinel is temporarily unavailable.");
    return;
  }
  if (["INVALID_USER_ID", "INVALID_TIMEZONE", "INVALID_POLICY_PROMPT", "INVALID_NEXT_WAKE", "NEXT_WAKE_TOO_SOON", "NEXT_WAKE_TOO_FAR", "INVALID_CAPSULE", "CAPSULE_TOO_LONG", "INVALID_CONTROL_REVISION", "INVALID_WAKE_ID"].includes(error.code)) {
    sendError(response, 400, "INVALID_SENTINEL", "Sentinel request is invalid.");
    return;
  }
  if (error.code === "SENTINEL_NOT_FOUND" || error.code === "SENTINEL_WAKE_NOT_FOUND") {
    sendError(response, 404, "SENTINEL_NOT_FOUND", "Sentinel was not found.");
    return;
  }
  if (error.code === "SENTINEL_WAKE_CONFLICT") {
    sendError(response, 409, "SENTINEL_CONFLICT", "Sentinel control conflicts with current state.");
    return;
  }
  sendError(response, 503, "SENTINEL_UNAVAILABLE", "Sentinel is temporarily unavailable.");
}

function sendError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ success: false, error: { code, message } });
}
