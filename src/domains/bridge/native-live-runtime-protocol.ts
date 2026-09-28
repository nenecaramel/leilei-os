import type { NativeLiveNormalizedEvent } from "../conversation/native-live-conversation-orchestrator.js";
import {
  NativeLiveExecutionSelectionError,
  parseNativeLiveExecutionSelection,
  type NativeLiveExecutionSelection,
} from "./native-live-execution-selection.js";

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
  workspace_id: string | null;
  expected_workspace_root: string | null;
  execution_selection?: NativeLiveExecutionSelection | null;
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

export type NativeLiveRuntimeCompactionAdvisory = {
  due: boolean;
  threshold_percent: number;
  observed_percent: number | null;
  reason:
    | "context_usage_unavailable"
    | "turn_boundary_threshold_reached"
    | "below_threshold";
};

export type NativeLiveRuntimeCompactionMetadata = {
  source: "runtime_threshold";
  attempted: boolean;
  outcome: "not_due" | "succeeded" | "failed" | "unsupported";
  boundary: Record<string, unknown> | null;
  summary: string | null;
  failure_code: "COMPACT_FAILED" | "COMPACT_UNSUPPORTED" | null;
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
  compaction_advisory: NativeLiveRuntimeCompactionAdvisory | null;
  compaction: NativeLiveRuntimeCompactionMetadata | null;
  execution?: NativeLiveRuntimeExecutionMetadata | null;
};

export type NativeLiveRuntimeExecutionResult =
  | {
      protocol_version: 1;
      prepare_id: string;
      request_id: string;
      conversation_id: string;
      status: "success";
      provider_session_id: string;
      workspace_id: string | null;
      effective_workspace_root: string;
      normalized_events: NativeLiveNormalizedEvent[];
      runtime_metadata?: NativeLiveRuntimeMetadata | null;
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
    "workspace_id",
    "expected_workspace_root",
    "prompt",
  ], ["execution_selection"]);

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
  const workspaceId =
    body.workspace_id === null
      ? null
      : requireUuid(body.workspace_id, "workspace_id");
  const expectedWorkspaceRoot =
    body.expected_workspace_root === null
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
    workspace_id: workspaceId,
    expected_workspace_root: expectedWorkspaceRoot,
    execution_selection:
      body.execution_selection === undefined
        || body.execution_selection === null
        ? null
        : parseExecutionSelection(
            body.execution_selection,
          ),
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
        "workspace_id",
        "effective_workspace_root",
        "normalized_events",
      ],
      ["runtime_metadata"],
    );

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
      workspace_id:
        body.workspace_id === null
          ? null
          : requireUuid(body.workspace_id, "workspace_id"),
      effective_workspace_root: requireNonblank(
        body.effective_workspace_root,
        "effective_workspace_root",
      ),
      normalized_events:
        body.normalized_events as NativeLiveNormalizedEvent[],
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
    && result.workspace_id !== command.workspace_id
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

function parseRuntimeMetadata(
  value: unknown,
): NativeLiveRuntimeMetadata {
  const body = requireRecord(value);
  requireExactKeys(
    body,
    [
      "context_usage",
      "compaction_advisory",
      "compaction",
    ],
    ["execution"],
  );

  return {
    context_usage:
      body.context_usage === null
        ? null
        : parseContextUsage(body.context_usage),
    compaction_advisory:
      body.compaction_advisory === null
        ? null
        : parseCompactionAdvisory(body.compaction_advisory),
    compaction:
      body.compaction === null
        ? null
        : parseCompactionMetadata(body.compaction),
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

function parseCompactionAdvisory(
  value: unknown,
): NativeLiveRuntimeCompactionAdvisory {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "due",
    "threshold_percent",
    "observed_percent",
    "reason",
  ]);
  if (typeof body.due !== "boolean") {
    throw new NativeLiveRuntimeProtocolError(
      "compaction_advisory.due must be boolean.",
    );
  }
  const threshold = nullableFiniteNumber(
    body.threshold_percent,
    "compaction_advisory.threshold_percent",
  );
  if (threshold === null || threshold < 0 || threshold > 100) {
    throw new NativeLiveRuntimeProtocolError(
      "compaction_advisory.threshold_percent is invalid.",
    );
  }
  const observed = nullableFiniteNumber(
    body.observed_percent,
    "compaction_advisory.observed_percent",
  );
  if (observed !== null && (observed < 0 || observed > 100)) {
    throw new NativeLiveRuntimeProtocolError(
      "compaction_advisory.observed_percent is invalid.",
    );
  }
  const reason = body.reason;
  if (
    reason !== "context_usage_unavailable"
    && reason !== "turn_boundary_threshold_reached"
    && reason !== "below_threshold"
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "compaction_advisory.reason is invalid.",
    );
  }
  return {
    due: body.due,
    threshold_percent: threshold,
    observed_percent: observed,
    reason,
  };
}

function parseCompactionMetadata(
  value: unknown,
): NativeLiveRuntimeCompactionMetadata {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "source",
    "attempted",
    "outcome",
    "boundary",
    "summary",
    "failure_code",
  ]);
  if (body.source !== "runtime_threshold") {
    throw new NativeLiveRuntimeProtocolError(
      "compaction.source is invalid.",
    );
  }
  if (typeof body.attempted !== "boolean") {
    throw new NativeLiveRuntimeProtocolError(
      "compaction.attempted must be boolean.",
    );
  }
  if (
    body.outcome !== "not_due"
    && body.outcome !== "succeeded"
    && body.outcome !== "failed"
    && body.outcome !== "unsupported"
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "compaction.outcome is invalid.",
    );
  }
  const boundary =
    body.boundary === null
      ? null
      : requireRecord(body.boundary);
  const summary = nullableString(
    body.summary,
    "compaction.summary",
  );
  const failureCode = body.failure_code;
  if (
    failureCode !== null
    && failureCode !== "COMPACT_FAILED"
    && failureCode !== "COMPACT_UNSUPPORTED"
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "compaction.failure_code is invalid.",
    );
  }
  return {
    source: "runtime_threshold",
    attempted: body.attempted,
    outcome: body.outcome,
    boundary,
    summary,
    failure_code: failureCode,
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
