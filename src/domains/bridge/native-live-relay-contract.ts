import {
  NativeLiveExecutionSelectionError,
  parseNativeLiveExecutionSelection,
  type NativeLiveExecutionSelection,
} from "./native-live-execution-selection.js";

export const NATIVE_LIVE_DISPATCH_TARGET = "claude_code" as const;

export type NativeLiveRelaySendRequest = {
  dispatch_target: "claude_code";
  request_id: string;
  operation: "send";
  conversation_id: string;
  expected_head_message_id: string | null;
  text: string;
  workspace_id?: string;
  execution?: NativeLiveExecutionSelection;
  attachment_ids?: string[];
};

export type NativeLiveRelayRetryRequest = {
  dispatch_target: "claude_code";
  request_id: string;
  operation: "retry";
  conversation_id: string;
  target_user_message_id: string;
  execution?: NativeLiveExecutionSelection;
};

export type NativeLiveRelayEditRequest = {
  dispatch_target: "claude_code";
  request_id: string;
  operation: "edit";
  conversation_id: string;
  target_user_message_id: string;
  text: string;
  execution?: NativeLiveExecutionSelection;
  attachment_ids?: string[];
};

export type NativeLiveRelayRequest =
  | NativeLiveRelaySendRequest
  | NativeLiveRelayRetryRequest
  | NativeLiveRelayEditRequest;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const MAX_TEXT_CHARS = 4_000;

export class NativeLiveRelayContractError extends Error {
  readonly code = "INVALID_NATIVE_LIVE_RELAY_REQUEST";

  constructor(message: string) {
    super(message);
    this.name = "NativeLiveRelayContractError";
  }
}

export function parseNativeLiveRelayRequest(value: unknown): NativeLiveRelayRequest {
  const body = requireRecord(value);
  if (body.dispatch_target !== NATIVE_LIVE_DISPATCH_TARGET) {
    throw new NativeLiveRelayContractError(
      "Native live relay requests must target Claude Code.",
    );
  }

  const requestId = requireUuid(body.request_id, "request_id");
  const conversationId = requireUuid(body.conversation_id, "conversation_id");
  const operation = body.operation;

  if (operation === "send") {
    requireExactKeys(body, [
      "dispatch_target",
      "request_id",
      "operation",
      "conversation_id",
      "expected_head_message_id",
      "text",
    ], ["execution", "workspace_id", "attachment_ids"]);
    const attachmentIds =
      body.attachment_ids === undefined
        ? []
        : parseAttachmentIds(body.attachment_ids);
    return {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation,
      conversation_id: conversationId,
      expected_head_message_id:
        body.expected_head_message_id === null
          ? null
          : requireUuid(body.expected_head_message_id, "expected_head_message_id"),
      text: normalizeText(
        body.text,
        attachmentIds.length > 0,
      ),
      ...(body.workspace_id === undefined
        ? {}
        : { workspace_id: requireUuid(body.workspace_id, "workspace_id") }),
      ...(body.execution === undefined
        ? {}
        : { execution: parseExecution(body.execution) }),
      ...(attachmentIds.length === 0
        ? {}
        : { attachment_ids: attachmentIds }),
    };
  }

  if (operation === "retry") {
    requireExactKeys(body, [
      "dispatch_target",
      "request_id",
      "operation",
      "conversation_id",
      "target_user_message_id",
    ], ["execution"]);
    return {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation,
      conversation_id: conversationId,
      target_user_message_id: requireUuid(
        body.target_user_message_id,
        "target_user_message_id",
      ),
      ...(body.execution === undefined
        ? {}
        : { execution: parseExecution(body.execution) }),
    };
  }

  if (operation === "edit") {
    requireExactKeys(body, [
      "dispatch_target",
      "request_id",
      "operation",
      "conversation_id",
      "target_user_message_id",
      "text",
    ], ["execution", "attachment_ids"]);
    return {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation,
      conversation_id: conversationId,
      target_user_message_id: requireUuid(
        body.target_user_message_id,
        "target_user_message_id",
      ),
      text: normalizeText(body.text, true),
      ...(body.execution === undefined
        ? {}
        : { execution: parseExecution(body.execution) }),
      ...(body.attachment_ids === undefined
        ? {}
        : {
            attachment_ids:
              parseAttachmentIds(body.attachment_ids),
          }),
    };
  }

  throw new NativeLiveRelayContractError("Native live relay operation is invalid.");
}


function parseAttachmentIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new NativeLiveRelayContractError(
      "attachment_ids must be an array containing at most 8 UUIDs.",
    );
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const id = requireUuid(
      item,
      "attachment_ids[" + index + "]",
    );
    if (seen.has(id)) {
      throw new NativeLiveRelayContractError(
        "attachment_ids must not contain duplicates.",
      );
    }
    seen.add(id);
    return id;
  });
}

function parseExecution(value: unknown): NativeLiveExecutionSelection {
  try {
    return parseNativeLiveExecutionSelection(value);
  } catch (error) {
    if (error instanceof NativeLiveExecutionSelectionError) {
      throw new NativeLiveRelayContractError(error.message);
    }
    throw error;
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NativeLiveRelayContractError(
      "Native live relay request must be an object.",
    );
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowedKeys = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new NativeLiveRelayContractError(
        `Unexpected native live relay field: ${key}`,
      );
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      throw new NativeLiveRelayContractError(
        `Missing native live relay field: ${key}`,
      );
    }
  }
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new NativeLiveRelayContractError(`${field} must be a UUID.`);
  }
  return value;
}

function normalizeText(
  value: unknown,
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    throw new NativeLiveRelayContractError("text must be a string.");
  }
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (
    text.length > MAX_TEXT_CHARS
    || (!allowEmpty && text.length === 0)
  ) {
    throw new NativeLiveRelayContractError(
      allowEmpty
        ? "text must contain at most 4000 characters."
        : "text must contain between 1 and 4000 characters.",
    );
  }
  return text;
}
