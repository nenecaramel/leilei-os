import type {
  RequestHandler,
  Response,
} from "express";
import { NativeLiveProviderSessionCleanupError } from "../../domains/bridge/provider-session/native-live-provider-session-cleanup.js";
import { NativeLiveManualCompactError } from "../../domains/bridge/turn/native-live-manual-compact.js";
import { NativeLiveExternalSessionBridgeError } from "../../domains/bridge/provider-session/native-live-external-session-bridge.js";
import { NativeLiveClaudeHandoffError } from "../../domains/bridge/provider-session/native-live-claude-handoff.js";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import {
  requireInternalUser,
  parseListenerBody,
  sendInvalid,
  parseReservationId,
  isUuid,
} from "./http.js";

export function reserveExternalSessionsHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.externalSessionBridgeService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }
    try {
      const reservation =
        await dependencies.externalSessionBridgeService.reserveNext({
          userId,
          listenerInstanceId: body.listener_instance_id,
        });
      response.json({
        success: true,
        data: reservation,
      });
    } catch (error) {
      sendExternalSessionBridgeInternalError(response, error);
    }
  };
}

export function submitExternalSessionsResultHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.externalSessionBridgeService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseExternalSessionResultBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }
    try {
      const outcome =
        await dependencies.externalSessionBridgeService.complete({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          outcome: body.outcome,
        });
      response.json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      sendExternalSessionBridgeInternalError(response, error);
    }
  };
}

export function reserveClaudeHandoffHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.claudeHandoffService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }
    try {
      const reservation =
        await dependencies.claudeHandoffService.reserveNext({
          userId,
          listenerInstanceId: body.listener_instance_id,
        });
      response.json({
        success: true,
        data: reservation,
      });
    } catch (error) {
      sendClaudeHandoffInternalError(response, error);
    }
  };
}

export function submitClaudeHandoffResultHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.claudeHandoffService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseClaudeHandoffResultBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }
    try {
      const outcome =
        await dependencies.claudeHandoffService.complete({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          outcome: body.outcome,
        });
      response.json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      sendClaudeHandoffInternalError(response, error);
    }
  };
}

export function reserveManualCompactHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.manualCompactService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }
    try {
      const reservation =
        await dependencies.manualCompactService.reserveNext({
          userId,
          listenerInstanceId: body.listener_instance_id,
        });
      response.json({
        success: true,
        data: reservation,
      });
    } catch (error) {
      sendManualCompactError(response, error);
    }
  };
}

export function submitManualCompactResultHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.manualCompactService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseManualCompactResultBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }
    try {
      const outcome =
        await dependencies.manualCompactService.complete({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          outcome: body.outcome,
        });
      response.json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      sendManualCompactError(response, error);
    }
  };
}

export function reserveProviderSessionCleanupHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.providerSessionCleanupService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const reservation =
        await dependencies.providerSessionCleanupService.reserveNext({
          userId,
          listenerInstanceId: body.listener_instance_id,
        });
      response.json({
        success: true,
        data: reservation,
      });
    } catch (error) {
      sendProviderSessionCleanupError(response, error);
    }
  };
}

export function submitProviderSessionCleanupResultHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.providerSessionCleanupService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseProviderSessionCleanupResultBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const outcome =
        await dependencies.providerSessionCleanupService.complete({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          outcome:
            body.status === "success"
              ? { status: "success" }
              : {
                  status: "failure",
                  failureCode: body.failure_code,
                },
        });
      response.json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      sendProviderSessionCleanupError(response, error);
    }
  };
}

function parseProviderSessionCleanupResultBody(
  value: unknown,
):
  | {
      listener_instance_id: string;
      status: "success";
    }
  | {
      listener_instance_id: string;
      status: "failure";
      failure_code: string;
    }
  | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !isUuid(record.listener_instance_id)
    || (
      record.status !== "success"
      && record.status !== "failure"
    )
  ) {
    return null;
  }

  if (record.status === "success") {
    if (
      Object.keys(record).length !== 2
      || "failure_code" in record
    ) {
      return null;
    }
    return {
      listener_instance_id: record.listener_instance_id,
      status: "success",
    };
  }

  if (
    Object.keys(record).length !== 3
    || typeof record.failure_code !== "string"
    || !record.failure_code.trim()
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    status: "failure",
    failure_code: record.failure_code,
  };
}

function parseExternalSessionResultBody(
  value: unknown,
): {
  listener_instance_id: string;
  outcome:
    | {
        status: "success";
        sessions: Array<{
          sessionId: string;
          summary: string | null;
          customTitle: string | null;
          firstPrompt: string | null;
          gitBranch: string | null;
          lastModified: number | null;
          createdAt: number | null;
          workingDirectory: string;
        }>;
      }
    | {
        status: "failure";
        failureCode: string;
      };
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isUuid(record.listener_instance_id)) return null;

  if (record.status === "failure") {
    if (
      typeof record.failure_code !== "string"
      || !record.failure_code.trim()
    ) return null;
    return {
      listener_instance_id: record.listener_instance_id,
      outcome: {
        status: "failure",
        failureCode: record.failure_code,
      },
    };
  }

  if (record.status !== "success" || !Array.isArray(record.sessions)) {
    return null;
  }
  const sessions = [];
  for (const item of record.sessions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.session_id !== "string"
      || !row.session_id.trim()
      || typeof row.working_directory !== "string"
      || !row.working_directory.trim()
      || !nullableString(row.summary)
      || !nullableString(row.custom_title)
      || !nullableString(row.first_prompt)
      || !nullableString(row.git_branch)
      || !nullableFiniteNumberValue(row.last_modified)
      || !nullableFiniteNumberValue(row.created_at)
    ) {
      return null;
    }
    sessions.push({
      sessionId: row.session_id,
      summary:
        typeof row.summary === "string" ? row.summary : null,
      customTitle:
        typeof row.custom_title === "string"
          ? row.custom_title
          : null,
      firstPrompt:
        typeof row.first_prompt === "string"
          ? row.first_prompt
          : null,
      gitBranch:
        typeof row.git_branch === "string"
          ? row.git_branch
          : null,
      lastModified:
        typeof row.last_modified === "number"
          ? row.last_modified
          : null,
      createdAt:
        typeof row.created_at === "number"
          ? row.created_at
          : null,
      workingDirectory: row.working_directory,
    });
  }
  return {
    listener_instance_id: record.listener_instance_id,
    outcome: {
      status: "success",
      sessions,
    },
  };
}

function nullableString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "string";
}

function nullableFiniteNumberValue(value: unknown): boolean {
  return value === null
    || value === undefined
    || (typeof value === "number" && Number.isFinite(value));
}

function parseClaudeHandoffResultBody(
  value: unknown,
): {
  listener_instance_id: string;
  outcome:
    | {
        status: "success";
        handoffSessionId: string;
      }
    | {
        status: "failure";
        failureCode: string;
      };
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isUuid(record.listener_instance_id)) return null;

  if (record.status === "failure") {
    if (
      typeof record.failure_code !== "string"
      || !record.failure_code.trim()
    ) return null;
    return {
      listener_instance_id: record.listener_instance_id,
      outcome: {
        status: "failure",
        failureCode: record.failure_code,
      },
    };
  }

  if (
    record.status !== "success"
    || typeof record.handoff_session_id !== "string"
    || !record.handoff_session_id.trim()
  ) {
    return null;
  }

  return {
    listener_instance_id: record.listener_instance_id,
    outcome: {
      status: "success",
      handoffSessionId: record.handoff_session_id,
    },
  };
}

function parseManualCompactResultBody(
  value: unknown,
): {
  listener_instance_id: string;
  outcome:
    | {
        status: "success";
        result: {
          providerSessionId: string;
          providerCheckpointId?: string | null;
          contextUsage: import("../../domains/bridge/protocol/native-live-runtime-protocol.js").NativeLiveRuntimeContextUsage | null;
          boundary: Record<string, unknown> | null;
          summary: string | null;
        };
      }
    | {
        status: "failure";
        failureCode: string;
      };
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isUuid(record.listener_instance_id)) return null;

  if (record.status === "failure") {
    if (
      typeof record.failure_code !== "string"
      || !record.failure_code.trim()
    ) return null;
    return {
      listener_instance_id: record.listener_instance_id,
      outcome: {
        status: "failure",
        failureCode: record.failure_code,
      },
    };
  }

  if (
    record.status !== "success"
    || !record.result
    || typeof record.result !== "object"
    || Array.isArray(record.result)
  ) return null;
  const result = record.result as Record<string, unknown>;
  if (
    typeof result.provider_session_id !== "string"
    || !result.provider_session_id.trim()
  ) return null;

  if (result.provider_checkpoint_id != null && !isUuid(result.provider_checkpoint_id)) return null;

  const contextUsage =
    result.context_usage === null
      ? null
      : parseManualCompactContextUsage(result.context_usage);
  if (result.context_usage !== null && !contextUsage) return null;

  const boundary =
    result.boundary === null
      ? null
      : (
          result.boundary
          && typeof result.boundary === "object"
          && !Array.isArray(result.boundary)
            ? result.boundary as Record<string, unknown>
            : null
        );
  if (result.boundary !== null && !boundary) return null;
  if (
    result.summary !== null
    && typeof result.summary !== "string"
  ) return null;

  return {
    listener_instance_id: record.listener_instance_id,
    outcome: {
      status: "success",
      result: {
        providerSessionId: result.provider_session_id,
        providerCheckpointId: typeof result.provider_checkpoint_id === "string" ? result.provider_checkpoint_id : null,
        contextUsage,
        boundary,
        summary:
          typeof result.summary === "string"
            ? result.summary
            : null,
      },
    },
  };
}

function parseManualCompactContextUsage(
  value: unknown,
): import("../../domains/bridge/protocol/native-live-runtime-protocol.js").NativeLiveRuntimeContextUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const numberOrNull = (input: unknown): number | null | undefined =>
    input === null
      ? null
      : typeof input === "number" && Number.isFinite(input)
        ? input
        : undefined;
  const total = numberOrNull(record.total_tokens);
  const max = numberOrNull(record.max_tokens);
  const rawMax = numberOrNull(record.raw_max_tokens);
  const percentage = numberOrNull(record.percentage);
  if (
    total === undefined
    || max === undefined
    || rawMax === undefined
    || percentage === undefined
    || !Array.isArray(record.categories)
  ) return null;
  const categories = [];
  for (const item of record.categories) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const category = item as Record<string, unknown>;
    const tokens = numberOrNull(category.tokens);
    if (
      tokens === undefined
      || !(category.name === null || typeof category.name === "string")
      || !(category.kind === null || typeof category.kind === "string")
      || !(
        category.is_deferred === null
        || typeof category.is_deferred === "boolean"
      )
    ) return null;
    categories.push({
      name: category.name as string | null,
      tokens,
      kind: category.kind as string | null,
      is_deferred: category.is_deferred as boolean | null,
    });
  }
  return {
    model:
      record.model === null || typeof record.model === "string"
        ? record.model as string | null
        : null,
    total_tokens: total,
    max_tokens: max,
    raw_max_tokens: rawMax,
    percentage,
    categories,
  };
}

function sendExternalSessionBridgeInternalError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveExternalSessionBridgeError) {
    response.status(409).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_EXTERNAL_SESSION_UNAVAILABLE",
      message: "External Claude sessions are temporarily unavailable.",
    },
  });
}

function sendClaudeHandoffInternalError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveClaudeHandoffError) {
    response.status(409).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_CLAUDE_HANDOFF_UNAVAILABLE",
      message: "Claude handoff is temporarily unavailable.",
    },
  });
}

function sendManualCompactError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveManualCompactError) {
    response.status(409).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_MANUAL_COMPACT_UNAVAILABLE",
      message: "Manual compact is temporarily unavailable.",
    },
  });
}

function sendProviderSessionCleanupError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveProviderSessionCleanupError) {
    response.status(409).json({
      success: false,
      error: {
        code: error.code,
        message:
          error.code === "LISTENER_NOT_ACTIVE"
            ? "Native live provider session cleanup listener lease is not active."
            : "Provider session cleanup reservation is no longer valid.",
      },
    });
    return;
  }

  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_PROVIDER_SESSION_CLEANUP_UNAVAILABLE",
      message:
        "Native live provider session cleanup is temporarily unavailable.",
    },
  });
}
