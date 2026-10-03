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
  const hiddenToolUseIds =
    collectHiddenTranscriptToolUseIds(events);
  const hiddenActivityToolUseIds =
    collectHiddenActivityToolUseIds(events);
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
      const canonicalPayload =
        stripToolUseDisplayMetadata(payload);
      const toolUseId =
        stringValue(canonicalPayload.tool_use_id);
      if (toolUseId && hiddenToolUseIds.has(toolUseId)) {
        canonicalPayload.hidden_from_transcript = true;
      }
      if (
        toolUseId
        && hiddenActivityToolUseIds.has(toolUseId)
      ) {
        canonicalPayload.hidden_from_activity = true;
      }

      blocks.push({
        kind: "tool_use",
        rawType: "tool_use",
        payload: canonicalPayload,
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

function collectHiddenActivityToolUseIds(
  events: readonly NativeLiveNormalizedEvent[],
): Set<string> {
  return collectTaskToolUseLineage(
    events,
    (payload) => payload.ambient === true,
  );
}

function collectHiddenTranscriptToolUseIds(
  events: readonly NativeLiveNormalizedEvent[],
): Set<string> {
  return collectTaskToolUseLineage(
    events,
    (payload) => payload.hidden_from_transcript === true,
  );
}

function collectTaskToolUseLineage(
  events: readonly NativeLiveNormalizedEvent[],
  matchesTask: (
    payload: Record<string, unknown>,
  ) => boolean,
): Set<string> {
  const collected = new Set<string>();

  for (const event of events) {
    if (event.type !== "task") continue;
    const payload = event.payload ?? {};
    if (!matchesTask(payload)) continue;
    const toolUseId = stringValue(payload.tool_use_id);
    if (toolUseId) {
      collected.add(toolUseId);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const event of events) {
      if (event.type !== "tool_use") continue;
      const payload = event.payload ?? {};
      const toolUseId = stringValue(payload.tool_use_id);
      const parentToolUseId =
        stringValue(payload.parent_tool_use_id);
      if (
        toolUseId
        && parentToolUseId
        && collected.has(parentToolUseId)
        && !collected.has(toolUseId)
      ) {
        collected.add(toolUseId);
        changed = true;
      }
    }
  }

  return collected;
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
