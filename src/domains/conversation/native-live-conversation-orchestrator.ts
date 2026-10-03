import {
  boundCanonicalPayload,
  parseConversationProjection,
} from "./native-live-content-contract.js";
import type { NativeLiveContentBlockInput } from "./native-live-conversation-types.js";

export type NativeLiveNormalizedEventType =
  | "session"
  | "text"
  | "partial_text"
  | "tool_use"
  | "tool_result"
  | "attachment"
  | "task"
  | "result"
  | "error"
  | "runtime";

export type NativeLiveNormalizedEvent = {
  type: NativeLiveNormalizedEventType;
  provider_session_id?: string | null;
  payload?: Record<string, unknown>;
};

export type NativeLiveRuntimeResult = {
  providerSessionId: string | null;
  normalizedEvents: readonly NativeLiveNormalizedEvent[];
};

export interface NativeLiveClaudeRuntime {
  sendNew(prompt: string): Promise<NativeLiveRuntimeResult>;
  resume(sessionId: string, prompt: string): Promise<NativeLiveRuntimeResult>;
  fork(sessionId: string, prompt: string): Promise<NativeLiveRuntimeResult>;
}

export function canonicalizeNativeLiveEvents(
  events: readonly NativeLiveNormalizedEvent[],
): {
  blocks: NativeLiveContentBlockInput[];
  error: string | null;
} {
  const blocks: NativeLiveContentBlockInput[] = [];
  let finalText: string | null = null;
  let error: string | null = null;
  let sawText = false;

  for (const event of events) {
    const payload = event.payload ?? {};

    if (event.type === "error") {
      error =
        stringValue(payload.message) ??
        stringValue(payload.code) ??
        "Claude runtime emitted an error event.";
      continue;
    }

    if (event.type === "result") {
      if (payload.status === "error") {
        error =
          stringValue(payload.message) ??
          "Claude runtime result reported an error.";
      }
      finalText = stringValue(payload.final_text) ?? finalText;
      if (!payload.conversation_projection) continue;
    }

    if (event.type === "text") {
      const provenance = payload.provenance as
        Record<string, unknown> | undefined;
      if (provenance?.parent_tool_use_id || provenance?.parent_agent_id)
        continue;
      const text = stringValue(payload.text);
      if (text) {
        sawText = true;
        blocks.push({
          kind: "text",
          rawType: "text",
          text,
          ...(payload.provenance || payload.citations
            ? {
                payload: {
                  schema_version: 1,
                  identity: "text",
                  provenance: boundCanonicalPayload(payload.provenance)
                    .compatibility_payload,
                  ...(payload.citations
                    ? { citations: boundCanonicalPayload(payload.citations) }
                    : {}),
                },
              }
            : {}),
        });
      }
      continue;
    }

    if (event.type === "tool_use") continue;

    if (
      event.type === "tool_result" ||
      event.type === "runtime" ||
      event.type === "result"
    ) {
      const projection = parseConversationProjection(
        payload.conversation_projection,
      );
      if (payload.conversation_projection && !projection) {
        error = "Unsupported canonical content projection contract.";
        continue;
      }
      if (
        projection &&
        projection.identity !== "attachment" &&
        (projection.identity !== "text" || typeof payload.output === "string")
      ) {
        const bounded = boundCanonicalPayload(
          payload.structured ?? payload.output ?? payload.structured_output,
        );
        blocks.push({
          kind: projection.identity,
          rawType: event.type,
          ...(projection.identity === "text" &&
          typeof payload.output === "string"
            ? { text: payload.output }
            : {}),
          payload: {
            schema_version: 1,
            identity: projection.identity,
            refs: projection.refs,
            provenance: boundCanonicalPayload(
              payload.provenance ?? {
                provider: "claude_code",
                raw_type: event.type,
                tool_use_id: payload.tool_use_id,
              },
            ).compatibility_payload,
            structured: bounded,
          },
        });
      } else if (
        event.type === "runtime" &&
        payload.kind === "unsupported_provider_content" &&
        payload.scope === "conversation"
      ) {
        blocks.push({
          kind: "unknown",
          rawType: String(
            (payload.provenance as Record<string, unknown> | undefined)
              ?.raw_type ?? "unknown",
          ),
          payload: {
            ...(boundCanonicalPayload(payload).compatibility_payload as Record<
              string,
              unknown
            >),
            schema_version: 1,
          },
        });
      }
      continue;
    }

    // Ready files are bound from output_attachment_ids in finalize-success,
    // under user ownership/status locks. Provider candidates cannot create entities.
  }

  if (!sawText && finalText) {
    blocks.push({
      kind: "text",
      rawType: "result",
      text: finalText,
    });
  }

  return { blocks, error };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
