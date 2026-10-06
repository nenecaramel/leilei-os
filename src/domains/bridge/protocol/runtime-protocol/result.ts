import type { NativeLiveNormalizedEvent } from "../../../conversation/native-live-conversation-orchestrator.js";
import {
  type NativeLiveRuntimeExecutionResult,
  NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
  type NativeLiveRuntimeCommand,
  type NativeLiveRuntimeMetadata,
  type NativeLiveRuntimeFailureCode,
  type NativeLiveRuntimeOutputAttachmentMetadata,
} from "./types.js";
import {
  requireRecord,
  requireExactKeys,
  parseProtocolVersion,
  NativeLiveRuntimeProtocolError,
  requireUuid,
  requireNonblank,
} from "./parsing.js";
import {
  parseContextUsage,
  parseExecutionMetadata,
  parseNativeLiveRuntimeResultTelemetry,
} from "./telemetry.js";
import { parseNativeLiveRuntimeEnvironment } from "./environment.js";
import { parseNativeLiveRuntimeOutputResources } from "./resources.js";
import { parseNativeLiveRuntimeVcsChanges } from "./vcs.js";
import { parseNativeLiveRuntimeSessionStoreHealth } from "./session-store.js";

export function parseNativeLiveRuntimeExecutionResult(
  value: unknown,
): NativeLiveRuntimeExecutionResult {
  const body = requireRecord(value);
  const status = body.status;

  if (status === "success") {
    requireExactKeys(
      body,
      [
        "protocol_version",
        "prepare_id",
        "request_id",
        "conversation_id",
        "status",
        "provider_session_id",
        "normalized_events",
      ],
      [
        "runtime_metadata",
        "effective_working_directory",
        "output_attachment_ids",
        "output_attachment_metadata",
      ],
    );

    const protocolVersion = parseProtocolVersion(
      body.protocol_version,
    );
    if (!Array.isArray(body.normalized_events)) {
      throw new NativeLiveRuntimeProtocolError("normalized_events must be an array.");
    }
    if (
      (
        body.output_attachment_ids !== undefined
        || body.output_attachment_metadata !== undefined
      )
      && protocolVersion !== NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION
    ) {
      throw new NativeLiveRuntimeProtocolError(
        "output attachment fields require runtime protocol v3.",
      );
    }
    const outputAttachmentIds =
      body.output_attachment_ids === undefined
        ? undefined
        : parseRuntimeOutputAttachmentIds(
            body.output_attachment_ids,
          );
    const outputAttachmentMetadata =
      body.output_attachment_metadata === undefined
        ? undefined
        : parseRuntimeOutputAttachmentMetadata(
            body.output_attachment_metadata,
            outputAttachmentIds ?? [],
          );

    return {
      protocol_version: protocolVersion,
      prepare_id: requireUuid(body.prepare_id, "prepare_id"),
      request_id: requireUuid(body.request_id, "request_id"),
      conversation_id: requireUuid(body.conversation_id, "conversation_id"),
      status,
      provider_session_id: requireNonblank(
        body.provider_session_id,
        "provider_session_id",
      ),
      effective_working_directory:
        body.effective_working_directory === undefined
          || body.effective_working_directory === null
          ? null
          : requireNonblank(
              body.effective_working_directory,
              "effective_working_directory",
            ),
      normalized_events:
        body.normalized_events as NativeLiveNormalizedEvent[],
      ...(outputAttachmentIds === undefined
        ? {}
        : { output_attachment_ids: outputAttachmentIds }),
      ...(outputAttachmentMetadata === undefined
        ? {}
        : {
            output_attachment_metadata:
              outputAttachmentMetadata,
          }),
      ...(
        body.runtime_metadata === undefined
          ? {}
          : {
              runtime_metadata:
                body.runtime_metadata === null
                  ? null
                  : parseRuntimeMetadata(body.runtime_metadata),
            }
      ),
    };
  }

  if (status === "failure") {
    requireExactKeys(
      body,
      [
        "protocol_version",
        "prepare_id",
        "request_id",
        "conversation_id",
        "status",
        "error_code",
      ],
      ["runtime_metadata"],
    );

    const protocolVersion = parseProtocolVersion(
      body.protocol_version,
    );
    if (!isFailureCode(body.error_code)) {
      throw new NativeLiveRuntimeProtocolError("Runtime failure code is invalid.");
    }

    return {
      protocol_version: protocolVersion,
      prepare_id: requireUuid(body.prepare_id, "prepare_id"),
      request_id: requireUuid(body.request_id, "request_id"),
      conversation_id: requireUuid(body.conversation_id, "conversation_id"),
      status,
      error_code: body.error_code,
      ...(body.runtime_metadata === undefined
        ? {}
        : {
            runtime_metadata:
              body.runtime_metadata === null
                ? null
                : parseRuntimeMetadata(body.runtime_metadata),
          }),
    };
  }

  throw new NativeLiveRuntimeProtocolError("Runtime result status is invalid.");
}

export function assertRuntimeResultMatchesCommand(
  command: NativeLiveRuntimeCommand,
  result: NativeLiveRuntimeExecutionResult,
): void {
  if (result.protocol_version !== command.protocol_version) {
    throw new NativeLiveRuntimeProtocolError(
      "Runtime result protocol version does not match the command.",
    );
  }
  if (
    result.prepare_id !== command.prepare_id
    || result.request_id !== command.request_id
    || result.conversation_id !== command.conversation_id
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Runtime result does not match the prepared command identity.",
    );
  }

  if (
    result.status === "success"
    && command.expected_working_directory !== null
    && result.effective_working_directory !== command.expected_working_directory
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Runtime result working directory does not match the prepared command.",
    );
  }

  if (
    result.status === "success"
    && command.runtime_mode === "fork"
    && result.provider_session_id === command.parent_provider_session_id
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Fork result must use a new provider session id.",
    );
  }
}

function parseRuntimeOutputAttachmentIds(
  value: unknown,
): string[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new NativeLiveRuntimeProtocolError(
      "output_attachment_ids must contain at most 8 items.",
    );
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const id = requireUuid(
      item,
      "output_attachment_ids[" + index + "]",
    );
    if (seen.has(id)) {
      throw new NativeLiveRuntimeProtocolError(
        "output_attachment_ids must not contain duplicates.",
      );
    }
    seen.add(id);
    return id;
  });
}

function parseRuntimeOutputAttachmentMetadata(
  value: unknown,
  outputAttachmentIds: readonly string[],
): NativeLiveRuntimeOutputAttachmentMetadata[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new NativeLiveRuntimeProtocolError(
      "output_attachment_metadata must contain at most 8 items.",
    );
  }
  const allowed = new Set(outputAttachmentIds);
  const seen = new Set<string>();
  return value.map((item, index) => {
    const body = requireRecord(item);
    requireExactKeys(
      body,
      ["attachment_id", "duration_seconds"],
    );
    const attachmentId = requireUuid(
      body.attachment_id,
      "output_attachment_metadata[" + index + "].attachment_id",
    );
    if (!allowed.has(attachmentId)) {
      throw new NativeLiveRuntimeProtocolError(
        "output_attachment_metadata attachment_id must belong to output_attachment_ids.",
      );
    }
    if (seen.has(attachmentId)) {
      throw new NativeLiveRuntimeProtocolError(
        "output_attachment_metadata must not contain duplicate attachment ids.",
      );
    }
    seen.add(attachmentId);
    const durationSeconds = body.duration_seconds;
    if (
      typeof durationSeconds !== "number"
      || !Number.isFinite(durationSeconds)
      || durationSeconds <= 0
    ) {
      throw new NativeLiveRuntimeProtocolError(
        "output_attachment_metadata duration_seconds must be finite and positive.",
      );
    }
    return {
      attachment_id: attachmentId,
      duration_seconds: durationSeconds,
    };
  });
}

function parseRuntimeMetadata(
  value: unknown,
): NativeLiveRuntimeMetadata {
  const body = requireRecord(value);
  requireExactKeys(
    body,
    ["context_usage"],
    [
      "execution",
      "environment",
      "result",
      "output_resources",
      "vcs_changes",
      "session_store",
    ],
  );

  return {
    context_usage:
      body.context_usage === null
        ? null
        : parseContextUsage(body.context_usage),
    ...(body.execution === undefined
      ? {}
      : {
          execution:
            body.execution === null
              ? null
              : parseExecutionMetadata(body.execution),
        }),
    ...(body.environment === undefined
      ? {}
      : {
          environment:
            body.environment === null
              ? null
              : parseNativeLiveRuntimeEnvironment(body.environment),
        }),
    ...(body.result === undefined
      ? {}
      : {
          result:
            body.result === null
              ? null
              : parseNativeLiveRuntimeResultTelemetry(body.result),
        }),
    ...(body.output_resources === undefined
      ? {}
      : {
          output_resources:
            parseNativeLiveRuntimeOutputResources(
              body.output_resources,
            ),
        }),
    ...(body.vcs_changes === undefined
      ? {}
      : {
          vcs_changes:
            parseNativeLiveRuntimeVcsChanges(
              body.vcs_changes,
            ),
        }),
    ...(body.session_store === undefined
      ? {}
      : {
          session_store:
            body.session_store === null
              ? null
              : parseNativeLiveRuntimeSessionStoreHealth(
                  body.session_store,
                ),
        }),
  };
}

function isFailureCode(value: unknown): value is NativeLiveRuntimeFailureCode {
  return (
    value === "CLAUDE_PROCESS_FAILED"
    || value === "MALFORMED_STREAM"
    || value === "ABORTED"
    || value === "INTERRUPTED"
    || value === "NO_PROVIDER_SESSION"
    || value === "PROVIDER_SESSION_CONFLICT"
    || value === "WORKING_DIRECTORY_UNAVAILABLE"
    || value === "WORKING_DIRECTORY_MISMATCH"
    || value === "ATTACHMENT_UNAVAILABLE"
    || value === "RUNTIME_UNAVAILABLE"
  );
}
