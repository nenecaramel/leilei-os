import {
  NativeLiveExecutionSelectionError,
  parseNativeLiveExecutionSelection,
  type NativeLiveExecutionSelection,
} from "../../turn/native-live-execution-selection.js";
import {
  type NativeLiveRuntimeCommand,
  NATIVE_LIVE_RUNTIME_LEGACY_PROTOCOL_VERSION,
  NATIVE_LIVE_RUNTIME_ATTACHMENT_PROTOCOL_VERSION,
  type NativeLiveRuntimeAttachment,
} from "./types.js";
import {
  requireRecord,
  requireExactKeys,
  parseProtocolVersion,
  NativeLiveRuntimeProtocolError,
  requireNonblank,
  requireUuid,
} from "./parsing.js";

const MAX_PROMPT_CHARS = 16_000;

export function parseNativeLiveRuntimeCommand(
  value: unknown,
): NativeLiveRuntimeCommand {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "protocol_version",
    "dispatch_target",
    "prepare_id",
    "request_id",
    "operation",
    "conversation_id",
    "canonical_user_message_id",
    "runtime_mode",
    "parent_provider_session_id",
    "prompt",
  ], [
    "execution_selection",
    "workspace_id",
    "expected_workspace_root",
    "attachments",
  ]);

  const protocolVersion = parseProtocolVersion(
    body.protocol_version,
  );
  if (
    protocolVersion === NATIVE_LIVE_RUNTIME_LEGACY_PROTOCOL_VERSION
    && body.attachments !== undefined
  ) {
    throw new NativeLiveRuntimeProtocolError(
      "Runtime protocol v1 does not support attachments.",
    );
  }
  if (body.dispatch_target !== "claude_code") {
    throw new NativeLiveRuntimeProtocolError("Runtime command target must be Claude Code.");
  }
  const operation = body.operation;
  if (operation !== "send" && operation !== "retry" && operation !== "edit") {
    throw new NativeLiveRuntimeProtocolError("Runtime operation is invalid.");
  }
  const runtimeMode = body.runtime_mode;
  if (runtimeMode !== "new" && runtimeMode !== "fork") {
    throw new NativeLiveRuntimeProtocolError("Runtime mode is invalid.");
  }

  const parentProviderSessionId =
    body.parent_provider_session_id === null
      ? null
      : requireNonblank(body.parent_provider_session_id, "parent_provider_session_id");
  const workspaceId =
    body.workspace_id === undefined || body.workspace_id === null
      ? null
      : requireUuid(body.workspace_id, "workspace_id");
  const expectedWorkspaceRoot =
    body.expected_workspace_root === undefined
      || body.expected_workspace_root === null
      ? null
      : requireNonblank(
          body.expected_workspace_root,
          "expected_workspace_root",
        );

  if (runtimeMode === "new" && parentProviderSessionId !== null) {
    throw new NativeLiveRuntimeProtocolError(
      "New runtime command must not include a parent provider session.",
    );
  }
  if (runtimeMode === "fork" && parentProviderSessionId === null) {
    throw new NativeLiveRuntimeProtocolError(
      "Fork runtime command requires a parent provider session.",
    );
  }

  return {
    protocol_version: protocolVersion,
    dispatch_target: "claude_code",
    prepare_id: requireUuid(body.prepare_id, "prepare_id"),
    request_id: requireUuid(body.request_id, "request_id"),
    operation,
    conversation_id: requireUuid(body.conversation_id, "conversation_id"),
    canonical_user_message_id: requireUuid(
      body.canonical_user_message_id,
      "canonical_user_message_id",
    ),
    runtime_mode: runtimeMode,
    parent_provider_session_id: parentProviderSessionId,
    workspace_id: workspaceId,
    expected_workspace_root: expectedWorkspaceRoot,
    execution_selection:
      body.execution_selection === undefined
        || body.execution_selection === null
        ? null
        : parseExecutionSelection(
            body.execution_selection,
          ),
    ...(protocolVersion >= NATIVE_LIVE_RUNTIME_ATTACHMENT_PROTOCOL_VERSION
      ? {
          attachments:
            body.attachments === undefined
              ? []
              : parseRuntimeAttachments(body.attachments),
        }
      : {}),
    prompt: normalizePrompt(body.prompt),
  };
}

function parseRuntimeAttachments(
  value: unknown,
): NativeLiveRuntimeAttachment[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new NativeLiveRuntimeProtocolError(
      "attachments must be an array containing at most 8 items.",
    );
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const body = requireRecord(item);
    requireExactKeys(body, [
      "attachment_id",
      "filename",
      "mime_type",
      "size_bytes",
      "sha256",
      "kind",
    ]);
    const attachmentId = requireUuid(
      body.attachment_id,
      "attachments[" + index + "].attachment_id",
    );
    if (seen.has(attachmentId)) {
      throw new NativeLiveRuntimeProtocolError(
        "attachments must not contain duplicate ids.",
      );
    }
    seen.add(attachmentId);
    const filename = requireNonblank(
      body.filename,
      "attachments[" + index + "].filename",
    );
    const mimeType = requireNonblank(
      body.mime_type,
      "attachments[" + index + "].mime_type",
    );
    if (
      typeof body.size_bytes !== "number"
      || !Number.isSafeInteger(body.size_bytes)
      || body.size_bytes <= 0
    ) {
      throw new NativeLiveRuntimeProtocolError(
        "attachment size_bytes must be a positive safe integer.",
      );
    }
    if (
      typeof body.sha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(body.sha256)
    ) {
      throw new NativeLiveRuntimeProtocolError(
        "attachment sha256 must be lowercase hex.",
      );
    }
    if (body.kind !== "image" && body.kind !== "file") {
      throw new NativeLiveRuntimeProtocolError(
        "attachment kind must be image or file.",
      );
    }
    return {
      attachment_id: attachmentId,
      filename,
      mime_type: mimeType,
      size_bytes: body.size_bytes,
      sha256: body.sha256,
      kind: body.kind,
    };
  });
}

function parseExecutionSelection(
  value: unknown,
): NativeLiveExecutionSelection {
  try {
    return parseNativeLiveExecutionSelection(value);
  } catch (error) {
    if (error instanceof NativeLiveExecutionSelectionError) {
      throw new NativeLiveRuntimeProtocolError(error.message);
    }
    throw error;
  }
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== "string") {
    throw new NativeLiveRuntimeProtocolError("prompt must be a string.");
  }
  const prompt = value.replace(/\r\n?/g, "\n").trim();
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_CHARS) {
    throw new NativeLiveRuntimeProtocolError(
      "prompt must contain between 1 and 16000 characters.",
    );
  }
  return prompt;
}
