import type { NativeLiveNormalizedEvent } from "../../../conversation/native-live-conversation-orchestrator.js";
import {
  type NativeLiveRuntimeExecutionResult,
  NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
  type NativeLiveRuntimeCommand,
  type NativeLiveRuntimeMetadata,
  type NativeLiveRuntimeFailureCode,
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
        "workspace_id",
        "effective_workspace_root",
        "output_attachment_ids",
      ],
    );

    const protocolVersion = parseProtocolVersion(
      body.protocol_version,
    );
    if (!Array.isArray(body.normalized_events)) {
      throw new NativeLiveRuntimeProtocolError("normalized_events must be an array.");
    }
    if (
      body.output_attachment_ids !== undefined
      && protocolVersion !== NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION
    ) {
      throw new NativeLiveRuntimeProtocolError(
        "output_attachment_ids require runtime protocol v3.",
      );
    }

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
      workspace_id:
        body.workspace_id === undefined || body.workspace_id === null
          ? null
          : requireUuid(body.workspace_id, "workspace_id"),
      effective_workspace_root:
        body.effective_workspace_root === undefined
          || body.effective_workspace_root === null
          ? null
          : requireNonblank(
              body.effective_workspace_root,
              "effective_workspace_root",
            ),
      normalized_events:
        body.normalized_events as NativeLiveNormalizedEvent[],
      ...(body.output_attachment_ids === undefined
        ? {}
        : {
            output_attachment_ids:
              parseRuntimeOutputAttachmentIds(
                body.output_attachment_ids,
              ),
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
    && command.workspace_id !== null
    && (
      result.workspace_id !== command.workspace_id
      || result.effective_workspace_root === null
    )
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Runtime result workspace does not match the prepared command.",
    );
  }

  if (
    result.status === "success"
    && command.expected_workspace_root !== null
    && result.effective_workspace_root !== command.expected_workspace_root
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Runtime result workspace root does not match the prepared command.",
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
    || value === "WORKSPACE_UNAVAILABLE"
    || value === "WORKSPACE_ROOT_MISMATCH"
    || value === "ATTACHMENT_UNAVAILABLE"
    || value === "RUNTIME_UNAVAILABLE"
  );
}
