import type {
  NativeLiveContentBlockInput,
} from "./native-live-conversation-types.js";

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
  resume(
    sessionId: string,
    prompt: string,
  ): Promise<NativeLiveRuntimeResult>;
  fork(
    sessionId: string,
    prompt: string,
  ): Promise<NativeLiveRuntimeResult>;
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
        stringValue(payload.message)
        ?? stringValue(payload.code)
        ?? "Claude runtime emitted an error event.";
      continue;
    }

    if (event.type === "result") {
      if (payload.status === "error") {
        error =
          stringValue(payload.message)
          ?? "Claude runtime result reported an error.";
      }
      finalText =
        stringValue(payload.final_text) ?? finalText;
      continue;
    }

    if (event.type === "text") {
      const text = stringValue(payload.text);
      if (text) {
        sawText = true;
        blocks.push({
          kind: "text",
          rawType: "text",
          text,
        });
      }
      continue;
    }

    if (event.type === "tool_use") {
      blocks.push({
        kind: "tool_use",
        rawType: "tool_use",
        payload: stripToolUseDisplayMetadata(payload),
      });
      continue;
    }

    if (event.type === "tool_result") {
      blocks.push({
        kind: "tool_result",
        rawType: "tool_result",
        payload,
      });
      continue;
    }

    if (event.type === "attachment") {
      blocks.push({
        kind: "attachment",
        rawType: "attachment",
        payload,
      });
    }
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

function stripToolUseDisplayMetadata(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const {
    display_name: _displayName,
    server_display_name: _serverDisplayName,
    icon_url: _iconUrl,
    ...canonicalPayload
  } = payload;
  return canonicalPayload;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
