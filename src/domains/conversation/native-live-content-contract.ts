import type { ConversationContentKind } from "../../database/schema.js";

export const NATIVE_LIVE_CONTENT_SCHEMA_VERSION = 1;
export type CanonicalContentIdentity =
  "text" | "attachment" | "artifact" | "resource" | "canonical_tool_result";
export type CanonicalEntityRef = {
  type: "attachment_ref" | "artifact_ref" | "resource_ref";
  entity_id: string;
};
export type ContentProvenance = {
  provider: string;
  raw_type: string;
  raw_subtype?: string | null;
  provider_schema?: string;
  tool_use_id?: string;
  task_id?: string;
  parent_tool_use_id?: string;
  parent_agent_id?: string;
  origin?: unknown;
  source_ref?: CanonicalEntityRef;
};
export type ResourceCapability =
  "reference_only" | "previewable" | "interactive_mcp_app";
export type StructuredToolPart = {
  type:
    | "text"
    | "json"
    | "image"
    | "document"
    | "search_result"
    | "citation"
    | "generated_file"
    | "resource_link"
    | "resource"
    | "structured_output"
    | "unsupported";
  value?: unknown;
  text?: string;
  materialization?: "pending" | "materialized";
  media_type?: string | null;
  byte_length?: number | null;
  ref?: CanonicalEntityRef;
  raw_type?: string | null;
  metadata?: unknown;
  capability?: ResourceCapability;
};
export type StructuredToolResult = {
  schema_version: 1;
  parts: StructuredToolPart[];
  truncated: boolean;
  redacted: boolean;
  provider_output?: Record<string, unknown>;
};
export type ConversationProjection = {
  schema_version: 1;
  identity: CanonicalContentIdentity;
  reason: "explicit_share" | "materialized_send";
  refs: CanonicalEntityRef[];
};
const identities = new Set<string>([
  "text",
  "attachment",
  "artifact",
  "resource",
  "canonical_tool_result",
]);
const refTypes = new Set<string>([
  "attachment_ref",
  "artifact_ref",
  "resource_ref",
]);
export function parseConversationProjection(
  value: unknown,
): ConversationProjection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    v.schema_version !== 1 ||
    typeof v.identity !== "string" ||
    !identities.has(v.identity) ||
    !["explicit_share", "materialized_send"].includes(String(v.reason)) ||
    !Array.isArray(v.refs) ||
    v.refs.length > 32
  )
    return null;
  const refs: CanonicalEntityRef[] = [];
  for (const ref of v.refs) {
    if (
      !ref ||
      typeof ref !== "object" ||
      !refTypes.has(ref.type) ||
      typeof ref.entity_id !== "string" ||
      !ref.entity_id.trim() ||
      ref.entity_id.length > 256
    )
      return null;
    refs.push({ type: ref.type, entity_id: ref.entity_id });
  }
  if (
    ["attachment", "artifact", "resource"].includes(v.identity) &&
    !refs.some((r) => r.type === `${v.identity}_ref`)
  )
    return null;
  return {
    schema_version: 1,
    identity: v.identity as CanonicalContentIdentity,
    reason: v.reason as ConversationProjection["reason"],
    refs,
  };
}

// Bound again at the authoritative writer: normalized events can originate in older runtimes.
export function boundCanonicalPayload(value: unknown): Record<string, unknown> {
  let chars = 24000;
  let nodes = 512;
  let truncated = false;
  const seen = new WeakSet<object>();
  function visit(v: unknown, depth = 0, key = ""): unknown {
    if (--nodes < 0 || depth > 6) {
      truncated = true;
      return "[omitted: bounds]";
    }
    if (
      /^(thinking|reasoning|signature|encrypted_content|chain_of_thought)$/i.test(
        key,
      )
    )
      return "[redacted: reasoning]";
    if (v === null || v === undefined) return null;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      if (/^(blob|bytes|base64)$/i.test(key) || /^data:[^,]+;base64,/i.test(v))
        return {
          materialization: "pending",
          encoding: "base64",
          ...(/^data:/.test(v)
            ? { media_type: v.match(/^data:([^;,]+)/)?.[1] ?? null }
            : {}),
          encoded_length: v.length,
        };
      const n = Math.min(v.length, 8000, Math.max(0, chars));
      chars -= n;
      if (n < v.length) truncated = true;
      return v.slice(0, n);
    }
    if (typeof v !== "object") return null;
    if (seen.has(v)) {
      truncated = true;
      return "[omitted: cycle]";
    }
    seen.add(v);
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer)
      return { materialization: "pending", byte_length: v.byteLength };
    if (Array.isArray(v)) {
      if (v.length > 32) truncated = true;
      return v
        .slice(0, Math.min(32, Math.max(0, nodes)))
        .map((x) => visit(x, depth + 1));
    }
    const record = v as Record<string, unknown>;
    if (
      [
        "thinking",
        "redacted_thinking",
        "compaction",
        "reasoning",
        "reasoning_delta",
        "thinking_delta",
        "signature_delta",
      ].includes(String(record.type))
    )
      return { type: "reasoning_redacted" };
    const out: Record<string, unknown> = {};
    const keys = Object.keys(record);
    if (keys.length > 48) truncated = true;
    for (const k of keys.slice(0, 48)) {
      if (nodes <= 0) {
        truncated = true;
        break;
      }
      let safe = k.slice(0, 128);
      if (safe.length < k.length) truncated = true;
      if (Object.hasOwn(out, safe)) {
        truncated = true;
        const prefix = safe.slice(0, 116);
        let suffix = Object.keys(out).length;
        do {
          safe = prefix + ":" + suffix++;
        } while (Object.hasOwn(out, safe));
      }
      chars -= safe.length;
      if (chars < 0) {
        truncated = true;
        break;
      }
      Object.defineProperty(out, safe, {
        value: visit(
          record[k],
          depth + 1,
          k === "data" &&
            (record.type === "base64" ||
              record.encoding === "base64" ||
              record.media_type ||
              record.mime_type ||
              record.mimeType ||
              ["image", "document"].includes(String(record.type)) ||
              (typeof record[k] === "string" &&
                (record[k] as string).length >= 512 &&
                /^[A-Za-z0-9+/=\s]+$/.test(record[k] as string)))
            ? "base64"
            : k,
        ),
        enumerable: true,
      });
    }
    return out;
  }
  const payload = visit(value);
  return { schema_version: 1, compatibility_payload: payload, truncated };
}

export type NativeLiveReadableKind =
  CanonicalContentIdentity | "tool_use" | "tool_result" | "unknown";
export function storedContentKind(
  kind: NativeLiveReadableKind,
): ConversationContentKind {
  return ["artifact", "resource", "canonical_tool_result"].includes(kind)
    ? "unknown"
    : (kind as ConversationContentKind);
}
export function readableContentKind(
  kind: string,
  payload: Record<string, unknown> | null,
): NativeLiveReadableKind {
  if (
    kind === "unknown" &&
    payload?.schema_version === 1 &&
    typeof payload.identity === "string" &&
    identities.has(payload.identity)
  )
    return payload.identity as CanonicalContentIdentity;
  return ["text", "attachment", "tool_use", "tool_result"].includes(kind)
    ? (kind as NativeLiveReadableKind)
    : "unknown";
}

export function storedContentPayload(
  kind: NativeLiveReadableKind,
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (
    !["artifact", "resource", "canonical_tool_result", "unknown"].includes(kind)
  )
    return payload;
  const bounded = boundCanonicalPayload(payload);
  if (kind === "unknown")
    return {
      ...(bounded.compatibility_payload as Record<string, unknown> | null),
      schema_version: payload?.schema_version ?? 1,
      truncated: payload?.truncated === true || bounded.truncated === true,
    };
  if (payload?.schema_version !== 1 || payload.identity !== kind)
    throw new TypeError("Canonical identity requires a v1 content envelope.");
  const refs = parseConversationProjection({
    schema_version: 1,
    identity: kind,
    reason: "explicit_share",
    refs: payload.refs,
  });
  if (!refs)
    throw new TypeError("Canonical identity requires valid entity references.");
  const content = bounded.compatibility_payload as Record<
    string,
    unknown
  > | null;
  return {
    ...content,
    schema_version: 1,
    identity: kind,
    refs: refs.refs,
    truncated: bounded.truncated,
  };
}

/** Read legacy/future non-core rows visibly without exposing old reasoning or binary. */
export function readableContentData(
  kind: string,
  rawType: string,
  text: string | null,
  payload: Record<string, unknown> | null,
): {
  kind: NativeLiveReadableKind;
  text: string | null;
  payload: Record<string, unknown> | null;
} {
  const identity = readableContentKind(kind, payload);
  if (identity !== "unknown") return { kind: identity, text, payload };
  if (
    ["thinking", "reasoning", "reasoning_recap", "redacted_thinking"].includes(
      kind,
    ) ||
    [
      "thinking",
      "redacted_thinking",
      "reasoning",
      "reasoning_delta",
      "thinking_delta",
      "signature_delta",
      "compaction",
    ].includes(rawType)
  )
    return {
      kind: "unknown",
      text: null,
      payload: {
        schema_version: 1,
        diagnostic_code: "HIDDEN_REASONING_EXCLUDED",
        stored_kind: kind,
        raw_type: rawType,
      },
    };
  const bounded = boundCanonicalPayload({ text, payload });
  const data = bounded.compatibility_payload as Record<string, unknown>;
  return {
    kind: "unknown",
    text: typeof data.text === "string" ? data.text : null,
    payload: {
      schema_version: payload?.schema_version ?? 1,
      diagnostic_code: "UNSUPPORTED_STORED_CONTENT",
      stored_kind: kind,
      raw_type: rawType,
      ...bounded,
    },
  };
}
