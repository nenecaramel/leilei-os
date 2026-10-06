import { backendConversationProjection, type TrustedConversationProjections } from "./native-live-conversation-content-projector.js";
import {
  boundCanonicalPayload,
} from "./native-live-content-contract.js";
import type { NativeLiveContentBlockInput } from "./native-live-conversation-types.js";

export type NativeLiveNormalizedEventType =
  | "session"
  | "text"
  | "partial_text"
  | "tool_use"
  | "tool_result"
  | "search_result"
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
  providerCheckpointId?: string | null;
  normalizedEvents: readonly NativeLiveNormalizedEvent[];
};

export interface NativeLiveClaudeRuntime {
  sendNew(prompt: string): Promise<NativeLiveRuntimeResult>;
  resume(sessionId: string, prompt: string): Promise<NativeLiveRuntimeResult>;
  fork(sessionId: string, prompt: string): Promise<NativeLiveRuntimeResult>;
}

export function canonicalizeNativeLiveEvents(
  events: readonly NativeLiveNormalizedEvent[],
  trustedProjections?: TrustedConversationProjections,
): {
  blocks: NativeLiveContentBlockInput[];
  error: string | null;
} {
  const blocks: NativeLiveContentBlockInput[] = [];
  // The conversation ledger backs both Chat content and historical Activity.
  const hiddenToolUseIds = collectHiddenTranscriptToolUseIds(events);
  const hiddenActivityToolUseIds = collectHiddenActivityToolUseIds(events);
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
      if (!backendConversationProjection(trustedProjections,event)) continue;
    }

    if (event.type === "search_result") {
      const provenance = payload.provenance as
        Record<string, unknown> | undefined;
      const structured = payload.structured as
        Record<string, unknown> | undefined;
      const parts =
        structured?.schema_version === 1
        && Array.isArray(structured.parts)
          ? structured.parts
          : [];

      const isTopLevel =
        !provenance?.parent_tool_use_id
        && !provenance?.parent_agent_id;
      const isSearchOnly =
        parts.length > 0
        && parts.every((part) =>
          Boolean(
            part
            && typeof part === "object"
            && !Array.isArray(part)
            && (part as Record<string, unknown>).type === "search_result",
          )
        );

      if (isTopLevel && isSearchOnly) {
        blocks.push({
          kind: "canonical_tool_result",
          rawType: "search_result",
          payload: {
            schema_version: 1,
            identity: "canonical_tool_result",
            refs: [],
            projection_reason: "provider_visible_search",
            provenance: boundCanonicalPayload(
              payload.provenance ?? {
                provider: "claude_code",
                raw_type: "search_result",
              },
            ).compatibility_payload,
            structured: boundCanonicalPayload(structured),
          },
        });
      }
      continue;
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

    if (event.type === "tool_use") {
      const canonicalPayload = stripToolUseDisplayMetadata(payload);
      const toolUseId = stringValue(canonicalPayload.tool_use_id);
      if (toolUseId && hiddenToolUseIds.has(toolUseId)) {
        canonicalPayload.hidden_from_transcript = true;
      }
      if (toolUseId && hiddenActivityToolUseIds.has(toolUseId)) {
        canonicalPayload.hidden_from_activity = true;
      }
      blocks.push({ kind: "tool_use", rawType: "tool_use", payload: canonicalPayload });
      continue;
    }

    if (event.type === "tool_result") {
      // Durable execution evidence is separate from an optional Chat projection.
      // #813 question enrichment applies to these same rows at finalization.
      blocks.push({ kind: "tool_result", rawType: "tool_result", payload });
    }

    if (
      event.type === "tool_result" ||
      event.type === "runtime" ||
      event.type === "result"
    ) {
      const authorization = backendConversationProjection(trustedProjections,event);
      const projection = authorization?.projection;
      const toolID = stringValue(payload.tool_use_id);
      const provenance = payload.provenance as Record<string,unknown> | undefined;
      const suppressed = payload.hidden_from_transcript === true || payload.hidden_from_activity === true
        || (toolID != null && (hiddenToolUseIds.has(toolID) || hiddenActivityToolUseIds.has(toolID)))
        || Boolean(payload.parent_tool_use_id || payload.parent_agent_id || provenance?.parent_tool_use_id || provenance?.parent_agent_id)
        || events.some(e => e.type === "tool_use" && e.payload?.tool_use_id === toolID && e.payload?.tool_name === "AskUserQuestion");
      if (projection && !suppressed) {
        const bounded = boundCanonicalPayload(
          payload.structured ?? (payload.structured_output
            ? {schema_version:1,parts:[{type:"structured_output",value:(payload.structured_output as Record<string,unknown>).payload}],
               truncated:(payload.structured_output as Record<string,unknown>).truncated === true,
               redacted:(payload.structured_output as Record<string,unknown>).redacted === true}
            : {schema_version:1,parts:[{type:"json",value:payload.output}],truncated:false,redacted:false}),
        );
        blocks.push({
          kind: projection.identity,
          rawType: event.type,
          payload: {
            schema_version: 1,
            identity: projection.identity,
            refs: projection.refs,
            projection_reason: projection.reason,
            materialized_attachments: authorization?.attachments ?? [],
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
