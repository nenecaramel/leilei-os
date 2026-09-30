import type { NativeLiveNormalizedEvent } from "../conversation/native-live-conversation-orchestrator.js";
import {
  NativeLiveExecutionSelectionError,
  parseNativeLiveExecutionSelection,
  type NativeLiveExecutionSelection,
} from "./native-live-execution-selection.js";

export const NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION = 3 as const;
export const NATIVE_LIVE_RUNTIME_ATTACHMENT_PROTOCOL_VERSION = 2 as const;
export const NATIVE_LIVE_RUNTIME_LEGACY_PROTOCOL_VERSION = 1 as const;

export type NativeLiveRuntimeMode = "new" | "fork";

export type NativeLiveRuntimeAttachment = {
  attachment_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  kind: "image" | "file";
};

export type NativeLiveRuntimeCommand = {
  protocol_version: 1 | 2 | 3;
  dispatch_target: "claude_code";
  prepare_id: string;
  request_id: string;
  operation: "send" | "retry" | "edit";
  conversation_id: string;
  canonical_user_message_id: string;
  runtime_mode: NativeLiveRuntimeMode;
  parent_provider_session_id: string | null;
  workspace_id: string | null;
  expected_workspace_root: string | null;
  execution_selection?: NativeLiveExecutionSelection | null;
  attachments?: NativeLiveRuntimeAttachment[];
  prompt: string;
};

export type NativeLiveRuntimeFailureCode =
  | "CLAUDE_PROCESS_FAILED"
  | "MALFORMED_STREAM"
  | "ABORTED"
  | "INTERRUPTED"
  | "NO_PROVIDER_SESSION"
  | "PROVIDER_SESSION_CONFLICT"
  | "WORKSPACE_UNAVAILABLE"
  | "WORKSPACE_ROOT_MISMATCH"
  | "ATTACHMENT_UNAVAILABLE"
  | "RUNTIME_UNAVAILABLE";

export type NativeLiveRuntimeContextUsageCategory = {
  name: string | null;
  tokens: number | null;
  kind: string | null;
  is_deferred: boolean | null;
};

export type NativeLiveRuntimeContextUsage = {
  model: string | null;
  total_tokens: number | null;
  max_tokens: number | null;
  raw_max_tokens: number | null;
  percentage: number | null;
  categories: NativeLiveRuntimeContextUsageCategory[];
};

export type NativeLiveRuntimeExecutionCapability = {
  value: string | null;
  display_name: string | null;
  description: string | null;
  supports_effort: boolean | null;
  supported_effort_levels: string[];
  supports_adaptive_thinking: boolean | null;
  supports_fast_mode: boolean | null;
  supports_auto_mode: boolean | null;
};

export type NativeLiveRuntimeExecutionReadback = {
  requested: {
    model: string | null;
    thinking: string | null;
    effort: string | null;
  } | null;
  applied: {
    model: string | null;
    effort: string | null;
  };
  capability: NativeLiveRuntimeExecutionCapability | null;
};

export type NativeLiveRuntimeExecutionMetadata = {
  readback: NativeLiveRuntimeExecutionReadback;
  readback_error: "READBACK_UNAVAILABLE" | null;
};

export type NativeLiveRuntimeMetadata = {
  context_usage: NativeLiveRuntimeContextUsage | null;
  execution?: NativeLiveRuntimeExecutionMetadata | null;
};

export type NativeLiveRuntimeExecutionResult =
  | {
      protocol_version: 1 | 2 | 3;
      prepare_id: string;
      request_id: string;
      conversation_id: string;
      status: "success";
      provider_session_id: string;
      workspace_id: string | null;
      effective_workspace_root: string | null;
      normalized_events: NativeLiveNormalizedEvent[];
      output_attachment_ids?: string[];
      runtime_metadata?: NativeLiveRuntimeMetadata | null;
    }
  | {
      protocol_version: 1 | 2;
      prepare_id: string;
      request_id: string;
      conversation_id: string;
      status: "failure";
      error_code: NativeLiveRuntimeFailureCode;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PROMPT_CHARS = 16_000;

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
  ], [
    "execution_selection",
    "workspace_id",
    "expected_workspace_root",
    "attachments",
  ]);

  const protocolVersion = parseProtocolVersion(
    body.protocol_version,
  );
  if (
    protocolVersion === NATIVE_LIVE_RUNTIME_LEGACY_PROTOCOL_VERSION
    && body.attachments !== undefined
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Runtime protocol v1 does not support attachments.",
    );
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
  const workspaceId =
    body.workspace_id === undefined || body.workspace_id === null
      ? null
      : requireUuid(body.workspace_id, "workspace_id");
  const expectedWorkspaceRoot =
    body.expected_workspace_root === undefined
      || body.expected_workspace_root === null
      ? null
      : requireNonblank(
          body.expected_workspace_root,
          "expected_workspace_root",
        );

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
    protocol_version: protocolVersion,
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
    workspace_id: workspaceId,
    expected_workspace_root: expectedWorkspaceRoot,
    execution_selection:
      body.execution_selection === undefined
        || body.execution_selection === null
        ? null
        : parseExecutionSelection(
            body.execution_selection,
          ),
    ...(protocolVersion >= NATIVE_LIVE_RUNTIME_ATTACHMENT_PROTOCOL_VERSION
      ? {
          attachments:
            body.attachments === undefined
              ? []
              : parseRuntimeAttachments(body.attachments),
        }
      : {}),
    prompt: normalizePrompt(body.prompt),
  };
}

export function parseNativeLiveRuntimeExecutionResult(
  value: unknown,
): NativeLiveRuntimeExecutionResult {
  const body = requireRecord(value);
  const status = body.status;

  if (status === "success") {
    requireExactKeys(
      body,
      [
        "protocol_version",
        "prepare_id",
        "request_id",
        "conversation_id",
        "status",
        "provider_session_id",
        "normalized_events",
      ],
      [
        "runtime_metadata",
        "workspace_id",
        "effective_workspace_root",
        "output_attachment_ids",
      ],
    );

    const protocolVersion = parseProtocolVersion(
      body.protocol_version,
    );
    if (!Array.isArray(body.normalized_events)) {
      throw new NativeLiveRuntimeProtocolError("normalized_events must be an array.");
    }
    if (
      body.output_attachment_ids !== undefined
      && protocolVersion !== NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION
    ) {
      throw new NativeLiveRuntimeProtocolError(
        "output_attachment_ids require runtime protocol v3.",
      );
    }

    return {
      protocol_version: protocolVersion,
      prepare_id: requireUuid(body.prepare_id, "prepare_id"),
      request_id: requireUuid(body.request_id, "request_id"),
      conversation_id: requireUuid(body.conversation_id, "conversation_id"),
      status,
      provider_session_id: requireNonblank(
        body.provider_session_id,
        "provider_session_id",
      ),
      workspace_id:
        body.workspace_id === undefined || body.workspace_id === null
          ? null
          : requireUuid(body.workspace_id, "workspace_id"),
      effective_workspace_root:
        body.effective_workspace_root === undefined
          || body.effective_workspace_root === null
          ? null
          : requireNonblank(
              body.effective_workspace_root,
              "effective_workspace_root",
            ),
      normalized_events:
        body.normalized_events as NativeLiveNormalizedEvent[],
      ...(body.output_attachment_ids === undefined
        ? {}
        : {
            output_attachment_ids:
              parseRuntimeOutputAttachmentIds(
                body.output_attachment_ids,
              ),
          }),
      ...(
        body.runtime_metadata === undefined
          ? {}
          : {
              runtime_metadata:
                body.runtime_metadata === null
                  ? null
                  : parseRuntimeMetadata(body.runtime_metadata),
            }
      ),
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

    const protocolVersion = parseProtocolVersion(
      body.protocol_version,
    );
    if (!isFailureCode(body.error_code)) {
      throw new NativeLiveRuntimeProtocolError("Runtime failure code is invalid.");
    }

    return {
      protocol_version: protocolVersion,
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
  if (result.protocol_version !== command.protocol_version) {
    throw new NativeLiveRuntimeProtocolError(
      "Runtime result protocol version does not match the command.",
    );
  }
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
    && command.workspace_id !== null
    && (
      result.workspace_id !== command.workspace_id
      || result.effective_workspace_root === null
    )
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Runtime result workspace does not match the prepared command.",
    );
  }

  if (
    result.status === "success"
    && command.expected_workspace_root !== null
    && result.effective_workspace_root !== command.expected_workspace_root
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Runtime result workspace root does not match the prepared command.",
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

function parseProtocolVersion(
  value: unknown,
): 1 | 2 | 3 {
  if (
    value !== NATIVE_LIVE_RUNTIME_LEGACY_PROTOCOL_VERSION
    && value !== NATIVE_LIVE_RUNTIME_ATTACHMENT_PROTOCOL_VERSION
    && value !== NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Unsupported runtime protocol version.",
    );
  }
  return value;
}

function parseRuntimeOutputAttachmentIds(
  value: unknown,
): string[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new NativeLiveRuntimeProtocolError(
      "output_attachment_ids must contain at most 8 items.",
    );
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const id = requireUuid(
      item,
      "output_attachment_ids[" + index + "]",
    );
    if (seen.has(id)) {
      throw new NativeLiveRuntimeProtocolError(
        "output_attachment_ids must not contain duplicates.",
      );
    }
    seen.add(id);
    return id;
  });
}

function parseRuntimeAttachments(
  value: unknown,
): NativeLiveRuntimeAttachment[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new NativeLiveRuntimeProtocolError(
      "attachments must be an array containing at most 8 items.",
    );
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const body = requireRecord(item);
    requireExactKeys(body, [
      "attachment_id",
      "filename",
      "mime_type",
      "size_bytes",
      "sha256",
      "kind",
    ]);
    const attachmentId = requireUuid(
      body.attachment_id,
      "attachments[" + index + "].attachment_id",
    );
    if (seen.has(attachmentId)) {
      throw new NativeLiveRuntimeProtocolError(
        "attachments must not contain duplicate ids.",
      );
    }
    seen.add(attachmentId);
    const filename = requireNonblank(
      body.filename,
      "attachments[" + index + "].filename",
    );
    const mimeType = requireNonblank(
      body.mime_type,
      "attachments[" + index + "].mime_type",
    );
    if (
      typeof body.size_bytes !== "number"
      || !Number.isSafeInteger(body.size_bytes)
      || body.size_bytes <= 0
    ) {
      throw new NativeLiveRuntimeProtocolError(
        "attachment size_bytes must be a positive safe integer.",
      );
    }
    if (
      typeof body.sha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(body.sha256)
    ) {
      throw new NativeLiveRuntimeProtocolError(
        "attachment sha256 must be lowercase hex.",
      );
    }
    if (body.kind !== "image" && body.kind !== "file") {
      throw new NativeLiveRuntimeProtocolError(
        "attachment kind must be image or file.",
      );
    }
    return {
      attachment_id: attachmentId,
      filename,
      mime_type: mimeType,
      size_bytes: body.size_bytes,
      sha256: body.sha256,
      kind: body.kind,
    };
  });
}

function parseRuntimeMetadata(
  value: unknown,
): NativeLiveRuntimeMetadata {
  const body = requireRecord(value);
  requireExactKeys(
    body,
    ["context_usage"],
    ["execution"],
  );

  return {
    context_usage:
      body.context_usage === null
        ? null
        : parseContextUsage(body.context_usage),
    ...(body.execution === undefined
      ? {}
      : {
          execution:
            body.execution === null
              ? null
              : parseExecutionMetadata(body.execution),
        }),
  };
}

function parseExecutionMetadata(
  value: unknown,
): NativeLiveRuntimeExecutionMetadata {
  const body = requireRecord(value);
  requireExactKeys(body, ["readback", "readback_error"]);
  const readbackError = body.readback_error;
  if (
    readbackError !== null
    && readbackError !== "READBACK_UNAVAILABLE"
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "execution.readback_error is invalid.",
    );
  }
  return {
    readback: parseExecutionReadback(body.readback),
    readback_error: readbackError,
  };
}

function parseExecutionReadback(
  value: unknown,
): NativeLiveRuntimeExecutionReadback {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "requested",
    "applied",
    "capability",
  ]);

  const applied = requireRecord(body.applied);
  requireExactKeys(applied, ["model", "effort"]);

  let requested:
    NativeLiveRuntimeExecutionReadback["requested"] = null;
  if (body.requested !== null) {
    const record = requireRecord(body.requested);
    requireExactKeys(record, ["model", "thinking", "effort"]);
    requested = {
      model: nullableString(
        record.model,
        "execution.readback.requested.model",
      ),
      thinking: nullableString(
        record.thinking,
        "execution.readback.requested.thinking",
      ),
      effort: nullableString(
        record.effort,
        "execution.readback.requested.effort",
      ),
    };
  }

  return {
    requested,
    applied: {
      model: nullableString(
        applied.model,
        "execution.readback.applied.model",
      ),
      effort: nullableString(
        applied.effort,
        "execution.readback.applied.effort",
      ),
    },
    capability:
      body.capability === null
        ? null
        : parseExecutionCapability(body.capability),
  };
}

function parseExecutionCapability(
  value: unknown,
): NativeLiveRuntimeExecutionCapability {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "value",
    "display_name",
    "description",
    "supports_effort",
    "supported_effort_levels",
    "supports_adaptive_thinking",
    "supports_fast_mode",
    "supports_auto_mode",
  ]);
  if (!Array.isArray(body.supported_effort_levels)) {
    throw new NativeLiveRuntimeProtocolError(
      "execution capability effort levels must be an array.",
    );
  }
  const supportedEffortLevels =
    body.supported_effort_levels.map((level, index) => {
      if (typeof level !== "string") {
        throw new NativeLiveRuntimeProtocolError(
          `execution capability effort level ${index} must be a string.`,
        );
      }
      return level;
    });

  return {
    value: nullableString(
      body.value,
      "execution.readback.capability.value",
    ),
    display_name: nullableString(
      body.display_name,
      "execution.readback.capability.display_name",
    ),
    description: nullableString(
      body.description,
      "execution.readback.capability.description",
    ),
    supports_effort: nullableBoolean(
      body.supports_effort,
      "execution.readback.capability.supports_effort",
    ),
    supported_effort_levels: supportedEffortLevels,
    supports_adaptive_thinking: nullableBoolean(
      body.supports_adaptive_thinking,
      "execution.readback.capability.supports_adaptive_thinking",
    ),
    supports_fast_mode: nullableBoolean(
      body.supports_fast_mode,
      "execution.readback.capability.supports_fast_mode",
    ),
    supports_auto_mode: nullableBoolean(
      body.supports_auto_mode,
      "execution.readback.capability.supports_auto_mode",
    ),
  };
}

function nullableBoolean(
  value: unknown,
  field: string,
): boolean | null {
  if (value === null) return null;
  if (typeof value !== "boolean") {
    throw new NativeLiveRuntimeProtocolError(
      `${field} must be boolean or null.`,
    );
  }
  return value;
}

function parseContextUsage(
  value: unknown,
): NativeLiveRuntimeContextUsage {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "model",
    "total_tokens",
    "max_tokens",
    "raw_max_tokens",
    "percentage",
    "categories",
  ]);
  if (!Array.isArray(body.categories)) {
    throw new NativeLiveRuntimeProtocolError(
      "context_usage.categories must be an array.",
    );
  }
  return {
    model: nullableString(body.model, "context_usage.model"),
    total_tokens:
      nullableFiniteNumber(
        body.total_tokens,
        "context_usage.total_tokens",
      ),
    max_tokens:
      nullableFiniteNumber(
        body.max_tokens,
        "context_usage.max_tokens",
      ),
    raw_max_tokens:
      nullableFiniteNumber(
        body.raw_max_tokens,
        "context_usage.raw_max_tokens",
      ),
    percentage:
      nullableFiniteNumber(
        body.percentage,
        "context_usage.percentage",
      ),
    categories: body.categories.map(
      (category, index) =>
        parseContextUsageCategory(category, index),
    ),
  };
}

function parseContextUsageCategory(
  value: unknown,
  index: number,
): NativeLiveRuntimeContextUsageCategory {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "name",
    "tokens",
    "kind",
    "is_deferred",
  ]);
  const deferred = body.is_deferred;
  if (deferred !== null && typeof deferred !== "boolean") {
    throw new NativeLiveRuntimeProtocolError(
      `context_usage.categories[${index}].is_deferred must be boolean or null.`,
    );
  }
  return {
    name: nullableString(
      body.name,
      `context_usage.categories[${index}].name`,
    ),
    tokens: nullableFiniteNumber(
      body.tokens,
      `context_usage.categories[${index}].tokens`,
    ),
    kind: nullableString(
      body.kind,
      `context_usage.categories[${index}].kind`,
    ),
    is_deferred: deferred as boolean | null,
  };
}

function nullableFiniteNumber(
  value: unknown,
  field: string,
): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new NativeLiveRuntimeProtocolError(
      `${field} must be finite or null.`,
    );
  }
  return value;
}

function nullableString(
  value: unknown,
  field: string,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new NativeLiveRuntimeProtocolError(
      `${field} must be a string or null.`,
    );
  }
  return value;
}

function parseExecutionSelection(
  value: unknown,
): NativeLiveExecutionSelection {
  try {
    return parseNativeLiveExecutionSelection(value);
  } catch (error) {
    if (error instanceof NativeLiveExecutionSelectionError) {
      throw new NativeLiveRuntimeProtocolError(error.message);
    }
    throw error;
  }
}

function isFailureCode(value: unknown): value is NativeLiveRuntimeFailureCode {
  return (
    value === "CLAUDE_PROCESS_FAILED"
    || value === "MALFORMED_STREAM"
    || value === "ABORTED"
    || value === "INTERRUPTED"
    || value === "NO_PROVIDER_SESSION"
    || value === "PROVIDER_SESSION_CONFLICT"
    || value === "WORKSPACE_UNAVAILABLE"
    || value === "WORKSPACE_ROOT_MISMATCH"
    || value === "ATTACHMENT_UNAVAILABLE"
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
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowedKeys = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new NativeLiveRuntimeProtocolError(
        `Unexpected runtime protocol field: ${key}`,
      );
    }
  }
  for (const key of required) {
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
      "prompt must contain between 1 and 16000 characters.",
    );
  }
  return prompt;
}
