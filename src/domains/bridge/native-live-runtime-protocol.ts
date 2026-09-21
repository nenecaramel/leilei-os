import type { NativeLiveNormalizedEvent } from "../conversation/native-live-conversation-orchestrator.js";

export const NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION = 1 as const;

export type NativeLiveRuntimeMode = "new" | "fork";

export type NativeLiveRuntimeCommand = {
  protocol_version: 1;
  dispatch_target: "claude_code";
  prepare_id: string;
  request_id: string;
  operation: "send" | "retry" | "edit";
  conversation_id: string;
  canonical_user_message_id: string;
  runtime_mode: NativeLiveRuntimeMode;
  parent_provider_session_id: string | null;
  prompt: string;
};

export type NativeLiveRuntimeFailureCode =
  | "CLAUDE_PROCESS_FAILED"
  | "MALFORMED_STREAM"
  | "ABORTED"
  | "NO_PROVIDER_SESSION"
  | "PROVIDER_SESSION_CONFLICT"
  | "RUNTIME_UNAVAILABLE";

export type NativeLiveRuntimeExecutionResult =
  | {
      protocol_version: 1;
      prepare_id: string;
      request_id: string;
      conversation_id: string;
      status: "success";
      provider_session_id: string;
      normalized_events: NativeLiveNormalizedEvent[];
    }
  | {
      protocol_version: 1;
      prepare_id: string;
      request_id: string;
      conversation_id: string;
      status: "failure";
      error_code: NativeLiveRuntimeFailureCode;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PROMPT_CHARS = 4_000;

export class NativeLiveRuntimeProtocolError extends Error {
  readonly code = "INVALID_NATIVE_LIVE_RUNTIME_PROTOCOL";

  constructor(message: string) {
    super(message);
    this.name = "NativeLiveRuntimeProtocolError";
  }
}

export function parseNativeLiveRuntimeCommand(
  value: unknown,
): NativeLiveRuntimeCommand {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "protocol_version",
    "dispatch_target",
    "prepare_id",
    "request_id",
    "operation",
    "conversation_id",
    "canonical_user_message_id",
    "runtime_mode",
    "parent_provider_session_id",
    "prompt",
  ]);

  if (body.protocol_version !== NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION) {
    throw new NativeLiveRuntimeProtocolError("Unsupported runtime protocol version.");
  }
  if (body.dispatch_target !== "claude_code") {
    throw new NativeLiveRuntimeProtocolError("Runtime command target must be Claude Code.");
  }
  const operation = body.operation;
  if (operation !== "send" && operation !== "retry" && operation !== "edit") {
    throw new NativeLiveRuntimeProtocolError("Runtime operation is invalid.");
  }
  const runtimeMode = body.runtime_mode;
  if (runtimeMode !== "new" && runtimeMode !== "fork") {
    throw new NativeLiveRuntimeProtocolError("Runtime mode is invalid.");
  }

  const parentProviderSessionId =
    body.parent_provider_session_id === null
      ? null
      : requireNonblank(body.parent_provider_session_id, "parent_provider_session_id");

  if (runtimeMode === "new" && parentProviderSessionId !== null) {
    throw new NativeLiveRuntimeProtocolError(
      "New runtime command must not include a parent provider session.",
    );
  }
  if (runtimeMode === "fork" && parentProviderSessionId === null) {
    throw new NativeLiveRuntimeProtocolError(
      "Fork runtime command requires a parent provider session.",
    );
  }

  return {
    protocol_version: NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
    dispatch_target: "claude_code",
    prepare_id: requireUuid(body.prepare_id, "prepare_id"),
    request_id: requireUuid(body.request_id, "request_id"),
    operation,
    conversation_id: requireUuid(body.conversation_id, "conversation_id"),
    canonical_user_message_id: requireUuid(
      body.canonical_user_message_id,
      "canonical_user_message_id",
    ),
    runtime_mode: runtimeMode,
    parent_provider_session_id: parentProviderSessionId,
    prompt: normalizePrompt(body.prompt),
  };
}

export function parseNativeLiveRuntimeExecutionResult(
  value: unknown,
): NativeLiveRuntimeExecutionResult {
  const body = requireRecord(value);
  const status = body.status;

  if (status === "success") {
    requireExactKeys(body, [
      "protocol_version",
      "prepare_id",
      "request_id",
      "conversation_id",
      "status",
      "provider_session_id",
      "normalized_events",
    ]);

    if (body.protocol_version !== NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION) {
      throw new NativeLiveRuntimeProtocolError("Unsupported runtime protocol version.");
    }
    if (!Array.isArray(body.normalized_events)) {
      throw new NativeLiveRuntimeProtocolError("normalized_events must be an array.");
    }

    return {
      protocol_version: NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
      prepare_id: requireUuid(body.prepare_id, "prepare_id"),
      request_id: requireUuid(body.request_id, "request_id"),
      conversation_id: requireUuid(body.conversation_id, "conversation_id"),
      status,
      provider_session_id: requireNonblank(
        body.provider_session_id,
        "provider_session_id",
      ),
      normalized_events:
        body.normalized_events as NativeLiveNormalizedEvent[],
    };
  }

  if (status === "failure") {
    requireExactKeys(body, [
      "protocol_version",
      "prepare_id",
      "request_id",
      "conversation_id",
      "status",
      "error_code",
    ]);

    if (body.protocol_version !== NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION) {
      throw new NativeLiveRuntimeProtocolError("Unsupported runtime protocol version.");
    }
    if (!isFailureCode(body.error_code)) {
      throw new NativeLiveRuntimeProtocolError("Runtime failure code is invalid.");
    }

    return {
      protocol_version: NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
      prepare_id: requireUuid(body.prepare_id, "prepare_id"),
      request_id: requireUuid(body.request_id, "request_id"),
      conversation_id: requireUuid(body.conversation_id, "conversation_id"),
      status,
      error_code: body.error_code,
    };
  }

  throw new NativeLiveRuntimeProtocolError("Runtime result status is invalid.");
}

export function assertRuntimeResultMatchesCommand(
  command: NativeLiveRuntimeCommand,
  result: NativeLiveRuntimeExecutionResult,
): void {
  if (
    result.prepare_id !== command.prepare_id
    || result.request_id !== command.request_id
    || result.conversation_id !== command.conversation_id
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Runtime result does not match the prepared command identity.",
    );
  }

  if (
    result.status === "success"
    && command.runtime_mode === "fork"
    && result.provider_session_id === command.parent_provider_session_id
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Fork result must use a new provider session id.",
    );
  }
}

function isFailureCode(value: unknown): value is NativeLiveRuntimeFailureCode {
  return (
    value === "CLAUDE_PROCESS_FAILED"
    || value === "MALFORMED_STREAM"
    || value === "ABORTED"
    || value === "NO_PROVIDER_SESSION"
    || value === "PROVIDER_SESSION_CONFLICT"
    || value === "RUNTIME_UNAVAILABLE"
  );
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NativeLiveRuntimeProtocolError("Runtime protocol payload must be an object.");
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new NativeLiveRuntimeProtocolError(
        `Unexpected runtime protocol field: ${key}`,
      );
    }
  }
  for (const key of allowed) {
    if (!(key in value)) {
      throw new NativeLiveRuntimeProtocolError(
        `Missing runtime protocol field: ${key}`,
      );
    }
  }
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new NativeLiveRuntimeProtocolError(`${field} must be a UUID.`);
  }
  return value;
}

function requireNonblank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NativeLiveRuntimeProtocolError(`${field} must be nonblank.`);
  }
  return value;
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== "string") {
    throw new NativeLiveRuntimeProtocolError("prompt must be a string.");
  }
  const prompt = value.replace(/\r\n?/g, "\n").trim();
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_CHARS) {
    throw new NativeLiveRuntimeProtocolError(
      "prompt must contain between 1 and 4000 characters.",
    );
  }
  return prompt;
}
