import {
  and,
  asc,
  eq,
  inArray,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
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
    return new Map();
  }

  const activityByMessage =
    new Map<string, NativeLiveMessageActivity>();
  for (const [prepareId, messageId] of prepareToMessage) {
    activityByMessage.set(messageId, {
      prepareId,
      events: [],
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
        eq(nativeLiveRuntimeEvents.eventType, "task"),
      ),
    )
    .orderBy(
      asc(nativeLiveRuntimeEvents.prepareId),
      asc(nativeLiveRuntimeEvents.sequence),
    );

  for (const row of eventRows) {
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

  return activityByMessage;
}
