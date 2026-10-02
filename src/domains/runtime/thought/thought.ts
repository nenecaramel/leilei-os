/**
 * Thought is the only always-present Mind state. It carries whatever the
 * subject is currently holding: something wanted, wondered about, or being
 * turned over.
 *
 * The lifecycle is deliberately just `active` or `dropped`. There is no
 * pressure, strength, half-life or dormancy: a thought stays until the
 * subject lets it go, or until newer thoughts displace it at the active limit.
 * A dropped thought is never deleted; the payload records when and why.
 *
 * `thought_v2` replaces the retired strength/decay model (`thought_v1`).
 */
export const THOUGHT_KEY = "thought_v2";

/**
 * Maximum number of active thoughts. The same number is injected into every
 * turn, so no active thought is ever silently out of sight.
 */
export const THOUGHT_ACTIVE_LIMIT = 3;

export type ThoughtDropReason = "subject" | "capacity";

export type ThoughtLifecycle =
  | { status: "active" }
  | {
      status: "dropped";
      reason: ThoughtDropReason;
      droppedAt: string;
      /** Assistant message that issued the drop; null for capacity drops. */
      droppedByMessageId: string | null;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeIso(value: string, label: string): string {
  const parsed = new Date(value);
  if (!value.trim() || !Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  return parsed.toISOString();
}

/**
 * Returns null when the payload carries no valid thought lifecycle. Callers
 * must treat that as "not active" so malformed data fails closed.
 */
export function readThoughtLifecycle(
  payload: Record<string, unknown> | null | undefined,
): ThoughtLifecycle | null {
  const value = record(payload?.[THOUGHT_KEY]);
  if (!value) return null;

  if (value.status === "active") return { status: "active" };

  if (value.status === "dropped") {
    const reason =
      value.reason === "subject" || value.reason === "capacity"
        ? value.reason
        : null;
    const droppedAt =
      typeof value.droppedAt === "string" ? value.droppedAt : "";
    if (!reason) return null;
    try {
      return {
        status: "dropped",
        reason,
        droppedAt: normalizeIso(droppedAt, "droppedAt"),
        droppedByMessageId:
          typeof value.droppedByMessageId === "string"
          && value.droppedByMessageId.trim()
            ? value.droppedByMessageId.trim()
            : null,
      };
    } catch {
      return null;
    }
  }
  return null;
}

export function isActiveThought(
  payload: Record<string, unknown> | null | undefined,
): boolean {
  return readThoughtLifecycle(payload)?.status === "active";
}

export function writeThoughtActive(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return { ...(payload ?? {}), [THOUGHT_KEY]: { status: "active" } };
}

export function writeThoughtDropped(
  payload: Record<string, unknown> | null | undefined,
  drop: {
    reason: ThoughtDropReason;
    droppedAt: string;
    droppedByMessageId?: string | null;
  },
): Record<string, unknown> {
  const droppedByMessageId = drop.droppedByMessageId?.trim() || null;
  if (drop.reason === "subject" && droppedByMessageId === null) {
    throw new Error("A subject drop must name the message that issued it.");
  }
  if (drop.reason === "capacity" && droppedByMessageId !== null) {
    throw new Error("A capacity drop must not name a message.");
  }
  return {
    ...(payload ?? {}),
    [THOUGHT_KEY]: {
      status: "dropped",
      reason: drop.reason,
      droppedAt: normalizeIso(drop.droppedAt, "droppedAt"),
      droppedByMessageId,
    },
  };
}
