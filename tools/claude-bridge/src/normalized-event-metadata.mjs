import { boundedOutput, provenance } from "./output-contract.mjs";
const RESULT_TELEMETRY_JSON_MAX_CHARS = 64_000;
const RESULT_TELEMETRY_MAX_ERRORS = 16;
const RESULT_TELEMETRY_MAX_DENIALS = 64;

import {
  clippedString,
  finiteNonNegative,
  finiteNumber,
  isoTimestamp,
  safeString,
} from './normalized-event-values.mjs';

export function normalizeUserMessageAttribution(raw) {
  const primary =
    clippedString(raw?.user_message_uuid, 128);
  const ordered = [];
  const seen = new Set();

  const append = (value) => {
    const normalized = clippedString(value, 128);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    ordered.push(normalized);
  };

  if (Array.isArray(raw?.user_message_uuids)) {
    for (
      const value of raw.user_message_uuids.slice(0, 64)
    ) {
      append(value);
    }
  }
  append(primary);

  if (ordered.length === 0) return null;
  return {
    kind: "user_message_attribution",
    source_type: clippedString(raw?.type, 64),
    user_message_uuid: primary ?? ordered[0] ?? null,
    user_message_uuids: ordered,
  };
}

export function normalizeMessageProvenance(raw) {
  if (!raw || typeof raw !== "object") return null;

  const origin = boundedMessageOrigin(raw.origin);
  const parentToolUseId =
    clippedString(raw.parent_tool_use_id, 256);
  const parentAgentId =
    clippedString(raw.parent_agent_id, 256);

  if (!origin && !parentToolUseId && !parentAgentId) {
    return null;
  }

  return {
    origin,
    ...(parentToolUseId
      ? { parent_tool_use_id: parentToolUseId }
      : {}),
    ...(parentAgentId
      ? { parent_agent_id: parentAgentId }
      : {}),
  };
}

function boundedMessageOrigin(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return null;
  }

  const kind = clippedString(value.kind, 64);
  if (!kind) return null;

  const origin = { kind };
  const appendString = (key, rawValue, maxChars = 256) => {
    const normalized = clippedString(rawValue, maxChars);
    if (normalized) origin[key] = normalized;
  };

  appendString("subkind", value.subkind, 128);
  appendString("server", value.server, 256);
  appendString("from", value.from, 256);
  appendString("name", value.name, 256);
  appendString(
    "from_session",
    value.fromSession ?? value.from_session,
    256,
  );
  appendString(
    "from_mode",
    value.fromMode ?? value.from_mode,
    128,
  );
  appendString(
    "sender_task_id",
    value.senderTaskId ?? value.sender_task_id,
    256,
  );

  const verifiedPeerPid =
    value.verifiedPeerPid ?? value.verified_peer_pid;
  if (
    Number.isInteger(verifiedPeerPid)
    && verifiedPeerPid >= 0
  ) {
    origin.verified_peer_pid = verifiedPeerPid;
  }

  appendString(
    "fire_reason",
    value.fireReason ?? value.fire_reason,
    512,
  );

  return origin;
}

export function normalizeResultTelemetry(raw) {
  return {
    subtype: clippedString(raw?.subtype, 128),
    is_error:
      typeof raw?.is_error === "boolean"
        ? raw.is_error
        : null,
    duration_ms: finiteNonNegative(raw?.duration_ms),
    duration_api_ms:
      finiteNonNegative(raw?.duration_api_ms),
    num_turns: finiteNonNegative(raw?.num_turns),
    queued_turn_count:
      finiteNonNegative(raw?.queued_turn_count),
    stop_reason: clippedString(raw?.stop_reason, 128),
    terminal_reason:
      clippedString(raw?.terminal_reason, 128),
    api_error_status:
      finiteNonNegative(raw?.api_error_status),
    startup_failure_reason:
      clippedString(raw?.startup_failure_reason, 256),
    fast_mode_state:
      clippedString(raw?.fast_mode_state, 128),
    fast_mode_disabled_reason:
      clippedString(raw?.fast_mode_disabled_reason, 512),
    total_cost_usd:
      finiteNonNegative(raw?.total_cost_usd),
    origin: boundedMessageOrigin(raw?.origin),
    usage: boundedResultJsonRecord(raw?.usage),
    modelUsage:
      boundedResultJsonRecord(raw?.modelUsage),
    permission_denials:
      normalizePermissionDenials(raw?.permission_denials),
    errors: Array.isArray(raw?.errors)
      ? raw.errors
          .map((value) => clippedString(value, 2_000))
          .filter(Boolean)
          .slice(0, RESULT_TELEMETRY_MAX_ERRORS)
      : [],
    structured_output_present:
      raw?.structured_output !== undefined,
    ...(raw?.structured_output !== undefined ? {structured_output:{...boundedOutput(raw.structured_output), provenance:provenance(raw, "structured_output")}} : {}),
    deferred_tool_use_present:
      raw?.deferred_tool_use !== undefined,
    latency: {
      ttft_ms: finiteNonNegative(raw?.ttft_ms),
      ttft_stream_ms:
        finiteNonNegative(raw?.ttft_stream_ms),
      time_to_request_ms:
        finiteNonNegative(raw?.time_to_request_ms),
      time_to_request_from_spawn_ms:
        finiteNonNegative(
          raw?.time_to_request_from_spawn_ms,
        ),
      time_origin_ms:
        finiteNonNegative(raw?.time_origin_ms),
      warm_spare_claimed:
        typeof raw?.warm_spare_claimed === "boolean"
          ? raw.warm_spare_claimed
          : null,
      first_content_frame_ms:
        finiteNonNegative(raw?.first_content_frame_ms),
      first_stream_post_ms:
        finiteNonNegative(raw?.first_stream_post_ms),
      first_stream_post_ack_ms:
        finiteNonNegative(raw?.first_stream_post_ack_ms),
      first_stream_post_wall_ms:
        finiteNonNegative(raw?.first_stream_post_wall_ms),
      first_text_post_ms:
        finiteNonNegative(raw?.first_text_post_ms),
      first_text_post_wall_ms:
        finiteNonNegative(raw?.first_text_post_wall_ms),
      first_stream_post_queue_wait_ms:
        finiteNonNegative(
          raw?.first_stream_post_queue_wait_ms,
        ),
      first_stream_post_queued_behind:
        finiteNonNegative(
          raw?.first_stream_post_queued_behind,
        ),
    },
  };
}

function normalizePermissionDenials(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, RESULT_TELEMETRY_MAX_DENIALS)
    .map((item) => {
      const row =
        item
        && typeof item === "object"
        && !Array.isArray(item)
          ? item
          : {};
      return {
        tool_name: clippedString(row.tool_name, 256),
        tool_use_id: clippedString(row.tool_use_id, 256),
        tool_input:
          boundedResultJsonRecord(row.tool_input),
      };
    });
}

function boundedResultJsonRecord(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return null;
  }
  try {
    const serialized = JSON.stringify(value);
    if (
      typeof serialized !== "string"
      || serialized.length > RESULT_TELEMETRY_JSON_MAX_CHARS
    ) {
      return null;
    }
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

export function normalizeClaudeAccountUsage(value) {
  const info =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};

  const unifiedWindows =
    info.unifiedWindows ?? info.unified_windows ?? null;
  const windows = normalizeRateLimitWindows(unifiedWindows);

  const activeWindow =
    safeString(info.rateLimitType)
    ?? safeString(info.rate_limit_type);

  if (windows.length === 0 && activeWindow) {
    windows.push({
      kind: activeWindow,
      utilization: finiteNumber(
        info.utilization,
      ),
      resets_at: isoTimestamp(
        info.resetsAt ?? info.resets_at,
      ),
    });
  }

  const overageStatus =
    safeString(info.overageStatus)
    ?? safeString(info.overage_status);
  const overageResetsAt = isoTimestamp(
    info.overageResetsAt ?? info.overage_resets_at,
  );
  const overageDisabledReason =
    safeString(info.overageDisabledReason)
    ?? safeString(info.overage_disabled_reason);
  const overageIsUsing =
    typeof info.isUsingOverage === "boolean"
      ? info.isUsingOverage
      : typeof info.is_using_overage === "boolean"
        ? info.is_using_overage
        : null;

  return {
    kind: "claude_account_usage",
    provider: "claude_code",
    status: safeString(info.status),
    active_window: activeWindow,
    windows,
    overage:
      overageStatus
      || overageResetsAt
      || overageDisabledReason
      || overageIsUsing !== null
        ? {
            status: overageStatus,
            resets_at: overageResetsAt,
            disabled_reason: overageDisabledReason,
            is_using: overageIsUsing,
          }
        : null,
    surpassed_threshold: finiteNumber(
      info.surpassedThreshold
      ?? info.surpassed_threshold,
    ),
  };
}

function normalizeRateLimitWindows(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 32).flatMap((window) => {
      if (
        !window
        || typeof window !== "object"
        || Array.isArray(window)
      ) {
        return [];
      }
      const kind =
        safeString(window.kind)
        ?? safeString(window.type)
        ?? safeString(window.rateLimitType)
        ?? safeString(window.rate_limit_type);
      if (!kind) return [];
      return [{
        kind,
        utilization: finiteNumber(window.utilization),
        resets_at: isoTimestamp(
          window.resetsAt ?? window.resets_at,
        ),
      }];
    });
  }

  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return [];
  }

  return Object.entries(value)
    .slice(0, 32)
    .flatMap(([kind, window]) => {
      if (
        !window
        || typeof window !== "object"
        || Array.isArray(window)
      ) {
        return [];
      }
      return [{
        kind,
        utilization: finiteNumber(window.utilization),
        resets_at: isoTimestamp(
          window.resetsAt ?? window.resets_at,
        ),
      }];
    });
}

export function normalizeSystemInitEnvironment(raw) {
  return {
    model: clippedString(raw.model, 512),
    cwd: clippedString(raw.cwd, 2_048),
    tools: boundedStringArray(raw.tools, 256, 512),
    mcp_servers: boundedMcpServers(
      raw.mcp_servers ?? raw.mcpServers,
    ),
    permission_mode: clippedString(
      raw.permissionMode ?? raw.permission_mode,
      128,
    ),
    slash_commands: boundedStringArray(
      raw.slash_commands ?? raw.slashCommands,
      256,
      512,
    ),
    terminal_slash_commands: boundedStringArray(
      raw.terminal_slash_commands ?? raw.terminalSlashCommands,
      256,
      512,
    ),
    api_key_source: clippedString(
      raw.apiKeySource ?? raw.api_key_source,
      128,
    ),
    output_style: clippedString(
      raw.output_style ?? raw.outputStyle,
      128,
    ),
    agents: boundedStringArray(raw.agents, 128, 512),
    betas: boundedStringArray(raw.betas, 64, 256),
    claude_code_version: clippedString(
      raw.claude_code_version ?? raw.claudeCodeVersion,
      128,
    ),
    sdk_version: clippedString(
      raw.sdk_version ?? raw.sdkVersion,
      128,
    ),
    skills: boundedStringArray(raw.skills, 128, 512),
    plugins: boundedPlugins(raw.plugins),
    plugin_errors: boundedPluginErrors(
      raw.plugin_errors ?? raw.pluginErrors,
    ),
    effort: clippedString(raw.effort, 64),
    capabilities: boundedStringArray(
      raw.capabilities,
      128,
      256,
    ),
    fast_mode: normalizedFastMode(
      raw.fast_mode_state
      ?? raw.fastModeState
      ?? raw.fast_mode
      ?? raw.fastMode,
      raw.fast_mode_disabled_reason
      ?? raw.fastModeDisabledReason,
    ),
  };
}

function boundedStringArray(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).flatMap((item) => {
    const normalized = clippedString(item, maxChars);
    return normalized ? [normalized] : [];
  });
}

function boundedMcpServers(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 64).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const name = firstClipped(
      item,
      ["name", "server_name", "serverName"],
      256,
    );
    const status = firstClipped(item, ["status", "state"], 256);
    const source = firstClipped(item, ["source"], 512);
    if (!name && !status && !source) return [];
    return [{ name, status, source }];
  });
}

function boundedPlugins(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 128).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const name = firstClipped(item, ["name", "plugin_name", "pluginName"], 512);
    const path = firstClipped(item, ["path"], 2_048);
    if (!name && !path) return [];
    return [{ name, path }];
  });
}

function boundedPluginErrors(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 64).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const plugin = firstClipped(
      item,
      ["plugin", "name", "plugin_name", "pluginName"],
      512,
    );
    const type = firstClipped(item, ["type"], 256);
    const path = firstClipped(item, ["path"], 2_048);
    const message = firstClipped(
      item,
      ["message", "error", "reason"],
      2_000,
    );
    if (!plugin && !type && !path && !message) return [];
    return [{ plugin, type, message, path }];
  });
}

function normalizedFastMode(value, disabledReasonValue) {
  let state = null;
  if (typeof value === "string") {
    state = clippedString(value, 128);
  } else if (typeof value === "boolean") {
    state = value ? "on" : "off";
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    state = firstClipped(value, ["state", "status"], 128);
    if (!state && typeof value.enabled === "boolean") {
      state = value.enabled ? "on" : "off";
    }
  }
  const disabledReason = clippedString(disabledReasonValue, 512);
  return !state && !disabledReason
    ? null
    : { state, disabled_reason: disabledReason };
}

function firstClipped(value, keys, maxChars) {
  for (const key of keys) {
    const found = clippedString(value?.[key], maxChars);
    if (found) return found;
  }
  return null;
}

export function normalizedTaskUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return {
    total_tokens:
      Number.isFinite(value.total_tokens) && value.total_tokens >= 0
        ? value.total_tokens
        : null,
    tool_uses:
      Number.isFinite(value.tool_uses) && value.tool_uses >= 0
        ? value.tool_uses
        : null,
    duration_ms:
      Number.isFinite(value.duration_ms) && value.duration_ms >= 0
        ? value.duration_ms
        : null,
  };
}
