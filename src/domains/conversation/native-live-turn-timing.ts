import { and, asc, eq, or, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { nativeLiveRuntimeEvents } from "../../database/schema.js";
import type { NativeLiveMessageActivity } from "./native-live-conversation-types.js";

// Repository createdAt is the authoritative clock: normalized transport timestamps
// do not enter the event repository. Persist only the first start and terminal.
export async function readDurableTurnTimingEvents(
  db: Pick<ReturnType<typeof createDatabase>["db"], "select">, userId: string, prepareId: string,
): Promise<NativeLiveMessageActivity["events"]> {
  const rows = await db.select().from(nativeLiveRuntimeEvents).where(and(
    eq(nativeLiveRuntimeEvents.userId, userId),
    eq(nativeLiveRuntimeEvents.prepareId, prepareId),
    or(
      and(eq(nativeLiveRuntimeEvents.eventType, "runtime"), sql`${nativeLiveRuntimeEvents.payload}->>'kind' = 'provider_message_start'`),
      eq(nativeLiveRuntimeEvents.eventType, "result"),
      eq(nativeLiveRuntimeEvents.eventType, "error"),
    ),
  )).orderBy(asc(nativeLiveRuntimeEvents.sequence));
  const start = rows.find(row => row.eventType === "runtime");
  if (!start) return [];
  const terminal = rows.find(row => row.sequence > start.sequence && ["result", "error"].includes(row.eventType));
  return [start, ...(terminal ? [terminal] : [])].map(row => ({
    sequence: row.sequence, createdAt: row.createdAt.toISOString(),
    event: {
      type: row.eventType,
      // Marker/terminal timing is metadata only; telemetry stays in its existing checkpoint.
      ...(row.eventType === "runtime" ? { payload: { kind: "provider_message_start" } } : {}),
    },
  }));
}

export function decodeDurableTurnTimingEvents(value: unknown): NativeLiveMessageActivity["events"] {
  if (!Array.isArray(value) || value.length > 2) return [];
  const events = value as NativeLiveMessageActivity["events"];
  if (!events.every(e => e && Number.isSafeInteger(e.sequence) && e.sequence > 0
      && typeof e.createdAt === "string" && Number.isFinite(Date.parse(e.createdAt)) && e.event)) return [];
  if (events[0]?.event.type !== "runtime" || events[0].event.payload?.kind !== "provider_message_start") return [];
  if (events[1] && (!["result", "error"].includes(events[1].event.type) || events[1].sequence <= events[0].sequence)) return [];
  return events;
}
