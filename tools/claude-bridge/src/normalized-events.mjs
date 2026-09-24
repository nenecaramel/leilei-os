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

    if (raw.type === "system" && raw.subtype === "init") {
      emit("session", this.sessionId, {
        provider_session_id: this.sessionId,
        parent_provider_session_id: this.parentProviderSessionId,
        mode: this.mode,
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
          emit("tool_use", this.sessionId, {
            tool_use_id: block.id,
            tool_name: block.name,
            input: block.input,
          });
        }
        if (block.type === "tool_result") {
          emit("tool_result", this.sessionId, {
            tool_use_id: block.tool_use_id,
            output: block.content,
            is_error: Boolean(block.is_error),
          });
        }
      }
      return output;
    }

    if (raw.type === "user") {
      let emittedToolResult = false;
      for (const block of raw.message?.content ?? []) {
        if (block.type === "tool_result") {
          emittedToolResult = true;
          emit("tool_result", this.sessionId, {
            tool_use_id: block.tool_use_id,
            output: block.content,
            is_error: Boolean(block.is_error),
          });
        }
      }
      if (emittedToolResult) return output;
    }

    if (raw.type === "result") {
      emit("result", this.sessionId, {
        status: raw.is_error ? "error" : "success",
        final_text: raw.result ?? null,
        exit_code: raw.exit_code ?? 0,
        duration_ms: raw.duration_ms ?? null,
      });
      return output;
    }

    emit("runtime", this.sessionId, {
      raw_event_type: raw.type ?? null,
      raw_event_subtype: raw.subtype ?? null,
      metadata: raw.type === "rate_limit_event" ? { rate_limit: true } : null,
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
