import { isDeepStrictEqual } from "node:util";
import {
  and,
  asc,
  eq,
  gt,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  nativeLiveRuntimeEvents,
  nativeLiveTurnPreparations,
} from "../../database/schema.js";
import type {
  NativeLiveNormalizedEvent,
  NativeLiveNormalizedEventType,
} from "../conversation/native-live-conversation-orchestrator.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type NativeLiveRuntimeEventRecord = {
  sequence: number;
  event: NativeLiveNormalizedEvent;
  createdAt: string;
};

export type NativeLiveRuntimeEventAppendOutcome =
  | "created"
  | "idempotent";

export class NativeLiveRuntimeEventError extends Error {
  constructor(
    readonly code:
      | "RESERVATION_NOT_FOUND"
      | "RESERVATION_CONFLICT"
      | "EVENT_CONFLICT"
      | "INVALID_EVENT",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveRuntimeEventError";
  }
}

const EVENT_TYPES = new Set<NativeLiveNormalizedEventType>([
  "session",
  "text",
  "partial_text",
  "tool_use",
  "tool_result",
  "attachment",
  "result",
  "error",
  "runtime",
]);

export class DrizzleNativeLiveRuntimeEventRepository {
  constructor(private readonly db: Database) {}

  async append(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    sequence: number;
    event: NativeLiveNormalizedEvent;
  }): Promise<NativeLiveRuntimeEventAppendOutcome> {
    const event = normalizeRuntimeEvent(input.event);
    if (!Number.isInteger(input.sequence) || input.sequence < 1) {
      throw new NativeLiveRuntimeEventError(
        "INVALID_EVENT",
        "Native live runtime event sequence must be a positive integer.",
      );
    }

    return this.db.transaction(async (transaction) => {
      const [preparation] = await transaction
        .select({
          dispatchStatus: nativeLiveTurnPreparations.dispatchStatus,
          reservedBy: nativeLiveTurnPreparations.reservedBy,
        })
        .from(nativeLiveTurnPreparations)
        .where(
          and(
            eq(nativeLiveTurnPreparations.userId, input.userId),
            eq(nativeLiveTurnPreparations.id, input.reservationId),
          ),
        )
        .for("update")
        .limit(1);

      if (!preparation) {
        throw new NativeLiveRuntimeEventError(
          "RESERVATION_NOT_FOUND",
          "Native live runtime event reservation was not found.",
        );
      }

      const [existing] = await transaction
        .select({
          eventType: nativeLiveRuntimeEvents.eventType,
          providerSessionId: nativeLiveRuntimeEvents.providerSessionId,
          payload: nativeLiveRuntimeEvents.payload,
        })
        .from(nativeLiveRuntimeEvents)
        .where(
          and(
            eq(nativeLiveRuntimeEvents.userId, input.userId),
            eq(nativeLiveRuntimeEvents.prepareId, input.reservationId),
            eq(nativeLiveRuntimeEvents.sequence, input.sequence),
          ),
        )
        .limit(1);

      if (existing) {
        const existingEvent: NativeLiveNormalizedEvent = {
          type: existing.eventType,
          ...(existing.providerSessionId === null
            ? {}
            : { provider_session_id: existing.providerSessionId }),
          ...(existing.payload === null
            ? {}
            : { payload: existing.payload }),
        };
        if (!isDeepStrictEqual(existingEvent, event)) {
          throw new NativeLiveRuntimeEventError(
            "EVENT_CONFLICT",
            "Native live runtime event sequence already contains different data.",
          );
        }
        return "idempotent";
      }

      if (
        preparation.reservedBy !== input.listenerInstanceId
        || (
          preparation.dispatchStatus !== "executing"
          && preparation.dispatchStatus !== "delivery_unknown"
        )
      ) {
        throw new NativeLiveRuntimeEventError(
          "RESERVATION_CONFLICT",
          "Native live runtime event does not belong to the active execution reservation.",
        );
      }

      await transaction.insert(nativeLiveRuntimeEvents).values({
        userId: input.userId,
        prepareId: input.reservationId,
        sequence: input.sequence,
        eventType: event.type,
        providerSessionId: event.provider_session_id ?? null,
        payload: event.payload ?? null,
      });
      return "created";
    });
  }

  async list(input: {
    userId: string;
    prepareId: string;
    afterSequence: number;
    limit: number;
  }): Promise<NativeLiveRuntimeEventRecord[] | null> {
    if (!Number.isInteger(input.afterSequence) || input.afterSequence < 0) {
      throw new NativeLiveRuntimeEventError(
        "INVALID_EVENT",
        "Native live runtime event cursor must be a non-negative integer.",
      );
    }
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
      throw new NativeLiveRuntimeEventError(
        "INVALID_EVENT",
        "Native live runtime event limit must be between 1 and 200.",
      );
    }

    const [preparation] = await this.db
      .select({ id: nativeLiveTurnPreparations.id })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.prepareId),
        ),
      )
      .limit(1);
    if (!preparation) return null;

    const rows = await this.db
      .select({
        sequence: nativeLiveRuntimeEvents.sequence,
        eventType: nativeLiveRuntimeEvents.eventType,
        providerSessionId: nativeLiveRuntimeEvents.providerSessionId,
        payload: nativeLiveRuntimeEvents.payload,
        createdAt: nativeLiveRuntimeEvents.createdAt,
      })
      .from(nativeLiveRuntimeEvents)
      .where(
        and(
          eq(nativeLiveRuntimeEvents.userId, input.userId),
          eq(nativeLiveRuntimeEvents.prepareId, input.prepareId),
          gt(nativeLiveRuntimeEvents.sequence, input.afterSequence),
        ),
      )
      .orderBy(asc(nativeLiveRuntimeEvents.sequence))
      .limit(input.limit);

    return rows.map((row) => ({
      sequence: row.sequence,
      event: {
        type: row.eventType,
        ...(row.providerSessionId === null
          ? {}
          : { provider_session_id: row.providerSessionId }),
        ...(row.payload === null
          ? {}
          : { payload: row.payload }),
      },
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

export class NativeLiveRuntimeEventService {
  constructor(
    private readonly repository: DrizzleNativeLiveRuntimeEventRepository,
  ) {}

  append(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    sequence: number;
    event: NativeLiveNormalizedEvent;
  }): Promise<NativeLiveRuntimeEventAppendOutcome> {
    return this.repository.append(input);
  }

  list(input: {
    userId: string;
    prepareId: string;
    afterSequence: number;
    limit: number;
  }): Promise<NativeLiveRuntimeEventRecord[] | null> {
    return this.repository.list(input);
  }
}

function normalizeRuntimeEvent(
  input: NativeLiveNormalizedEvent,
): NativeLiveNormalizedEvent {
  if (!input || typeof input !== "object" || !EVENT_TYPES.has(input.type)) {
    throw new NativeLiveRuntimeEventError(
      "INVALID_EVENT",
      "Native live runtime event type is invalid.",
    );
  }
  const providerSessionId = input.provider_session_id;
  if (
    providerSessionId !== undefined
    && providerSessionId !== null
    && (
      typeof providerSessionId !== "string"
      || providerSessionId.trim().length === 0
    )
  ) {
    throw new NativeLiveRuntimeEventError(
      "INVALID_EVENT",
      "Native live runtime event provider session id is invalid.",
    );
  }
  const payload = input.payload;
  if (
    payload !== undefined
    && (
      payload === null
      || typeof payload !== "object"
      || Array.isArray(payload)
    )
  ) {
    throw new NativeLiveRuntimeEventError(
      "INVALID_EVENT",
      "Native live runtime event payload must be an object when present.",
    );
  }

  return {
    type: input.type,
    ...(providerSessionId == null
      ? {}
      : { provider_session_id: providerSessionId.trim() }),
    ...(payload === undefined ? {} : { payload }),
  };
}
