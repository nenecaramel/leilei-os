import { isDeepStrictEqual } from "node:util";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
} from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  nativeLiveRuntimeEvents,
  nativeLiveTurnPreparations,
} from "../../../database/schema.js";
import type {
  NativeLiveNormalizedEvent,
  NativeLiveNormalizedEventType,
} from "../../conversation/native-live-conversation-orchestrator.js";
import type {
  ClaudeAccountUsageWriter,
} from "../../runtime/shared/claude-account-usage.js";

type Database = ReturnType<typeof createDatabase>["db"];

const MAX_RUNTIME_EVENT_BATCH = 32;

export type NativeLiveRuntimeEventRecord = {
  sequence: number;
  event: NativeLiveNormalizedEvent;
  createdAt: string;
};

export type NativeLiveRuntimeEventAppendOutcome =
  | "created"
  | "idempotent";

export type NativeLiveRuntimeEventBatchAppendOutcome = {
  created: number;
  idempotent: number;
};

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
  "search_result",
  "attachment",
  "task",
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
    const outcome = await this.appendBatch({
      userId: input.userId,
      listenerInstanceId: input.listenerInstanceId,
      reservationId: input.reservationId,
      events: [{
        sequence: input.sequence,
        event: input.event,
      }],
    });
    return outcome.created === 1
      ? "created"
      : "idempotent";
  }

  async appendBatch(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    events: ReadonlyArray<{
      sequence: number;
      event: NativeLiveNormalizedEvent;
    }>;
  }): Promise<NativeLiveRuntimeEventBatchAppendOutcome> {
    const events = normalizeRuntimeEventBatch(input.events);

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

      const existingRows = await transaction
        .select({
          sequence: nativeLiveRuntimeEvents.sequence,
          eventType: nativeLiveRuntimeEvents.eventType,
          providerSessionId: nativeLiveRuntimeEvents.providerSessionId,
          payload: nativeLiveRuntimeEvents.payload,
        })
        .from(nativeLiveRuntimeEvents)
        .where(
          and(
            eq(nativeLiveRuntimeEvents.userId, input.userId),
            eq(nativeLiveRuntimeEvents.prepareId, input.reservationId),
            inArray(
              nativeLiveRuntimeEvents.sequence,
              events.map((item) => item.sequence),
            ),
          ),
        );

      const existingBySequence = new Map(
        existingRows.map((row) => [
          row.sequence,
          {
            type: row.eventType,
            ...(row.providerSessionId === null
              ? {}
              : { provider_session_id: row.providerSessionId }),
            ...(row.payload === null
              ? {}
              : { payload: row.payload }),
          } satisfies NativeLiveNormalizedEvent,
        ]),
      );

      const missing: typeof events = [];
      let idempotent = 0;
      for (const item of events) {
        const existing = existingBySequence.get(item.sequence);
        if (!existing) {
          missing.push(item);
          continue;
        }
        if (!isDeepStrictEqual(existing, item.event)) {
          throw new NativeLiveRuntimeEventError(
            "EVENT_CONFLICT",
            "Native live runtime event sequence already contains different data.",
          );
        }
        idempotent += 1;
      }

      if (missing.length > 0) {
        if (
          preparation.reservedBy !== input.listenerInstanceId
          || (
            preparation.dispatchStatus !== "executing"
            && preparation.dispatchStatus !== "delivery_unknown"
          )
        ) {
          throw new NativeLiveRuntimeEventError(
            "RESERVATION_CONFLICT",
            "Native live runtime events do not belong to the active execution reservation.",
          );
        }

        await transaction.insert(nativeLiveRuntimeEvents).values(
          missing.map((item) => ({
            userId: input.userId,
            prepareId: input.reservationId,
            sequence: item.sequence,
            eventType: item.event.type,
            providerSessionId:
              item.event.provider_session_id ?? null,
            payload: item.event.payload ?? null,
          })),
        );
      }

      return {
        created: missing.length,
        idempotent,
      };
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
    private readonly repository: Pick<
      DrizzleNativeLiveRuntimeEventRepository,
      "append" | "appendBatch" | "list"
    >,
    private readonly claudeAccountUsage: ClaudeAccountUsageWriter | null = null,
  ) {}

  async append(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    sequence: number;
    event: NativeLiveNormalizedEvent;
  }): Promise<NativeLiveRuntimeEventAppendOutcome> {
    const outcome = await this.repository.append(input);
    await this.claudeAccountUsage?.observeRuntimeEvents({
      userId: input.userId,
      events: [{
        sequence: input.sequence,
        event: input.event,
      }],
    });
    return outcome;
  }

  async appendBatch(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    events: ReadonlyArray<{
      sequence: number;
      event: NativeLiveNormalizedEvent;
    }>;
  }): Promise<NativeLiveRuntimeEventBatchAppendOutcome> {
    const outcome = await this.repository.appendBatch(input);
    await this.claudeAccountUsage?.observeRuntimeEvents({
      userId: input.userId,
      events: input.events,
    });
    return outcome;
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

function normalizeRuntimeEventBatch(
  input: ReadonlyArray<{
    sequence: number;
    event: NativeLiveNormalizedEvent;
  }>,
): Array<{
  sequence: number;
  event: NativeLiveNormalizedEvent;
}> {
  if (
    !Array.isArray(input)
    || input.length < 1
    || input.length > MAX_RUNTIME_EVENT_BATCH
  ) {
    throw new NativeLiveRuntimeEventError(
      "INVALID_EVENT",
      `Native live runtime event batch must contain 1 to ${MAX_RUNTIME_EVENT_BATCH} events.`,
    );
  }

  let previousSequence = 0;
  return input.map((item) => {
    if (
      !Number.isInteger(item.sequence)
      || item.sequence < 1
      || item.sequence <= previousSequence
    ) {
      throw new NativeLiveRuntimeEventError(
        "INVALID_EVENT",
        "Native live runtime event batch sequences must be positive and strictly increasing.",
      );
    }
    previousSequence = item.sequence;
    return {
      sequence: item.sequence,
      event: normalizeRuntimeEvent(item.event),
    };
  });
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
