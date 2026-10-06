import {
  NATIVE_LIVE_RUNTIME_ATTACHMENT_PROTOCOL_VERSION,
  NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
} from "./types.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class NativeLiveRuntimeProtocolError extends Error {
  readonly code = "INVALID_NATIVE_LIVE_RUNTIME_PROTOCOL";

  constructor(message: string) {
    super(message);
    this.name = "NativeLiveRuntimeProtocolError";
  }
}

export function parseProtocolVersion(value: unknown): 4 {
  if (value !== NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION) {
    throw new NativeLiveRuntimeProtocolError("Unsupported runtime protocol version.");
  }
  return value;
}

export function requireBoundedNonblank(
  value: unknown,
  field: string,
  maxChars: number,
): string {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > maxChars
  ) {
    throw new NativeLiveRuntimeProtocolError(
      `${field} must be a nonblank string of at most ${maxChars} characters.`,
    );
  }
  return value;
}

export function parseBoundedJsonRecord(
  value: unknown,
  field: string,
  maxChars: number,
): Record<string, unknown> | null {
  if (value === null) return null;
  const body = requireRecord(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    throw new NativeLiveRuntimeProtocolError(
      `${field} must be JSON serializable.`,
    );
  }
  if (serialized.length > maxChars) {
    throw new NativeLiveRuntimeProtocolError(
      `${field} exceeds ${maxChars} characters.`,
    );
  }
  return body;
}

export function boundedNullableString(
  value: unknown,
  field: string,
  maxChars: number,
): string | null {
  const parsed = nullableString(value, field);
  if (parsed !== null && parsed.length > maxChars) {
    throw new NativeLiveRuntimeProtocolError(
      `${field} exceeds ${maxChars} characters.`,
    );
  }
  return parsed;
}

export function boundedStringList(
  value: unknown,
  field: string,
  maxItems: number,
  maxChars: number,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new NativeLiveRuntimeProtocolError(
      `${field} must contain at most ${maxItems} strings.`,
    );
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.length > maxChars) {
      throw new NativeLiveRuntimeProtocolError(
        `${field}[${index}] must be a string of at most ${maxChars} characters.`,
      );
    }
    return item;
  });
}

export function nullableFiniteNumber(
  value: unknown,
  field: string,
): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new NativeLiveRuntimeProtocolError(
      `${field} must be finite or null.`,
    );
  }
  return value;
}

export function nullableString(
  value: unknown,
  field: string,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new NativeLiveRuntimeProtocolError(
      `${field} must be a string or null.`,
    );
  }
  return value;
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NativeLiveRuntimeProtocolError("Runtime protocol payload must be an object.");
  }
  return value as Record<string, unknown>;
}

export function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowedKeys = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new NativeLiveRuntimeProtocolError(
        `Unexpected runtime protocol field: ${key}`,
      );
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      throw new NativeLiveRuntimeProtocolError(
        `Missing runtime protocol field: ${key}`,
      );
    }
  }
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new NativeLiveRuntimeProtocolError(`${field} must be a UUID.`);
  }
  return value;
}

export function requireNonblank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NativeLiveRuntimeProtocolError(`${field} must be nonblank.`);
  }
  return value;
}
