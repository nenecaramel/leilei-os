import { clippedString, finiteNonNegative, safeString } from './normalized-event-values.mjs';
import {
  normalizeClaudeAccountUsage,
  normalizeMessageProvenance,
  normalizeResultTelemetry,
  normalizeSystemInitEnvironment,
  normalizeUserMessageAttribution,
  normalizedTaskUsage,
} from './normalized-event-metadata.mjs';
import {
  normalizeProviderSearchParts,
  normalizeResourceLinks,
  normalizeToolResultPayload,
  normalizedToolUseMeta,
} from './normalized-tool-results.mjs';

import { randomUUID } from "node:crypto";
import {
  boundedOutput,
  isReasoning,
  provenance,
  structuredToolOutput,
  SDK_EVENT_SURFACES,
} from "./output-contract.mjs";

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
        ...(typeof raw.run_id === "string" ? { run_id: raw.run_id } : {}),
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
        ...(typeof raw.run_id === "string" ? { run_id: raw.run_id } : {}),
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
        ...(typeof raw.run_id === "string" ? { run_id: raw.run_id } : {}),
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
        ...(typeof raw.run_id === "string" ? { run_id: raw.run_id } : {}),
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
            ...(typeof task?.run_id === "string" ? { run_id: task.run_id } : {}),
            ...(typeof task?.parent_task_id === "string" ? { parent_task_id: task.parent_task_id } : {}),
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

      for (const [blockIndex, block] of (raw.message?.content ?? []).entries()) {
        // The user-visible Claude Code thinking text is an explicit assistant
        // content block. Do not forward streamed reasoning deltas, signatures,
        // redacted thinking, nested agents, or generic provider debug payloads.
        if (block?.type === "thinking"
            && !raw.parent_tool_use_id && !raw.parent_agent_id
            && !messageProvenance?.parent_tool_use_id
            && !messageProvenance?.parent_agent_id
            && typeof block.thinking === "string") {
          const content = clippedString(block.thinking, 8_000);
          if (content?.trim()) {
            emit("runtime", this.sessionId, {
              kind: "user_visible_thinking",
              text: content,
              source_uuid: clippedString(raw.uuid, 128),
              content_index: blockIndex,
            });
          }
        }
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
