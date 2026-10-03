import { boundCanonicalPayload } from '../../../conversation/native-live-content-contract.js';
import type {
  NativeLiveRuntimeResultTelemetry,
  NativeLiveRuntimeResultPermissionDenial,
  NativeLiveRuntimeResultLatency,
  NativeLiveRuntimeExecutionMetadata,
  NativeLiveRuntimeExecutionReadback,
  NativeLiveRuntimeExecutionCapability,
  NativeLiveRuntimeContextUsage,
  NativeLiveRuntimeContextUsageCategory,
} from "./types.js";
import {
  requireRecord,
  requireExactKeys,
  NativeLiveRuntimeProtocolError,
  boundedNullableString,
  nullableFiniteNumber,
  parseBoundedJsonRecord,
  boundedStringList,
  nullableString,
} from "./parsing.js";

export function parseNativeLiveRuntimeResultTelemetry(
  value: unknown,
): NativeLiveRuntimeResultTelemetry {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "subtype",
    "is_error",
    "duration_ms",
    "duration_api_ms",
    "num_turns",
    "queued_turn_count",
    "stop_reason",
    "terminal_reason",
    "api_error_status",
    "startup_failure_reason",
    "fast_mode_state",
    "fast_mode_disabled_reason",
    "total_cost_usd",
    "origin",
    "usage",
    "modelUsage",
    "permission_denials",
    "errors",
    "structured_output_present",
    "deferred_tool_use_present",
    "latency",
  ], ["structured_output"]);

  if (
    !Array.isArray(body.permission_denials)
    || body.permission_denials.length > 64
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "result.permission_denials must contain at most 64 items.",
    );
  }
  if (!Array.isArray(body.errors) || body.errors.length > 16) {
    throw new NativeLiveRuntimeProtocolError(
      "result.errors must contain at most 16 strings.",
    );
  }
  if (typeof body.structured_output_present !== "boolean") {
    throw new NativeLiveRuntimeProtocolError(
      "result.structured_output_present must be boolean.",
    );
  }
  if (typeof body.deferred_tool_use_present !== "boolean") {
    throw new NativeLiveRuntimeProtocolError(
      "result.deferred_tool_use_present must be boolean.",
    );
  }

  return {
    subtype: boundedNullableString(
      body.subtype,
      "result.subtype",
      128,
    ),
    is_error: nullableBoolean(
      body.is_error,
      "result.is_error",
    ),
    duration_ms: nullableFiniteNumber(
      body.duration_ms,
      "result.duration_ms",
    ),
    duration_api_ms: nullableFiniteNumber(
      body.duration_api_ms,
      "result.duration_api_ms",
    ),
    num_turns: nullableFiniteNumber(
      body.num_turns,
      "result.num_turns",
    ),
    queued_turn_count: nullableFiniteNumber(
      body.queued_turn_count,
      "result.queued_turn_count",
    ),
    stop_reason: boundedNullableString(
      body.stop_reason,
      "result.stop_reason",
      128,
    ),
    terminal_reason: boundedNullableString(
      body.terminal_reason,
      "result.terminal_reason",
      128,
    ),
    api_error_status: nullableFiniteNumber(
      body.api_error_status,
      "result.api_error_status",
    ),
    startup_failure_reason: boundedNullableString(
      body.startup_failure_reason,
      "result.startup_failure_reason",
      256,
    ),
    fast_mode_state: boundedNullableString(
      body.fast_mode_state,
      "result.fast_mode_state",
      128,
    ),
    fast_mode_disabled_reason: boundedNullableString(
      body.fast_mode_disabled_reason,
      "result.fast_mode_disabled_reason",
      512,
    ),
    total_cost_usd: nullableFiniteNumber(
      body.total_cost_usd,
      "result.total_cost_usd",
    ),
    origin: parseBoundedJsonRecord(
      body.origin,
      "result.origin",
      16_000,
    ),
    usage: parseBoundedJsonRecord(
      body.usage,
      "result.usage",
      64_000,
    ),
    modelUsage: parseBoundedJsonRecord(
      body.modelUsage,
      "result.modelUsage",
      64_000,
    ),
    permission_denials: body.permission_denials.map(
      (item, index) =>
        parseResultPermissionDenial(item, index),
    ),
    errors: boundedStringList(
      body.errors,
      "result.errors",
      16,
      2_000,
    ),
    structured_output_present:
      body.structured_output_present,
    ...(body.structured_output === undefined ? {} : {structured_output:parseStructuredOutput(body.structured_output)}),
    deferred_tool_use_present:
      body.deferred_tool_use_present,
    latency: parseResultLatency(body.latency),
  };
}

function parseResultPermissionDenial(
  value: unknown,
  index: number,
): NativeLiveRuntimeResultPermissionDenial {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "tool_name",
    "tool_use_id",
    "tool_input",
  ]);
  return {
    tool_name: boundedNullableString(
      body.tool_name,
      `result.permission_denials[${index}].tool_name`,
      256,
    ),
    tool_use_id: boundedNullableString(
      body.tool_use_id,
      `result.permission_denials[${index}].tool_use_id`,
      256,
    ),
    tool_input: parseBoundedJsonRecord(
      body.tool_input,
      `result.permission_denials[${index}].tool_input`,
      16_000,
    ),
  };
}

function parseResultLatency(
  value: unknown,
): NativeLiveRuntimeResultLatency {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "ttft_ms",
    "ttft_stream_ms",
    "time_to_request_ms",
    "time_to_request_from_spawn_ms",
    "time_origin_ms",
    "warm_spare_claimed",
    "first_content_frame_ms",
    "first_stream_post_ms",
    "first_stream_post_ack_ms",
    "first_stream_post_wall_ms",
    "first_text_post_ms",
    "first_text_post_wall_ms",
    "first_stream_post_queue_wait_ms",
    "first_stream_post_queued_behind",
  ]);
  return {
    ttft_ms: nullableFiniteNumber(
      body.ttft_ms,
      "result.latency.ttft_ms",
    ),
    ttft_stream_ms: nullableFiniteNumber(
      body.ttft_stream_ms,
      "result.latency.ttft_stream_ms",
    ),
    time_to_request_ms: nullableFiniteNumber(
      body.time_to_request_ms,
      "result.latency.time_to_request_ms",
    ),
    time_to_request_from_spawn_ms: nullableFiniteNumber(
      body.time_to_request_from_spawn_ms,
      "result.latency.time_to_request_from_spawn_ms",
    ),
    time_origin_ms: nullableFiniteNumber(
      body.time_origin_ms,
      "result.latency.time_origin_ms",
    ),
    warm_spare_claimed: nullableBoolean(
      body.warm_spare_claimed,
      "result.latency.warm_spare_claimed",
    ),
    first_content_frame_ms: nullableFiniteNumber(
      body.first_content_frame_ms,
      "result.latency.first_content_frame_ms",
    ),
    first_stream_post_ms: nullableFiniteNumber(
      body.first_stream_post_ms,
      "result.latency.first_stream_post_ms",
    ),
    first_stream_post_ack_ms: nullableFiniteNumber(
      body.first_stream_post_ack_ms,
      "result.latency.first_stream_post_ack_ms",
    ),
    first_stream_post_wall_ms: nullableFiniteNumber(
      body.first_stream_post_wall_ms,
      "result.latency.first_stream_post_wall_ms",
    ),
    first_text_post_ms: nullableFiniteNumber(
      body.first_text_post_ms,
      "result.latency.first_text_post_ms",
    ),
    first_text_post_wall_ms: nullableFiniteNumber(
      body.first_text_post_wall_ms,
      "result.latency.first_text_post_wall_ms",
    ),
    first_stream_post_queue_wait_ms: nullableFiniteNumber(
      body.first_stream_post_queue_wait_ms,
      "result.latency.first_stream_post_queue_wait_ms",
    ),
    first_stream_post_queued_behind: nullableFiniteNumber(
      body.first_stream_post_queued_behind,
      "result.latency.first_stream_post_queued_behind",
    ),
  };
}

export function parseExecutionMetadata(
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

export function parseContextUsage(
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

function parseStructuredOutput(value: unknown): Record<string, unknown> | null {
  const raw = parseBoundedJsonRecord(value, "result.structured_output", 64_000);
  if (raw === null) return null;
  const bounded = boundCanonicalPayload(raw);
  return { ...(bounded.compatibility_payload as Record<string, unknown>), truncated:raw.truncated === true || bounded.truncated === true };
}
