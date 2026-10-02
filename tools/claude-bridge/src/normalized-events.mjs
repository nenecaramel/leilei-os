import { randomUUID } from "node:crypto";

export class ClaudeEventNormalizer {
  constructor({
    logicalConversationId,
    mode,
    parentProviderSessionId = null,
    createId = randomUUID,
    now = () => new Date().toISOString(),
  }) {
    this.logicalConversationId = logicalConversationId;
    this.mode = mode;
    this.parentProviderSessionId = parentProviderSessionId;
    this.createId = createId;
    this.now = now;
    this.sessionId = null;
    this.sequence = 0;
    this.accumulated = "";
  }

  normalize(raw) {
    const output = [];
    const emit = (type, providerSessionId, payload) => {
      output.push({
        event_id: this.createId(),
        type,
        sequence: ++this.sequence,
        logical_conversation_id: this.logicalConversationId,
        provider_session_id: providerSessionId ?? this.sessionId,
        timestamp: this.now(),
        payload,
        raw_metadata: {
          raw_event_type: raw.type ?? null,
          raw_event_subtype: raw.subtype ?? null,
        },
      });
    };

    if (raw.session_id && this.sessionId && raw.session_id !== this.sessionId) {
      emit("error", this.sessionId, {
        code: "CONFLICTING_SESSION_ID",
        message: "Claude stream contained conflicting session ids.",
        stderr: null,
        exit_code: null,
      });
      return output;
    }

    if (raw.session_id) this.sessionId = raw.session_id;

    const attribution =
      normalizeUserMessageAttribution(raw);
    if (attribution) {
      emit("runtime", this.sessionId, attribution);
    }

    if (raw.type === "command_lifecycle") {
      emit("runtime", this.sessionId, {
        kind: "command_lifecycle",
        command_uuid:
          clippedString(raw.command_uuid, 128),
        state: clippedString(raw.state, 64),
        event_uuid: clippedString(raw.uuid, 128),
      });
      return output;
    }

    if (raw.type === "system" && raw.subtype === "init") {
      emit("session", this.sessionId, {
        provider_session_id: this.sessionId,
        parent_provider_session_id: this.parentProviderSessionId,
        mode: this.mode,
        environment: normalizeSystemInitEnvironment(raw),
      });
      return output;
    }

    if (raw.type === "system" && raw.subtype === "compact_boundary") {
      const metadata =
        raw.compact_metadata && typeof raw.compact_metadata === "object"
          ? raw.compact_metadata
          : {};
      emit("compaction", this.sessionId, {
        trigger:
          metadata.trigger === "manual" || metadata.trigger === "auto"
            ? metadata.trigger
            : null,
        pre_tokens:
          Number.isFinite(metadata.pre_tokens) ? metadata.pre_tokens : null,
        post_tokens:
          Number.isFinite(metadata.post_tokens) ? metadata.post_tokens : null,
        duration_ms:
          Number.isFinite(metadata.duration_ms) ? metadata.duration_ms : null,
        preserved_segment:
          metadata.preserved_segment
          && typeof metadata.preserved_segment === "object"
            ? metadata.preserved_segment
            : null,
      });
      return output;
    }

    if (raw.type === "system" && raw.subtype === "task_started") {
      emit("task", this.sessionId, {
        phase: "started",
        task_id: safeString(raw.task_id),
        tool_use_id: safeString(raw.tool_use_id),
        description: clippedString(raw.description, 2_000),
        subagent_type: safeString(raw.subagent_type),
        task_type: safeString(raw.task_type),
        workflow_name: safeString(raw.workflow_name),
        hidden_from_transcript: raw.skip_transcript === true,
        ambient: raw.ambient === true,
      });
      return output;
    }

    if (raw.type === "system" && raw.subtype === "task_progress") {
      emit("task", this.sessionId, {
        phase: "progress",
        task_id: safeString(raw.task_id),
        tool_use_id: safeString(raw.tool_use_id),
        description: clippedString(raw.description, 2_000),
        subagent_type: safeString(raw.subagent_type),
        usage: normalizedTaskUsage(raw.usage),
        last_tool_name: safeString(raw.last_tool_name),
        summary: clippedString(raw.summary, 4_000),
      });
      return output;
    }

    if (raw.type === "system" && raw.subtype === "task_updated") {
      const patch =
        raw.patch && typeof raw.patch === "object" && !Array.isArray(raw.patch)
          ? raw.patch
          : {};
      emit("task", this.sessionId, {
        phase: "updated",
        task_id: safeString(raw.task_id),
        patch: {
          status: safeString(patch.status),
          description: clippedString(patch.description, 2_000),
          end_time:
            Number.isFinite(patch.end_time) ? patch.end_time : null,
          total_paused_ms:
            Number.isFinite(patch.total_paused_ms)
              ? patch.total_paused_ms
              : null,
          is_backgrounded:
            typeof patch.is_backgrounded === "boolean"
              ? patch.is_backgrounded
              : null,
          has_error:
            typeof patch.error === "string" && patch.error.length > 0,
        },
      });
      return output;
    }

    if (raw.type === "system" && raw.subtype === "task_notification") {
      emit("task", this.sessionId, {
        phase: "notification",
        task_id: safeString(raw.task_id),
        tool_use_id: safeString(raw.tool_use_id),
        status: safeString(raw.status),
        summary: clippedString(raw.summary, 4_000),
        usage: normalizedTaskUsage(raw.usage),
        hidden_from_transcript: raw.skip_transcript === true,
        ambient: raw.ambient === true,
        has_output_file:
          typeof raw.output_file === "string" && raw.output_file.length > 0,
      });
      return output;
    }

    if (
      raw.type === "system"
      && raw.subtype === "background_tasks_changed"
    ) {
      const tasks = Array.isArray(raw.tasks)
        ? raw.tasks.slice(0, 64).map((task) => ({
            task_id: safeString(task?.task_id),
            task_type: safeString(task?.task_type),
            description: clippedString(task?.description, 2_000),
            ambient: task?.ambient === true,
          }))
        : [];
      emit("task", this.sessionId, {
        phase: "active_set",
        replace: true,
        tasks,
      });
      return output;
    }

    if (
      raw.type === "system"
      && raw.subtype === "session_state_changed"
    ) {
      emit("runtime", this.sessionId, {
        kind: "session_state_changed",
        state: clippedString(raw.state, 64),
        event_uuid: clippedString(raw.uuid, 128),
      });
      return output;
    }

    if (
      (raw.type === "system" && raw.subtype === "api_retry")
      || raw.type === "api_retry"
    ) {
      emit("runtime", this.sessionId, {
        kind: "api_retry",
        attempt: finiteNonNegative(raw.attempt),
        max_retries: finiteNonNegative(raw.max_retries),
        retry_delay_ms: finiteNonNegative(raw.retry_delay_ms),
        error_status: finiteNonNegative(raw.error_status),
        error: clippedString(raw.error, 256),
        no_response:
          typeof raw.no_response === "boolean"
            ? raw.no_response
            : null,
      });
      return output;
    }

    if (
      raw.type === "system"
      && (
        raw.subtype === "informational"
        || raw.subtype === "warning"
        || raw.subtype === "notice"
      )
    ) {
      emit("runtime", this.sessionId, {
        kind: "provider_notice",
        level:
          clippedString(raw.level, 64)
          ?? (
            raw.subtype === "informational"
              ? null
              : raw.subtype
          ),
        content:
          clippedString(raw.content, 4_000)
          ?? clippedString(raw.message, 4_000),
        title: clippedString(raw.title, 256),
        code: clippedString(raw.code, 128),
        source: clippedString(raw.source, 128),
      });
      return output;
    }

    if (raw.type === "stream_event") {
      const event = raw.event;
      if (
        event?.type === "content_block_delta"
        && event.delta?.type === "text_delta"
        && typeof event.delta.text === "string"
        && event.delta.text.length > 0
      ) {
        this.accumulated += event.delta.text;
        emit("partial_text", this.sessionId, {
          delta: event.delta.text,
          accumulated_length:
            this.accumulated.length,
        });
      }
      return output;
    }

    if (raw.type === "assistant") {
      if (raw.delta?.text) {
        this.accumulated += raw.delta.text;
        emit("partial_text", this.sessionId, {
          delta: raw.delta.text,
          accumulated_length: this.accumulated.length,
        });
      }

      for (const block of raw.message?.content ?? []) {
        if (block.type === "text") {
          emit("text", this.sessionId, {
            role: "assistant",
            text: block.text,
            final: false,
          });
        }
        if (block.type === "tool_use") {
          const displayMeta = normalizedToolUseMeta(
            raw.tool_use_meta ?? raw.message?.tool_use_meta,
            block.id,
          );
          emit("tool_use", this.sessionId, {
            tool_use_id: block.id,
            tool_name: block.name,
            input: block.input,
            ...(displayMeta ?? {}),
          });
        }
        if (block.type === "tool_result") {
          emit(
            "tool_result",
            this.sessionId,
            normalizeToolResultPayload(block),
          );
        }
      }
      return output;
    }

    if (raw.type === "user") {
      let emittedToolResult = false;
      for (const block of raw.message?.content ?? []) {
        if (block.type === "tool_result") {
          emittedToolResult = true;
          emit(
            "tool_result",
            this.sessionId,
            normalizeToolResultPayload(block),
          );
        }
      }
      if (emittedToolResult) return output;
    }

    if (raw.type === "result") {
      const telemetry = normalizeResultTelemetry(raw);
      emit("result", this.sessionId, {
        status: raw.is_error ? "error" : "success",
        final_text:
          typeof raw.result === "string"
            ? raw.result
            : null,
        exit_code:
          Number.isFinite(raw.exit_code)
            ? raw.exit_code
            : 0,
        duration_ms: telemetry.duration_ms,
        telemetry,
      });
      return output;
    }

    if (raw.type === "rate_limit_event") {
      emit(
        "runtime",
        this.sessionId,
        normalizeClaudeAccountUsage(raw.rate_limit_info),
      );
      return output;
    }

    emit("runtime", this.sessionId, {
      raw_event_type: raw.type ?? null,
      raw_event_subtype: raw.subtype ?? null,
      metadata: null,
    });
    return output;
  }
}

export function normalizeClaudeEvents(
  rawEvents,
  { logicalConversationId, mode, parentProviderSessionId = null },
) {
  const normalizer = new ClaudeEventNormalizer({
    logicalConversationId,
    mode,
    parentProviderSessionId,
  });
  return rawEvents.flatMap((raw) => normalizer.normalize(raw));
}


function normalizeUserMessageAttribution(raw) {
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

const RESULT_TELEMETRY_JSON_MAX_CHARS = 64_000;
const RESULT_TELEMETRY_MAX_ERRORS = 16;
const RESULT_TELEMETRY_MAX_DENIALS = 64;

function normalizeResultTelemetry(raw) {
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
    stop_reason: clippedString(raw?.stop_reason, 128),
    terminal_reason:
      clippedString(raw?.terminal_reason, 128),
    api_error_status:
      finiteNonNegative(raw?.api_error_status),
    startup_failure_reason:
      clippedString(raw?.startup_failure_reason, 256),
    total_cost_usd:
      finiteNonNegative(raw?.total_cost_usd),
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

const TOOL_RESULT_TEXT_BUDGET_CHARS = 48_000;
const TOOL_RESULT_MAX_STRING_CHARS = 24_000;
const TOOL_RESULT_MAX_ARRAY_ITEMS = 32;
const TOOL_RESULT_MAX_OBJECT_KEYS = 48;
const TOOL_RESULT_MAX_DEPTH = 6;

function normalizeToolResultPayload(block) {
  const stats = {
    truncated: false,
    omittedBinaryItems: 0,
    omittedBinaryBytes: 0,
  };
  const budget = {
    remainingTextChars: TOOL_RESULT_TEXT_BUDGET_CHARS,
  };
  const output = projectToolResultValue(
    block.content,
    stats,
    budget,
    0,
  );

  return {
    tool_use_id: block.tool_use_id,
    output,
    is_error: Boolean(block.is_error),
    ...(stats.truncated
      ? { output_truncated: true }
      : {}),
    ...(stats.omittedBinaryItems > 0
      ? {
          output_binary_omitted: true,
          omitted_binary_items:
            stats.omittedBinaryItems,
          omitted_binary_bytes:
            stats.omittedBinaryBytes,
        }
      : {}),
  };
}

function projectToolResultValue(
  value,
  stats,
  budget,
  depth,
) {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (
    typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    const dataUrl = parseBase64DataUrl(value);
    if (dataUrl) {
      stats.omittedBinaryItems += 1;
      stats.omittedBinaryBytes += dataUrl.byteLength;
      return {
        type: "binary_omitted",
        encoding: "base64",
        media_type: dataUrl.mediaType,
        byte_length: dataUrl.byteLength,
      };
    }
    return boundedToolResultString(value, stats, budget);
  }
  if (depth >= TOOL_RESULT_MAX_DEPTH) {
    stats.truncated = true;
    return "[omitted: tool result nesting limit]";
  }
  if (Array.isArray(value)) {
    if (value.length > TOOL_RESULT_MAX_ARRAY_ITEMS) {
      stats.truncated = true;
    }
    return value
      .slice(0, TOOL_RESULT_MAX_ARRAY_ITEMS)
      .map((item) =>
        projectToolResultValue(
          item,
          stats,
          budget,
          depth + 1,
        )
      );
  }
  if (typeof value !== "object") {
    return String(value);
  }

  const record = value;
  if (isBase64BinaryRecord(record)) {
    const data =
      typeof record.data === "string"
        ? record.data
        : "";
    const byteLength = estimateBase64Bytes(data);
    stats.omittedBinaryItems += 1;
    stats.omittedBinaryBytes += byteLength;
    return {
      type:
        safeString(record.type)
        ?? "binary_omitted",
      ...(safeString(
        record.media_type ?? record.mime_type ?? record.mimeType,
      )
        ? {
            media_type: clippedString(
              record.media_type ?? record.mime_type ?? record.mimeType,
              256,
            ),
          }
        : {}),
      encoding: "base64",
      omitted: true,
      byte_length: byteLength,
    };
  }

  const keys = Object.keys(record);
  if (keys.length > TOOL_RESULT_MAX_OBJECT_KEYS) {
    stats.truncated = true;
  }
  const projected = {};
  for (
    const key of keys.slice(0, TOOL_RESULT_MAX_OBJECT_KEYS)
  ) {
    const item = record[key];
    if (key === "blob" && typeof item === "string") {
      const byteLength = estimateBase64Bytes(item);
      stats.omittedBinaryItems += 1;
      stats.omittedBinaryBytes += byteLength;
      projected[key] = {
        encoding: "base64",
        omitted: true,
        byte_length: byteLength,
      };
      continue;
    }
    projected[key] = projectToolResultValue(
      item,
      stats,
      budget,
      depth + 1,
    );
  }
  return projected;
}

function boundedToolResultString(value, stats, budget) {
  const allowed = Math.max(
    0,
    Math.min(
      value.length,
      TOOL_RESULT_MAX_STRING_CHARS,
      budget.remainingTextChars,
    ),
  );
  budget.remainingTextChars -= allowed;
  if (allowed < value.length) {
    stats.truncated = true;
  }
  return value.slice(0, allowed);
}

function isBase64BinaryRecord(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof value.data !== "string"
  ) {
    return false;
  }
  const encoding =
    safeString(value.type)
    ?? safeString(value.encoding);
  if (encoding === "base64") return true;

  const mediaType = safeString(
    value.media_type ?? value.mime_type ?? value.mimeType,
  );
  return Boolean(
    mediaType
    && (
      mediaType.startsWith("image/")
      || mediaType.startsWith("audio/")
      || mediaType.startsWith("video/")
      || mediaType === "application/octet-stream"
    )
  );
}

function parseBase64DataUrl(value) {
  const match =
    /^data:([^;,]{1,256});base64,([A-Za-z0-9+/=\s]+)$/u
      .exec(value);
  if (!match) return null;
  return {
    mediaType: match[1],
    byteLength: estimateBase64Bytes(match[2]),
  };
}

function estimateBase64Bytes(value) {
  if (typeof value !== "string" || value.length === 0) {
    return 0;
  }
  const compact = value.replace(/\s/gu, "");
  if (compact.length === 0) return 0;
  const padding =
    compact.endsWith("==")
      ? 2
      : compact.endsWith("=")
        ? 1
        : 0;
  return Math.max(
    0,
    Math.floor((compact.length * 3) / 4) - padding,
  );
}

function normalizeClaudeAccountUsage(value) {
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

function normalizeSystemInitEnvironment(raw) {
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

function normalizedToolUseMeta(value, toolUseId) {
  if (!toolUseId || !value) return null;

  let entry = null;
  if (Array.isArray(value)) {
    entry = value.find((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      return (
        candidate.id === toolUseId
        || candidate.tool_use_id === toolUseId
        || candidate.toolUseId === toolUseId
      );
    }) ?? null;
  } else if (typeof value === "object") {
    const keyed = value[toolUseId];
    if (keyed && typeof keyed === "object" && !Array.isArray(keyed)) {
      entry = keyed;
    }
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const displayName =
    clippedString(entry.display_name, 512)
    ?? clippedString(entry.displayName, 512)
    ?? clippedString(entry.name, 512);
  const serverDisplayName =
    clippedString(entry.server_display_name, 512)
    ?? clippedString(entry.serverDisplayName, 512);
  const iconUrl = safeHttpUrl(
    entry.icon_url ?? entry.iconUrl,
    2_048,
  );

  if (!displayName && !serverDisplayName && !iconUrl) {
    return null;
  }

  return {
    ...(displayName ? { display_name: displayName } : {}),
    ...(serverDisplayName
      ? { server_display_name: serverDisplayName }
      : {}),
    ...(iconUrl ? { icon_url: iconUrl } : {}),
  };
}

function safeHttpUrl(value, maxChars) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxChars
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function finiteNonNegative(value) {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    ? value
    : null;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function isoTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis =
      Math.abs(value) < 10_000_000_000
        ? value * 1_000
        : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString();
  }
  if (typeof value === "string" && value.length > 0) {
    const millis = Date.parse(value);
    return Number.isNaN(millis)
      ? null
      : new Date(millis).toISOString();
  }
  return null;
}

function safeString(value) {
  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

function clippedString(value, maxChars) {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length <= maxChars
    ? value
    : value.slice(0, maxChars);
}

function normalizedTaskUsage(value) {
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
