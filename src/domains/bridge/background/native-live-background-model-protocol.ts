export const NATIVE_LIVE_BACKGROUND_MODEL_PROTOCOL_VERSION = 1 as const;

export const NATIVE_LIVE_BACKGROUND_MODEL_TASK_KINDS = [
  "proactivity_deliberate",
] as const;

export type NativeLiveBackgroundModelTaskKind =
  (typeof NATIVE_LIVE_BACKGROUND_MODEL_TASK_KINDS)[number];

export type NativeLiveBackgroundModelCommand = {
  protocol_version: 1;
  task_id: string;
  task_kind: NativeLiveBackgroundModelTaskKind;
  prompt_contract_version: string;
  prompt: string;
};

export type NativeLiveBackgroundModelFailureCode =
  | "CLAUDE_PROCESS_FAILED"
  | "MALFORMED_STREAM"
  | "ABORTED"
  | "RUNTIME_UNAVAILABLE"
  | "TOOL_USE_FORBIDDEN"
  | "RUNTIME_OUTPUT_ERROR";

export type NativeLiveBackgroundModelExecutionResult =
  | {
      protocol_version: 1;
      task_id: string;
      task_kind: NativeLiveBackgroundModelTaskKind;
      status: "success";
      final_text: string;
    }
  | {
      protocol_version: 1;
      task_id: string;
      task_kind: NativeLiveBackgroundModelTaskKind;
      status: "failure";
      error_code: NativeLiveBackgroundModelFailureCode;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PROMPT_CHARS = 16_000;
const MAX_PROMPT_CONTRACT_VERSION_CHARS = 128;
export const MAX_BACKGROUND_MODEL_OUTPUT_CHARS = 4_000;

export class NativeLiveBackgroundModelProtocolError extends Error {
  readonly code = "INVALID_NATIVE_LIVE_BACKGROUND_MODEL_PROTOCOL";

  constructor(message: string) {
    super(message);
    this.name = "NativeLiveBackgroundModelProtocolError";
  }
}

export function parseNativeLiveBackgroundModelCommand(
  value: unknown,
): NativeLiveBackgroundModelCommand {
  const body = requireRecord(value);
  requireExactKeys(body, [
    "protocol_version",
    "task_id",
    "task_kind",
    "prompt_contract_version",
    "prompt",
  ]);

  if (
    body.protocol_version
    !== NATIVE_LIVE_BACKGROUND_MODEL_PROTOCOL_VERSION
  ) {
    throw new NativeLiveBackgroundModelProtocolError(
      "Unsupported background model protocol version.",
    );
  }
  if (!isTaskKind(body.task_kind)) {
    throw new NativeLiveBackgroundModelProtocolError(
      "Background model task kind is invalid.",
    );
  }

  return {
    protocol_version: NATIVE_LIVE_BACKGROUND_MODEL_PROTOCOL_VERSION,
    task_id: requireUuid(body.task_id, "task_id"),
    task_kind: body.task_kind,
    prompt_contract_version: requireBoundedNonblank(
      body.prompt_contract_version,
      "prompt_contract_version",
      MAX_PROMPT_CONTRACT_VERSION_CHARS,
    ),
    prompt: requireBoundedNonblank(
      body.prompt,
      "prompt",
      MAX_PROMPT_CHARS,
    ).replace(/\r\n?/g, "\n"),
  };
}

export function parseNativeLiveBackgroundModelExecutionResult(
  value: unknown,
): NativeLiveBackgroundModelExecutionResult {
  const body = requireRecord(value);

  if (body.status === "success") {
    requireExactKeys(body, [
      "protocol_version",
      "task_id",
      "task_kind",
      "status",
      "final_text",
    ]);
    requireVersion(body.protocol_version);
    if (!isTaskKind(body.task_kind)) {
      throw new NativeLiveBackgroundModelProtocolError(
        "Background model result task kind is invalid.",
      );
    }
    return {
      protocol_version: NATIVE_LIVE_BACKGROUND_MODEL_PROTOCOL_VERSION,
      task_id: requireUuid(body.task_id, "task_id"),
      task_kind: body.task_kind,
      status: "success",
      final_text: requireBoundedNonblank(
        body.final_text,
        "final_text",
        MAX_BACKGROUND_MODEL_OUTPUT_CHARS,
      ).replace(/\r\n?/g, "\n"),
    };
  }

  if (body.status === "failure") {
    requireExactKeys(body, [
      "protocol_version",
      "task_id",
      "task_kind",
      "status",
      "error_code",
    ]);
    requireVersion(body.protocol_version);
    if (!isTaskKind(body.task_kind)) {
      throw new NativeLiveBackgroundModelProtocolError(
        "Background model result task kind is invalid.",
      );
    }
    if (!isFailureCode(body.error_code)) {
      throw new NativeLiveBackgroundModelProtocolError(
        "Background model failure code is invalid.",
      );
    }
    return {
      protocol_version: NATIVE_LIVE_BACKGROUND_MODEL_PROTOCOL_VERSION,
      task_id: requireUuid(body.task_id, "task_id"),
      task_kind: body.task_kind,
      status: "failure",
      error_code: body.error_code,
    };
  }

  throw new NativeLiveBackgroundModelProtocolError(
    "Background model result status is invalid.",
  );
}

export function assertBackgroundModelResultMatchesCommand(
  command: NativeLiveBackgroundModelCommand,
  result: NativeLiveBackgroundModelExecutionResult,
): void {
  if (
    result.task_id !== command.task_id
    || result.task_kind !== command.task_kind
  ) {
    throw new NativeLiveBackgroundModelProtocolError(
      "Background model result does not match command identity.",
    );
  }
}

function requireVersion(value: unknown): void {
  if (
    value !== NATIVE_LIVE_BACKGROUND_MODEL_PROTOCOL_VERSION
  ) {
    throw new NativeLiveBackgroundModelProtocolError(
      "Unsupported background model protocol version.",
    );
  }
}

function isTaskKind(
  value: unknown,
): value is NativeLiveBackgroundModelTaskKind {
  return (
    typeof value === "string"
    && (NATIVE_LIVE_BACKGROUND_MODEL_TASK_KINDS as readonly string[])
      .includes(value)
  );
}

function isFailureCode(
  value: unknown,
): value is NativeLiveBackgroundModelFailureCode {
  return (
    value === "CLAUDE_PROCESS_FAILED"
    || value === "MALFORMED_STREAM"
    || value === "ABORTED"
    || value === "RUNTIME_UNAVAILABLE"
    || value === "TOOL_USE_FORBIDDEN"
    || value === "RUNTIME_OUTPUT_ERROR"
  );
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NativeLiveBackgroundModelProtocolError(
      "Background model protocol payload must be an object.",
    );
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new NativeLiveBackgroundModelProtocolError(
        `Unexpected background model protocol field: ${key}`,
      );
    }
  }
  for (const key of allowed) {
    if (!(key in value)) {
      throw new NativeLiveBackgroundModelProtocolError(
        `Missing background model protocol field: ${key}`,
      );
    }
  }
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new NativeLiveBackgroundModelProtocolError(
      `${field} must be a UUID.`,
    );
  }
  return value;
}

function requireBoundedNonblank(
  value: unknown,
  field: string,
  maxChars: number,
): string {
  if (typeof value !== "string") {
    throw new NativeLiveBackgroundModelProtocolError(
      `${field} must be a string.`,
    );
  }
  const normalized = value.trim();
  if (
    normalized.length === 0
    || [...normalized].length > maxChars
  ) {
    throw new NativeLiveBackgroundModelProtocolError(
      `${field} must contain between 1 and ${maxChars} characters.`,
    );
  }
  return normalized;
}
