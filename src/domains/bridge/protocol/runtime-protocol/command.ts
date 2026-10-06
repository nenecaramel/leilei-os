import {
  NativeLiveExecutionSelectionError,
  parseNativeLiveExecutionSelection,
  type NativeLiveExecutionSelection,
} from "../../turn/native-live-execution-selection.js";
import {
  type NativeLiveRuntimeCommand,
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
    "expected_working_directory",
    "attachments",
    "output_attachments_enabled",
    "parent_provider_checkpoint_id",
  ]);

  if (body.output_attachments_enabled !== undefined && typeof body.output_attachments_enabled !== "boolean") {
    throw new NativeLiveRuntimeProtocolError("Output attachment capability must be boolean.");
  }
  const protocolVersion = parseProtocolVersion(
    body.protocol_version,
  );
  if (body.dispatch_target !== "claude_code") {
    throw new NativeLiveRuntimeProtocolError("Runtime command target must be Claude Code.");
  }
  const operation = body.operation;
  if (operation !== "send" && operation !== "retry" && operation !== "edit" && operation !== "wake") {
    throw new NativeLiveRuntimeProtocolError("Runtime operation is invalid.");
  }
  const runtimeMode = body.runtime_mode;
  if (runtimeMode !== "new" && runtimeMode !== "fork" && runtimeMode !== "resume") {
    throw new NativeLiveRuntimeProtocolError("Runtime mode is invalid.");
  }

  const parentProviderSessionId =
    body.parent_provider_session_id === null
      ? null
      : requireNonblank(body.parent_provider_session_id, "parent_provider_session_id");
  if (protocolVersion < 4 && (runtimeMode === "resume" || body.parent_provider_checkpoint_id !== undefined)) {
    throw new NativeLiveRuntimeProtocolError("Runtime checkpoints/resume require protocol v4.");
  }
  const parentProviderCheckpointId = body.parent_provider_checkpoint_id == null
    ? null : requireUuid(body.parent_provider_checkpoint_id, "parent_provider_checkpoint_id");
  if (runtimeMode === "new" && parentProviderCheckpointId !== null) {
    throw new NativeLiveRuntimeProtocolError("New runtime command cannot include a parent checkpoint.");
  }
  if (runtimeMode === "resume" && parentProviderCheckpointId === null) {
    throw new NativeLiveRuntimeProtocolError("Resume runtime command requires a parent checkpoint.");
  }
  const expectedWorkingDirectory =
    body.expected_working_directory === undefined
      || body.expected_working_directory === null
      ? null
      : requireNonblank(
          body.expected_working_directory,
          "expected_working_directory",
        );

  if (runtimeMode === "new" && parentProviderSessionId !== null) {
    throw new NativeLiveRuntimeProtocolError(
      "New runtime command must not include a parent provider session.",
    );
  }
  if (runtimeMode !== "new" && parentProviderSessionId === null) {
    throw new NativeLiveRuntimeProtocolError(
      "Fork runtime command requires a parent provider session.",
    );
  }
  if (operation === "wake" && runtimeMode !== "fork") {
    throw new NativeLiveRuntimeProtocolError(
      "Wake runtime command must fork the current provider session.",
    );
  }

  return {
    protocol_version: protocolVersion,
    ...(body.output_attachments_enabled !== undefined ? { output_attachments_enabled: body.output_attachments_enabled as boolean } : {}),
    dispatch_target: "claude_code",
    prepare_id: requireUuid(body.prepare_id, "prepare_id"),
    request_id: requireUuid(body.request_id, "request_id"),
    operation,
    conversation_id: requireUuid(body.conversation_id, "conversation_id"),
    canonical_user_message_id:
      operation === "wake"
        ? (
            body.canonical_user_message_id === null
              ? null
              : (() => {
                  throw new NativeLiveRuntimeProtocolError(
                    "Wake runtime command must not include a canonical user message.",
                  );
                })()
          )
        : requireUuid(
            body.canonical_user_message_id,
            "canonical_user_message_id",
          ),
    runtime_mode: runtimeMode,
    parent_provider_session_id: parentProviderSessionId,
    expected_working_directory: expectedWorkingDirectory,
    ...(protocolVersion >= 4 ? { parent_provider_checkpoint_id: parentProviderCheckpointId } : {}),
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
