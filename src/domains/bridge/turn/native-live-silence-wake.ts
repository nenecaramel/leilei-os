import { createHash } from "node:crypto";

export type NativeLiveSilenceWakeSlot =
  | "post_turn_idle"
  | "long_idle";

export type NativeLiveSilenceWakeSchedule = {
  epochId: string;
  conversationId: string;
  postTurnDueAt: string;
  longIdleDueAt: string;
  postTurnConsumed: boolean;
  longIdleConsumed: boolean;
};

const POST_TURN_MIN_MS = 5 * 60_000;
const POST_TURN_SPAN_MS = 5 * 60_000;
const LONG_IDLE_MIN_MS = 90 * 60_000;
const LONG_IDLE_SPAN_MS = 30 * 60_000;

export function silenceWakeDeadlines(input: {
  epochId: string;
  userActivityAt: string;
  assistantCompletedAt: string;
}): {
  postTurnDueAt: string;
  longIdleDueAt: string;
} {
  const postBase = Date.parse(input.assistantCompletedAt);
  const longBase = Date.parse(input.userActivityAt);
  if (!Number.isFinite(postBase) || !Number.isFinite(longBase)) {
    throw new Error("Silence wake source timestamps are invalid.");
  }
  return {
    postTurnDueAt: new Date(
      postBase
        + POST_TURN_MIN_MS
        + stableOffset(input.epochId, "post_turn_idle", POST_TURN_SPAN_MS),
    ).toISOString(),
    longIdleDueAt: new Date(
      longBase
        + LONG_IDLE_MIN_MS
        + stableOffset(input.epochId, "long_idle", LONG_IDLE_SPAN_MS),
    ).toISOString(),
  };
}

export function chooseDueSilenceWakeSlot(
  schedule: NativeLiveSilenceWakeSchedule | null,
  nowMs: number,
): NativeLiveSilenceWakeSlot | null {
  if (!schedule || schedule.longIdleConsumed) return null;
  const longDue = Date.parse(schedule.longIdleDueAt);
  const postDue = Date.parse(schedule.postTurnDueAt);

  // A resumed Mac never catches up both opportunities. Once the long slot is
  // due it owns the silence epoch and the shorter missed opportunity is stale.
  if (Number.isFinite(longDue) && nowMs >= longDue) {
    return "long_idle";
  }
  if (
    !schedule.postTurnConsumed
    && Number.isFinite(postDue)
    && nowMs >= postDue
  ) {
    return "post_turn_idle";
  }
  return null;
}

export function nextSilenceWakeDeadline(
  schedule: NativeLiveSilenceWakeSchedule | null,
  nowMs: number,
): number | null {
  if (!schedule || schedule.longIdleConsumed) return null;
  const due = chooseDueSilenceWakeSlot(schedule, nowMs);
  if (due) return nowMs;

  const candidates: number[] = [];
  const longDue = Date.parse(schedule.longIdleDueAt);
  if (Number.isFinite(longDue)) candidates.push(longDue);
  if (!schedule.postTurnConsumed) {
    const postDue = Date.parse(schedule.postTurnDueAt);
    if (Number.isFinite(postDue)) candidates.push(postDue);
  }
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

export function formatSilenceWakeMarker(input: {
  now: Date;
  userActivityAt: Date;
}): string {
  const elapsedMs = Math.max(
    0,
    input.now.getTime() - input.userActivityAt.getTime(),
  );
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const elapsed =
    totalMinutes >= 60
      ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
      : `${totalMinutes}m`;

  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(input.now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = read("weekday")
    .replace("星期", "周")
    .replace("星期日", "周日");
  return `[${read("month")}-${read("day")} ${weekday} ${read("hour")}:${read("minute")} · wake · +${elapsed} · no reply]`;
}

export function silenceWakeDeterministicUuid(key: string): string {
  const hex = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 32);
  const chars = hex.split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20, 32),
  ].join("-");
}

function stableOffset(
  epochId: string,
  slot: NativeLiveSilenceWakeSlot,
  spanMs: number,
): number {
  const digest = createHash("sha256")
    .update(`${epochId}:${slot}`, "utf8")
    .digest();
  return digest.readUInt32BE(0) % (spanMs + 1);
}
