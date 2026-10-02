import type { Response } from "express";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseListenerBody(
  value: unknown,
): { listener_instance_id: string; dispatch_target: "claude_code" } | null {
  const record = exactRecord(value, ["listener_instance_id", "dispatch_target"]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || record.dispatch_target !== "claude_code"
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    dispatch_target: "claude_code",
  };
}

export function parseListenerOnlyBody(
  value: unknown,
): { listener_instance_id: string } | null {
  const record = exactRecord(value, ["listener_instance_id"]);
  if (!record || !isUuid(record.listener_instance_id)) return null;
  return { listener_instance_id: record.listener_instance_id };
}

export function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== keys.length
    || actualKeys.some((key) => !keys.includes(key))
  ) {
    return null;
  }
  return record;
}

export function parseReservationId(
  value: string | string[] | undefined,
): string | null {
  const id = Array.isArray(value) ? value[0] : value;
  return isUuid(id) ? id : null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function requireInternalUser(
  response: Response,
  userId: string | undefined,
): string | null {
  if (userId) return userId;
  response.status(401).json({
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "A valid internal credential is required.",
    },
  });
  return null;
}

export function sendInvalid(response: Response): void {
  response.status(400).json({
    success: false,
    error: {
      code: "INVALID_NATIVE_LIVE_RELAY_REQUEST",
      message: "Native live relay request is invalid.",
    },
  });
}
