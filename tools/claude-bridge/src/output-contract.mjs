// Compatibility data, never hidden reasoning or binary transport.
export const OUTPUT_SCHEMA_VERSION = 1;
const REASONING_TYPES = new Set([
  "thinking",
  "redacted_thinking",
  "reasoning",
  "reasoning_delta",
  "thinking_delta",
  "signature_delta",
  "compaction",
]);
export function isReasoning(value) {
  return REASONING_TYPES.has(value?.type);
}
export function boundedOutput(value) {
  const state = { chars: 24000, nodes: 512, truncated: false, redacted: false };
  const seen = new WeakSet();
  function visit(v, depth = 0, key = "") {
    if (--state.nodes < 0 || depth > 6) {
      state.truncated = true;
      return "[omitted: bounds]";
    }
    if (
      /^(thinking|reasoning|signature|encrypted_content|chain_of_thought)$/i.test(
        key,
      ) ||
      isReasoning(v)
    ) {
      state.redacted = true;
      return "[redacted: reasoning]";
    }
    if (v === null || v === undefined) return null;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      if (
        /^(blob|bytes|base64)$/i.test(key) ||
        /^data:[^,]+;base64,/i.test(v)
      ) {
        state.redacted = true;
        return {
          materialization: "pending",
          encoding: "base64",
          ...(/^data:/.test(v)
            ? { media_type: v.match(/^data:([^;,]+)/)?.[1] ?? null }
            : {}),
          byte_length: Math.max(
            0,
            Math.floor((v.replace(/^data:[^,]+,/, "").length * 3) / 4) -
              (v.endsWith("==") ? 2 : v.endsWith("=") ? 1 : 0),
          ),
        };
      }
      const n = Math.min(v.length, 8000, Math.max(0, state.chars));
      state.chars -= n;
      if (n < v.length) state.truncated = true;
      return v.slice(0, n);
    }
    if (typeof v !== "object") return null;
    if (seen.has(v)) {
      state.truncated = true;
      return "[omitted: cycle]";
    }
    seen.add(v);
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) {
      state.redacted = true;
      return { materialization: "pending", byte_length: v.byteLength };
    }
    if (Array.isArray(v)) {
      if (v.length > 32) state.truncated = true;
      return v
        .slice(0, Math.min(32, Math.max(0, state.nodes)))
        .map((x) => visit(x, depth + 1));
    }
    const result = {};
    const keys = Object.keys(v);
    if (keys.length > 48) state.truncated = true;
    for (const k of keys.slice(0, 48)) {
      if (state.nodes <= 0) {
        state.truncated = true;
        break;
      }
      let safeKey = k.slice(0, 128);
      if (safeKey.length < k.length) state.truncated = true;
      if (Object.hasOwn(result, safeKey)) {
        state.truncated = true;
        const prefix = safeKey.slice(0, 116);
        let suffix = Object.keys(result).length;
        do {
          safeKey = prefix + ":" + suffix++;
        } while (Object.hasOwn(result, safeKey));
      }
      state.chars -= safeKey.length;
      if (state.chars < 0) {
        state.truncated = true;
        break;
      }
      Object.defineProperty(result, safeKey, {
        value: visit(
          v[k],
          depth + 1,
          k === "data" &&
            (v.type === "base64" ||
              v.encoding === "base64" ||
              v.media_type ||
              v.mime_type ||
              v.mimeType ||
              ["image", "document"].includes(v.type) ||
              (typeof v[k] === "string" &&
                v[k].length >= 512 &&
                /^[A-Za-z0-9+/=\s]+$/.test(v[k])))
            ? "base64"
            : k,
        ),
        enumerable: true,
      });
    }
    return result;
  }
  const payload = visit(value);
  return {
    schema_version: OUTPUT_SCHEMA_VERSION,
    payload,
    truncated: state.truncated,
    redacted: state.redacted,
  };
}
export function provenance(raw, rawType = raw?.type, extra = {}) {
  return {
    provider: "claude_code",
    raw_type:
      typeof rawType === "string"
        ? rawType.slice(0, 128) || "unknown"
        : "unknown",
    raw_subtype:
      typeof raw?.subtype === "string" ? raw.subtype.slice(0, 128) : null,
    provider_schema: "claude-agent-sdk/0.3.286",
    ...Object.fromEntries(
      ["uuid", "task_id", "parent_tool_use_id", "parent_agent_id"]
        .filter((k) => typeof raw?.[k] === "string")
        .map((k) => [k, raw[k].slice(0, 256)]),
    ),
    ...(raw?.origin
      ? {
          origin: boundedOutput(
            Object.fromEntries(
              [
                "kind",
                "subkind",
                "server",
                "from",
                "name",
                "fromSession",
                "fromMode",
                "senderTaskId",
                "verifiedPeerPid",
                "fireReason",
              ]
                .filter((k) => raw.origin[k] !== undefined)
                .map((k) => [k, raw.origin[k]]),
            ),
          ).payload,
        }
      : {}),
    ...extra,
  };
}
export function structuredToolOutput(output) {
  const values = Array.isArray(output) ? output : [output];
  return {
    schema_version: 1,
    parts: values.slice(0, 32).map((value) => {
      if (typeof value === "string") return { type: "text", text: value };
      const type = value?.type;
      if (type === "image" || type === "document") {
        const source = value.source ?? value;
        return {
          type,
          materialization: "pending",
          media_type: source.media_type ?? source.mimeType ?? null,
          byte_length: source.byte_length ?? source.data?.byte_length ?? null,
          metadata: boundedOutput(value).payload,
        };
      }
      if (
        [
          "text",
          "json",
          "search_result",
          "citation",
          "resource_link",
          "resource",
          "generated_file",
          "structured_output",
        ].includes(type)
      )
        return {
          type,
          value,
          ...(["resource_link", "resource"].includes(type)
            ? { capability: "reference_only" }
            : {}),
        };
      return {
        type: type ? "unsupported" : "json",
        raw_type: type ?? null,
        ...(type ? { diagnostic_code: "UNSUPPORTED_PROVIDER_CONTENT" } : {}),
        value,
      };
    }),
  };
}

export const SDK_EVENT_SURFACES = {
  assistant: "content_producing",
  user: "runtime",
  result: "turn_result",
  stream_event: "runtime",
  rate_limit_event: "observability",
  tool_progress: "runtime",
  tool_use_summary: "runtime",
  auth_status: "runtime",
  prompt_suggestion: "runtime",
  conversation_reset: "runtime",
  "system/init": "observability",
  "system/compact_boundary": "runtime",
  "system/status": "runtime",
  "system/api_retry": "runtime",
  "system/control_request_progress": "runtime",
  "system/model_refusal_fallback": "runtime",
  "system/model_refusal_no_fallback": "runtime",
  "system/local_command_output": "runtime",
  "system/hook_started": "runtime",
  "system/hook_progress": "runtime",
  "system/hook_response": "runtime",
  "system/plugin_install": "observability",
  "system/task_notification": "runtime",
  "system/task_started": "runtime",
  "system/task_updated": "runtime",
  "system/task_progress": "runtime",
  "system/background_tasks_changed": "runtime",
  "system/thinking_tokens": "observability",
  "system/session_state_changed": "runtime",
  "system/worker_shutting_down": "runtime",
  "system/commands_changed": "observability",
  "system/notification": "runtime",
  "system/files_persisted": "runtime",
  "system/memory_recall": "runtime",
  "system/elicitation_complete": "runtime",
  "system/permission_denied": "runtime",
  "system/mirror_error": "observability",
  "system/informational": "runtime",
};
