import { randomUUID } from "node:crypto";
import { boundedOutput, isReasoning, provenance, structuredToolOutput, SDK_EVENT_SURFACES } from "./output-contract.mjs";

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
    this.providerMessageStarted = false;
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
          raw_event_type: clippedString(raw.type,128),
          raw_event_subtype: clippedString(raw.subtype,128),
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

    const messageProvenance =
      normalizeMessageProvenance(raw);
    if (
      (raw.type === "user" || raw.type === "assistant")
      && messageProvenance
    ) {
      emit("runtime", this.sessionId, {
        kind: "message_origin",
        source_type: raw.type,
        ...messageProvenance,
      });
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

    if (raw.type === "system" && raw.subtype === "mirror_error") {
      emit("runtime", this.sessionId, {
        kind: "session_store_mirror_error",
        error:
          clippedString(raw.error, 2_000)
          ?? clippedString(raw.message, 2_000),
        code: clippedString(raw.code, 128),
      });
      return output;
    }

    if (raw.type === "system" && raw.subtype === "vcs_state_changed") {
      const mutationKind = clippedString(raw.kind, 128);
      const cwd = clippedString(raw.cwd, 4_096);
      if (mutationKind && cwd) {
        emit("runtime", this.sessionId, {
          kind: "vcs_state_changed",
          mutation_kind: mutationKind,
          cwd,
          branch: clippedString(raw.branch, 512),
        });
        return output;
      }
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
        is_backgrounded:
          typeof raw.is_backgrounded === "boolean"
            ? raw.is_backgrounded
            : null,
        spawn_depth: finiteNonNegative(raw.spawn_depth),
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
      const resourceLinks =
        normalizeResourceLinks(raw.resource_links);
      emit("task", this.sessionId, {
        phase: "notification",
        task_id: safeString(raw.task_id),
        tool_use_id: safeString(raw.tool_use_id),
        status: safeString(raw.status),
        summary: clippedString(raw.summary, 4_000),
        usage: normalizedTaskUsage(raw.usage),
        ...(resourceLinks.length > 0
          ? { resource_links: resourceLinks }
          : {}),
        hidden_from_transcript: raw.skip_transcript === true,
        ambient: raw.ambient === true,
        reason: clippedString(raw.reason, 1_000),
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
      if (event?.type === "message_start" && !this.providerMessageStarted
          && !raw.parent_tool_use_id && !raw.parent_agent_id) {
        this.providerMessageStarted = true;
        emit("runtime", this.sessionId, { kind: "provider_message_start" });
      }
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
      if (event?.type === "content_block_delta" && event.delta?.type === "citations_delta") {
        emit("runtime", this.sessionId, {kind:"citation_preview", provenance:provenance(raw, "citations_delta"), compatibility:boundedOutput(event.delta)});
      }
      if (event?.type === "content_block_start" && event.content_block && !isReasoning(event.content_block) && !["text", "tool_use"].includes(event.content_block.type)) {
        emit("runtime", this.sessionId, {kind:"provider_content_preview", provenance:provenance(raw, event.content_block.type), compatibility:boundedOutput(event.content_block)});
      } else if (event && !["message_start", "message_delta", "message_stop", "content_block_start", "content_block_stop", "content_block_delta", "ping"].includes(event.type)) {
        emit("runtime", this.sessionId, {kind:"unsupported_provider_event", diagnostic_code:"UNSUPPORTED_PROVIDER_EVENT", provenance:provenance(raw, event.type), compatibility:boundedOutput(event)});
      } else if (event?.type === "content_block_delta" && !["text_delta", "input_json_delta", "thinking_delta", "signature_delta", "citations_delta"].includes(event.delta?.type)) {
        emit("runtime", this.sessionId, {kind:"unsupported_provider_event", diagnostic_code:"UNSUPPORTED_PROVIDER_EVENT", provenance:provenance(raw, event.delta?.type), compatibility:boundedOutput(event.delta)});
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
          if (raw.context_usage || raw.usage_report) {
            emit("runtime", this.sessionId, {kind:"provider_observability", provenance:provenance(raw, "text"), compatibility:boundedOutput({context_usage:raw.context_usage, usage_report:raw.usage_report})});
            continue;
          }
          emit("text", this.sessionId, {
            role: "assistant",
            text: block.text,
            final: false,
            provenance: provenance(raw, "text"),
            ...(block.citations ? {citations:boundedOutput(block.citations)} : {}),
          });
        }
        if (block.type === "tool_use") {
          const displayMeta = normalizedToolUseMeta(
            raw.tool_use_meta ?? raw.message?.tool_use_meta,
            block.id,
          );
          emit("tool_use", this.sessionId, {
            provenance: provenance(raw, "tool_use", {tool_use_id:block.id}),
            tool_use_id: block.id,
            tool_name: block.name,
            input: boundedOutput(block.input).payload,
            ...(messageProvenance?.parent_tool_use_id
              ? {
                  parent_tool_use_id:
                    messageProvenance.parent_tool_use_id,
                }
              : {}),
            ...(messageProvenance?.parent_agent_id
              ? {
                  parent_agent_id:
                    messageProvenance.parent_agent_id,
                }
              : {}),
            ...(displayMeta ?? {}),
          });
        }
        if (block.type === "tool_result") {
          emit(
            "tool_result",
            this.sessionId,
            {...normalizeToolResultPayload(block), provenance:provenance(raw, block.type, {tool_use_id:block.tool_use_id})},
          );
        }

        const providerSearchParts =
          !raw.parent_tool_use_id
          && !raw.parent_agent_id
          && !messageProvenance?.parent_tool_use_id
          && !messageProvenance?.parent_agent_id
            ? normalizeProviderSearchParts(block)
            : [];
        if (providerSearchParts.length > 0) {
          emit(
            "search_result",
            this.sessionId,
            {
              provenance: provenance(raw, block.type),
              structured: structuredToolOutput(providerSearchParts),
              ...(typeof block.tool_use_id === "string"
                ? { tool_use_id: block.tool_use_id }
                : {}),
            },
          );
        }

        if (["container_upload", "image", "document", "search_result", "resource", "resource_link"].includes(block.type)) {
          emit("runtime", this.sessionId, {kind:"provider_content_candidate", provenance:provenance(raw, block.type), compatibility:boundedOutput(block)});
        } else if (block.type === "fallback") {
          emit("runtime", this.sessionId, {kind:"provider_observability", provenance:provenance(raw, block.type), compatibility:boundedOutput(block)});
        } else if (["server_tool_use", "mcp_tool_use", "web_search_tool_result", "web_fetch_tool_result", "advisor_tool_result", "code_execution_tool_result", "bash_code_execution_tool_result", "text_editor_code_execution_tool_result", "tool_search_tool_result", "mcp_tool_result", "mcp_tool_listing"].includes(block.type)) {
          emit("runtime", this.sessionId, {kind:"provider_execution", provenance:provenance(raw, block.type), compatibility:boundedOutput(block)});
        } else if (!["text", "tool_use", "tool_result"].includes(block.type) && !isReasoning(block)) {
          emit("runtime", this.sessionId, {
            kind:"unsupported_provider_content", diagnostic_code:"UNSUPPORTED_PROVIDER_CONTENT",
            scope:raw.parent_tool_use_id || raw.parent_agent_id ? "activity" : "conversation",
            provenance:provenance(raw, block.type), compatibility:boundedOutput(block),
          });
        }
      }
      return output;
    }

    if (raw.type === "user") {
      let emittedToolResult = false;
      const toolResultBlocks =
        Array.isArray(raw.message?.content)
          ? raw.message.content.filter(
              (block) => block?.type === "tool_result",
            )
          : [];
      const resourceLinks =
        normalizeResourceLinks(
          raw.tool_use_result?.resourceLinks
          ?? raw.tool_use_result?.resource_links,
        );
      const resourceToolUseId =
        safeString(
          raw.tool_use_result?.tool_use_id
          ?? raw.tool_use_result?.toolUseId
          ?? raw.tool_use_result?.toolUseID,
        );

      let attachedProviderOutput = false;
      for (const block of toolResultBlocks) {
        emittedToolResult = true;
        const attachesProviderOutput = raw.tool_use_result !== undefined
          && (resourceToolUseId === block.tool_use_id || (resourceToolUseId === null && toolResultBlocks.length === 1));
        attachedProviderOutput ||= attachesProviderOutput;
        const attachesResourceLinks =
          resourceLinks.length > 0
          && (
            resourceToolUseId === block.tool_use_id
            || (
              resourceToolUseId === null
              && toolResultBlocks.length === 1
            )
          );
        emit(
          "tool_result",
          this.sessionId,
          {...normalizeToolResultPayload(block, attachesResourceLinks ? resourceLinks : [], attachesProviderOutput ? boundedOutput(raw.tool_use_result) : null), provenance:provenance(raw, block.type, {tool_use_id:block.tool_use_id})},
        );
      }
      if (raw.tool_use_result !== undefined && !attachedProviderOutput) {
        emit("runtime", this.sessionId, {kind:"unattributed_tool_output", diagnostic_code:"UNATTRIBUTED_TOOL_OUTPUT", provenance:provenance(raw, "tool_use_result"), compatibility:boundedOutput(raw.tool_use_result)});
      }
      for (const block of Array.isArray(raw.message?.content) ? raw.message.content : []) {
        if (block?.type !== "tool_result" && block?.type !== "text" && !isReasoning(block)) {
          emit("runtime", this.sessionId, {kind:"unsupported_provider_content", diagnostic_code:"UNSUPPORTED_PROVIDER_CONTENT", scope:"activity", provenance:provenance(raw, block?.type), compatibility:boundedOutput(block)});
        }
      }
      if (emittedToolResult || messageProvenance) return output;
    }

    if (raw.type === "result") {
      if (raw.subtype && !["success", "error_during_execution", "error_max_turns", "error_max_budget_usd", "error_max_structured_output_retries"].includes(raw.subtype)) {
        emit("runtime", this.sessionId, {kind:"unsupported_provider_event", diagnostic_code:"UNSUPPORTED_PROVIDER_EVENT", provenance:provenance(raw), compatibility:boundedOutput(raw)});
      }
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
        ...(raw.structured_output !== undefined ? {structured_output:{...boundedOutput(raw.structured_output), provenance:provenance(raw, "structured_output")}} : {}),
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

    const surface = SDK_EVENT_SURFACES[raw.type === "system" ? `system/${raw.subtype}` : raw.type];
    emit("runtime", this.sessionId, {
      raw_event_type: clippedString(raw.type,128),
      raw_event_subtype: clippedString(raw.subtype,128),
      kind: surface ? "provider_runtime" : "unsupported_provider_event",
      surface: surface ?? "unknown",
      ...(surface ? {} : {diagnostic_code: "UNSUPPORTED_PROVIDER_EVENT"}),
      provenance: provenance(raw),
      compatibility: boundedOutput(raw),
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

function normalizeMessageProvenance(raw) {
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

const RESOURCE_LINK_MAX_ITEMS = 64;
const RESOURCE_LINK_URI_MAX_CHARS = 4_096;
const RESOURCE_LINK_NAME_MAX_CHARS = 512;
const RESOURCE_LINK_DESCRIPTION_MAX_CHARS = 2_000;
const RESOURCE_LINK_MIME_MAX_CHARS = 256;
const RESOURCE_LINK_META_MAX_CHARS = 8_000;

function normalizeResourceLinks(value) {
  if (!Array.isArray(value)) return [];

  const links = [];
  for (const item of value.slice(0, RESOURCE_LINK_MAX_ITEMS)) {
    if (
      !item
      || typeof item !== "object"
      || Array.isArray(item)
    ) {
      continue;
    }

    const uri = clippedString(
      item.uri,
      RESOURCE_LINK_URI_MAX_CHARS,
    );
    if (!uri) continue;

    const type = clippedString(item.type, 64);
    if (type && type !== "resource_link") continue;

    links.push({
      type: "resource_link",
      uri,
      name: clippedString(
        item.name,
        RESOURCE_LINK_NAME_MAX_CHARS,
      ),
      title: clippedString(
        item.title,
        RESOURCE_LINK_NAME_MAX_CHARS,
      ),
      description: clippedString(
        item.description,
        RESOURCE_LINK_DESCRIPTION_MAX_CHARS,
      ),
      mime_type: clippedString(
        item.mimeType ?? item.mime_type,
        RESOURCE_LINK_MIME_MAX_CHARS,
      ),
      size: finiteNonNegative(item.size),
      annotations:
        boundedResourceLinkMetadata(item.annotations),
      metadata:
        boundedResourceLinkMetadata(
          item._meta ?? item.meta,
        ),
    });
  }
  return links;
}

function boundedResourceLinkMetadata(value) {
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
      || serialized.length > RESOURCE_LINK_META_MAX_CHARS
    ) {
      return null;
    }
    return boundedOutput(JSON.parse(serialized)).payload;
  } catch {
    return null;
  }
}

function normalizeProviderSearchParts(block) {
  const candidates =
    block?.type === "search_result"
      ? [block]
      : Array.isArray(block?.content)
        ? block.content
        : [];

  const parts = [];
  for (const value of candidates.slice(0, 32)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const type = safeString(value.type);
    if (type !== "web_search_result" && type !== "search_result") {
      continue;
    }

    const title = safeString(value.title);
    const url = safeString(value.url);
    const source = safeString(value.source) ?? url;
    let snippet = safeString(value.snippet);

    if (!snippet && typeof value.content === "string") {
      snippet = value.content;
    } else if (!snippet && Array.isArray(value.content)) {
      const texts = value.content
        .slice(0, 16)
        .map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? safeString(item.text)
            : null,
        )
        .filter(Boolean);
      if (texts.length > 0) {
        snippet = texts.join("\n");
      }
    }

    if (!title && !url && !source && !snippet) {
      continue;
    }

    parts.push({
      type: "search_result",
      ...(title ? { title: title.slice(0, 2_000) } : {}),
      ...(source ? { source: source.slice(0, 8_000) } : {}),
      ...(url ? { url: url.slice(0, 8_000) } : {}),
      ...(snippet ? { snippet: snippet.slice(0, 8_000) } : {}),
    });
  }
  return parts;
}

const TOOL_RESULT_TEXT_BUDGET_CHARS = 48_000;
const TOOL_RESULT_MAX_STRING_CHARS = 24_000;
const TOOL_RESULT_MAX_ARRAY_ITEMS = 32;
const TOOL_RESULT_MAX_OBJECT_KEYS = 48;
const TOOL_RESULT_MAX_DEPTH = 6;

function normalizeToolResultPayload(
  block,
  resourceLinks = [],
  providerOutput = null,
) {
  const stats = {
    truncated: false,
    omittedBinaryItems: 0,
    omittedBinaryBytes: 0,
  };
  const budget = {
    remainingTextChars: TOOL_RESULT_TEXT_BUDGET_CHARS,
    remainingNodes: 512,
  };
  const output = projectToolResultValue(
    block.content,
    stats,
    budget,
    0,
  );

  const structuredEnvelope = boundedOutput(output);
  return {
    tool_use_id: block.tool_use_id,
    output,
    structured: {
      ...structuredToolOutput(structuredEnvelope.payload),
      ...(providerOutput ? {provider_output:providerOutput} : {}),
      truncated: stats.truncated || structuredEnvelope.truncated,
      redacted: stats.reasoningRedacted === true || structuredEnvelope.redacted,
    },
    is_error: Boolean(block.is_error),
    ...(resourceLinks.length > 0
      ? { resource_links: resourceLinks }
      : {}),
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
  if (--budget.remainingNodes < 0) {
    stats.truncated = true;
    return null;
  }
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
      .slice(0, Math.min(TOOL_RESULT_MAX_ARRAY_ITEMS, Math.max(0, budget.remainingNodes)))
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
  if (isReasoning(record)) { stats.reasoningRedacted = true; return {type:"reasoning_redacted"}; }
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
    if (budget.remainingNodes <= 0) { stats.truncated = true; break; }
    const item = record[key];
    if (/^(thinking|reasoning|signature|encrypted_content|chain_of_thought)$/i.test(key)) { stats.reasoningRedacted = true; projected[key] = "[redacted: reasoning]"; continue; }
    if ((["blob", "bytes", "base64"].includes(key) || (key === "data" && (record.type === "base64" || record.encoding === "base64" || record.media_type || record.mime_type || record.mimeType || ["image", "document"].includes(record.type) || (typeof item === "string" && item.length >= 512 && /^[A-Za-z0-9+/=\s]+$/.test(item))))) && typeof item === "string") {
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
    let safeKey = boundedToolResultString(key.slice(0, 128), stats, budget);
    if (Object.hasOwn(projected, safeKey)) {
      stats.truncated = true;
      const prefix = safeKey.slice(0,116);
      let suffix = Object.keys(projected).length;
      do { safeKey = prefix + ':' + suffix++; } while (Object.hasOwn(projected,safeKey));
    }
    if (safeKey.length < key.length) stats.truncated = true;
    Object.defineProperty(projected, safeKey, {
      value: projectToolResultValue(item, stats, budget, depth + 1),
      enumerable: true,
    });
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
      || mediaType.startsWith("application/")
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
