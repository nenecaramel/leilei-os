import { decodeDurableTurnTimingEvents } from "./native-live-turn-timing.js";
import {
  and,
  asc,
  eq,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationProviderSessionCheckpoints,
  nativeLiveRuntimeEvents,
  nativeLiveRuntimeInteractions,
  nativeLiveTurnPreparations,
} from "../../database/schema.js";
import type {
  NativeLiveMessage,
} from "./native-live-conversation-types.js";

type Database = ReturnType<typeof createDatabase>["db"];

type NativeLiveMessageActivity =
  NonNullable<NativeLiveMessage["activity"]>;

export async function readNativeLiveMessageActivityByAssistantMessage(
  db: Database,
  input: {
    userId: string;
    conversationId: string;
    messageRows: ReadonlyArray<{
      id: string;
      role: string;
    }>;
  },
): Promise<Map<string, NativeLiveMessageActivity>> {
  const assistantMessageIds = input.messageRows
    .filter((row) => row.role === "assistant")
    .map((row) => row.id);
  if (assistantMessageIds.length === 0) {
    return new Map();
  }

  // Final provider telemetry already lives in the canonical message checkpoint.
  // Retain the server-owned provider clock alongside legacy duration after operational retention.
  const durationRows = await db
    .select({
      messageId: conversationProviderSessionCheckpoints.canonicalMessageId,
      startedAt: sql<unknown>`${conversationProviderSessionCheckpoints.runtimeMetadata} ->> 'turn_started_at'`,
      timingEvents: sql<unknown>`${conversationProviderSessionCheckpoints.runtimeMetadata} -> 'native_live_turn_timing_events'`,
      durationMs: sql<unknown>`${conversationProviderSessionCheckpoints.runtimeMetadata} -> 'result' -> 'duration_ms'`,
    })
    .from(conversationProviderSessionCheckpoints)
    .where(and(
      eq(conversationProviderSessionCheckpoints.userId, input.userId),
      eq(conversationProviderSessionCheckpoints.conversationId, input.conversationId),
      eq(conversationProviderSessionCheckpoints.provider, "claude_code"),
      inArray(conversationProviderSessionCheckpoints.canonicalMessageId, assistantMessageIds),
    ));
  const activityByMessage = new Map<string, NativeLiveMessageActivity>();
  for (const row of durationRows) {
    const durationMs = typeof row.durationMs === "number" && Number.isFinite(row.durationMs) && row.durationMs >= 0 ? row.durationMs : undefined;
    const startedAt = typeof row.startedAt === "string" && Number.isFinite(Date.parse(row.startedAt)) ? row.startedAt : undefined;
    const timingEvents = decodeDurableTurnTimingEvents(row.timingEvents);
    if (durationMs === undefined && startedAt === undefined && timingEvents.length === 0) continue;
    activityByMessage.set(row.messageId, {
      prepareId: null,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(startedAt === undefined ? {} : { startedAt }),
      events: timingEvents,
      interactions: [],
    });
  }

  const preparationRows = await db
    .select({
      prepareId: nativeLiveTurnPreparations.id,
      assistantMessageId:
        nativeLiveTurnPreparations.assistantMessageId,
    })
    .from(nativeLiveTurnPreparations)
    .where(
      and(
        eq(nativeLiveTurnPreparations.userId, input.userId),
        eq(
          nativeLiveTurnPreparations.conversationId,
          input.conversationId,
        ),
        inArray(
          nativeLiveTurnPreparations.assistantMessageId,
          assistantMessageIds,
        ),
      ),
    )
    .orderBy(asc(nativeLiveTurnPreparations.createdAt));

  const chosenPrepareIdByMessage = new Map<string, string>();
  for (const row of preparationRows) {
    if (row.assistantMessageId) {
      chosenPrepareIdByMessage.set(
        row.assistantMessageId,
        row.prepareId,
      );
    }
  }

  const prepareToMessage = new Map<string, string>();
  for (const [messageId, prepareId] of chosenPrepareIdByMessage) {
    prepareToMessage.set(prepareId, messageId);
  }
  const prepareIds = [...prepareToMessage.keys()];
  if (prepareIds.length === 0) {
    return activityByMessage;
  }
  for (const [prepareId, messageId] of prepareToMessage) {
    activityByMessage.set(messageId, {
      ...activityByMessage.get(messageId),
      prepareId,
      events: activityByMessage.get(messageId)?.events ?? [],
      interactions: [],
    });
  }

  const eventRows = await db
    .select({
      prepareId: nativeLiveRuntimeEvents.prepareId,
      sequence: nativeLiveRuntimeEvents.sequence,
      eventType: nativeLiveRuntimeEvents.eventType,
      providerSessionId:
        nativeLiveRuntimeEvents.providerSessionId,
      payload: nativeLiveRuntimeEvents.payload,
      createdAt: nativeLiveRuntimeEvents.createdAt,
    })
    .from(nativeLiveRuntimeEvents)
    .where(
      and(
        eq(nativeLiveRuntimeEvents.userId, input.userId),
        inArray(nativeLiveRuntimeEvents.prepareId, prepareIds),
        or(
          eq(nativeLiveRuntimeEvents.eventType, "task"),
          // Completed turns still need the explicitly published thinking sections.
          // Do not hydrate unrelated runtime telemetry, reasoning deltas, or tool payloads.
          and(
            eq(nativeLiveRuntimeEvents.eventType, "runtime"),
            sql`${nativeLiveRuntimeEvents.payload} ->> 'kind' = 'user_visible_thinking'`,
          ),
        ),
      ),
    )
    .orderBy(
      asc(nativeLiveRuntimeEvents.prepareId),
      asc(nativeLiveRuntimeEvents.sequence),
    );

  const compactedEventRows:
    Array<(typeof eventRows)[number]> = [];
  const latestProgressByTask = new Map<
    string,
    (typeof eventRows)[number]
  >();
  const latestActiveSetByPrepare = new Map<
    string,
    (typeof eventRows)[number]
  >();

  for (const row of eventRows) {
    const phase =
      typeof row.payload?.phase === "string"
        ? row.payload.phase
        : null;
    const taskId =
      typeof row.payload?.task_id === "string"
        ? row.payload.task_id
        : null;

    if (phase === "progress" && taskId) {
      latestProgressByTask.set(
        `${row.prepareId}:${taskId}`,
        row,
      );
      continue;
    }

    if (phase === "active_set") {
      latestActiveSetByPrepare.set(row.prepareId, row);
      continue;
    }

    compactedEventRows.push(row);
  }

  compactedEventRows.push(
    ...latestProgressByTask.values(),
    ...latestActiveSetByPrepare.values(),
  );
  compactedEventRows.sort((left, right) => {
    if (left.prepareId === right.prepareId) {
      return left.sequence - right.sequence;
    }
    return left.prepareId.localeCompare(right.prepareId);
  });

  for (const row of compactedEventRows) {
    const messageId = prepareToMessage.get(row.prepareId);
    const activity = messageId
      ? activityByMessage.get(messageId)
      : undefined;
    if (!activity) continue;
    activity.events.push({
      sequence: row.sequence,
      event: {
        type: row.eventType,
        ...(row.providerSessionId
          ? {
              provider_session_id:
                row.providerSessionId,
            }
          : {}),
        ...(row.payload
          ? { payload: row.payload }
          : {}),
      },
      createdAt: row.createdAt.toISOString(),
    });
  }

  const interactionRows = await db
    .select({
      interactionId: nativeLiveRuntimeInteractions.id,
      prepareId: nativeLiveRuntimeInteractions.prepareId,
      kind: nativeLiveRuntimeInteractions.kind,
      request: nativeLiveRuntimeInteractions.request,
      status: nativeLiveRuntimeInteractions.status,
      response: nativeLiveRuntimeInteractions.response,
      createdAt: nativeLiveRuntimeInteractions.createdAt,
      updatedAt: nativeLiveRuntimeInteractions.updatedAt,
      resolvedAt: nativeLiveRuntimeInteractions.resolvedAt,
      cancelledAt:
        nativeLiveRuntimeInteractions.cancelledAt,
    })
    .from(nativeLiveRuntimeInteractions)
    .where(
      and(
        eq(
          nativeLiveRuntimeInteractions.userId,
          input.userId,
        ),
        inArray(
          nativeLiveRuntimeInteractions.prepareId,
          prepareIds,
        ),
      ),
    )
    .orderBy(
      asc(nativeLiveRuntimeInteractions.prepareId),
      asc(nativeLiveRuntimeInteractions.createdAt),
      asc(nativeLiveRuntimeInteractions.id),
    );

  for (const row of interactionRows) {
    const messageId = prepareToMessage.get(row.prepareId);
    const activity = messageId
      ? activityByMessage.get(messageId)
      : undefined;
    if (!activity) continue;
    activity.interactions.push({
      interactionId: row.interactionId,
      prepareId: row.prepareId,
      kind: row.kind,
      request: row.request,
      status: row.status,
      response: row.response,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      cancelledAt:
        row.cancelledAt?.toISOString() ?? null,
    });
  }

  for (const [messageId, activity] of activityByMessage) {
    if (
      activity.events.length === 0
      && activity.interactions.length === 0
      && activity.durationMs === undefined
      && activity.startedAt === undefined
    ) {
      activityByMessage.delete(messageId);
    }
  }

  return activityByMessage;
}
