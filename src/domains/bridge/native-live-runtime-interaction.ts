import { isDeepStrictEqual } from "node:util";
import {
  and,
  asc,
  eq,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import type {
  DrizzleNativeLiveWorkWakePublisher,
  NativeLiveWorkWakeBroker,
} from "./native-live-work-wake.js";
import {
  nativeLiveRuntimeInteractions,
  nativeLiveTurnPreparations,
  type NativeLiveRuntimeInteractionKind,
  type NativeLiveRuntimeInteractionStatus,
} from "../../database/schema.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type NativeLiveRuntimeInteractionDecision =
  | {
      decision: "allow";
      updatedInput?: Record<string, unknown>;
    }
  | {
      decision: "deny";
      message: string;
      interrupt: boolean;
    }
  | {
      decision: "answer";
      answers: Record<string, string>;
    }
  | {
      decision: "cancel";
      message: string;
    };

export type NativeLiveRuntimeInteractionRecord = {
  interactionId: string;
  prepareId: string;
  kind: NativeLiveRuntimeInteractionKind;
  request: Record<string, unknown>;
  status: NativeLiveRuntimeInteractionStatus;
  response: NativeLiveRuntimeInteractionDecision | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  cancelledAt: string | null;
};

export class NativeLiveRuntimeInteractionError extends Error {
  constructor(
    readonly code:
      | "INTERACTION_INVALID"
      | "INTERACTION_NOT_FOUND"
      | "INTERACTION_CONFLICT"
      | "RESERVATION_NOT_FOUND"
      | "RESERVATION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveRuntimeInteractionError";
  }
}

export class DrizzleNativeLiveRuntimeInteractionRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    interactionId: string;
    kind: NativeLiveRuntimeInteractionKind;
    request: Record<string, unknown>;
  }): Promise<{
    outcome: "created" | "idempotent";
    interaction: NativeLiveRuntimeInteractionRecord;
  }> {
    const request = normalizeRequest(input.kind, input.request);

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
        throw new NativeLiveRuntimeInteractionError(
          "RESERVATION_NOT_FOUND",
          "Native live interaction reservation was not found.",
        );
      }

      const [existing] = await transaction
        .select()
        .from(nativeLiveRuntimeInteractions)
        .where(eq(nativeLiveRuntimeInteractions.id, input.interactionId))
        .limit(1);
      if (existing) {
        if (
          existing.userId !== input.userId
          || existing.prepareId !== input.reservationId
          || existing.listenerInstanceId !== input.listenerInstanceId
          || existing.kind !== input.kind
          || !isDeepStrictEqual(existing.request, request)
        ) {
          throw new NativeLiveRuntimeInteractionError(
            "INTERACTION_CONFLICT",
            "Native live interaction id is already bound to different data.",
          );
        }
        return {
          outcome: "idempotent" as const,
          interaction: mapInteraction(existing),
        };
      }

      if (
        preparation.reservedBy !== input.listenerInstanceId
        || (
          preparation.dispatchStatus !== "executing"
          && preparation.dispatchStatus !== "delivery_unknown"
        )
      ) {
        throw new NativeLiveRuntimeInteractionError(
          "RESERVATION_CONFLICT",
          "Native live interaction does not belong to the active execution reservation.",
        );
      }

      const [created] = await transaction
        .insert(nativeLiveRuntimeInteractions)
        .values({
          id: input.interactionId,
          userId: input.userId,
          prepareId: input.reservationId,
          listenerInstanceId: input.listenerInstanceId,
          kind: input.kind,
          request,
        })
        .returning();
      if (!created) {
        throw new NativeLiveRuntimeInteractionError(
          "INTERACTION_CONFLICT",
          "Native live interaction could not be created.",
        );
      }
      return {
        outcome: "created" as const,
        interaction: mapInteraction(created),
      };
    });
  }

  async readForListener(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    interactionId: string;
  }): Promise<NativeLiveRuntimeInteractionRecord | null> {
    const [row] = await this.db
      .select()
      .from(nativeLiveRuntimeInteractions)
      .where(
        and(
          eq(nativeLiveRuntimeInteractions.id, input.interactionId),
          eq(nativeLiveRuntimeInteractions.userId, input.userId),
          eq(nativeLiveRuntimeInteractions.prepareId, input.reservationId),
          eq(
            nativeLiveRuntimeInteractions.listenerInstanceId,
            input.listenerInstanceId,
          ),
        ),
      )
      .limit(1);
    return row ? mapInteraction(row) : null;
  }


  async isTurnActiveForListener(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<boolean> {
    const [row] = await this.db
      .select({
        dispatchStatus: nativeLiveTurnPreparations.dispatchStatus,
        reservedBy: nativeLiveTurnPreparations.reservedBy,
      })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.id, input.reservationId),
          eq(nativeLiveTurnPreparations.userId, input.userId),
        ),
      )
      .limit(1);

    return Boolean(
      row
      && row.reservedBy === input.listenerInstanceId
      && (
        row.dispatchStatus === "executing"
        || row.dispatchStatus === "delivery_unknown"
      ),
    );
  }

  async listForUser(input: {
    userId: string;
    prepareId: string;
    limit: number;
  }): Promise<NativeLiveRuntimeInteractionRecord[] | null> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new NativeLiveRuntimeInteractionError(
        "INTERACTION_INVALID",
        "Native live interaction limit must be between 1 and 100.",
      );
    }
    const [preparation] = await this.db
      .select({ id: nativeLiveTurnPreparations.id })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.id, input.prepareId),
          eq(nativeLiveTurnPreparations.userId, input.userId),
        ),
      )
      .limit(1);
    if (!preparation) return null;

    const rows = await this.db
      .select()
      .from(nativeLiveRuntimeInteractions)
      .where(
        and(
          eq(nativeLiveRuntimeInteractions.userId, input.userId),
          eq(nativeLiveRuntimeInteractions.prepareId, input.prepareId),
        ),
      )
      .orderBy(
        asc(nativeLiveRuntimeInteractions.createdAt),
        asc(nativeLiveRuntimeInteractions.id),
      )
      .limit(input.limit);
    return rows.map(mapInteraction);
  }

  async resolve(input: {
    userId: string;
    prepareId: string;
    interactionId: string;
    response: Record<string, unknown>;
  }): Promise<{
    outcome: "resolved" | "idempotent";
    interaction: NativeLiveRuntimeInteractionRecord;
  }> {
    return this.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(nativeLiveRuntimeInteractions)
        .where(
          and(
            eq(nativeLiveRuntimeInteractions.id, input.interactionId),
            eq(nativeLiveRuntimeInteractions.userId, input.userId),
            eq(nativeLiveRuntimeInteractions.prepareId, input.prepareId),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) {
        throw new NativeLiveRuntimeInteractionError(
          "INTERACTION_NOT_FOUND",
          "Native live interaction was not found.",
        );
      }

      const response = normalizeDecision(row.kind, input.response);
      if (row.status === "resolved") {
        if (!isDeepStrictEqual(row.response, response)) {
          throw new NativeLiveRuntimeInteractionError(
            "INTERACTION_CONFLICT",
            "Native live interaction was already resolved differently.",
          );
        }
        return {
          outcome: "idempotent" as const,
          interaction: mapInteraction(row),
        };
      }
      if (row.status !== "pending") {
        throw new NativeLiveRuntimeInteractionError(
          "INTERACTION_CONFLICT",
          "Cancelled native live interaction cannot be resolved.",
        );
      }

      const [preparation] = await transaction
        .select({
          dispatchStatus: nativeLiveTurnPreparations.dispatchStatus,
        })
        .from(nativeLiveTurnPreparations)
        .where(
          and(
            eq(nativeLiveTurnPreparations.id, input.prepareId),
            eq(nativeLiveTurnPreparations.userId, input.userId),
          ),
        )
        .limit(1);
      if (
        !preparation
        || (
          preparation.dispatchStatus !== "executing"
          && preparation.dispatchStatus !== "delivery_unknown"
        )
      ) {
        throw new NativeLiveRuntimeInteractionError(
          "INTERACTION_CONFLICT",
          "Native live interaction is no longer attached to an active turn.",
        );
      }

      const now = new Date();
      const [updated] = await transaction
        .update(nativeLiveRuntimeInteractions)
        .set({
          status: "resolved",
          response,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(nativeLiveRuntimeInteractions.id, input.interactionId),
            eq(nativeLiveRuntimeInteractions.userId, input.userId),
            eq(nativeLiveRuntimeInteractions.prepareId, input.prepareId),
            eq(nativeLiveRuntimeInteractions.status, "pending"),
          ),
        )
        .returning();
      if (!updated) {
        throw new NativeLiveRuntimeInteractionError(
          "INTERACTION_CONFLICT",
          "Native live interaction resolution raced with another mutation.",
        );
      }
      return {
        outcome: "resolved" as const,
        interaction: mapInteraction(updated),
      };
    });
  }

  async cancelForListener(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    interactionId: string;
  }): Promise<"cancelled" | "idempotent"> {
    return this.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(nativeLiveRuntimeInteractions)
        .where(
          and(
            eq(nativeLiveRuntimeInteractions.id, input.interactionId),
            eq(nativeLiveRuntimeInteractions.userId, input.userId),
            eq(nativeLiveRuntimeInteractions.prepareId, input.reservationId),
            eq(
              nativeLiveRuntimeInteractions.listenerInstanceId,
              input.listenerInstanceId,
            ),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) {
        throw new NativeLiveRuntimeInteractionError(
          "INTERACTION_NOT_FOUND",
          "Native live interaction was not found.",
        );
      }
      if (row.status === "cancelled") return "idempotent";
      if (row.status === "resolved") return "idempotent";

      const now = new Date();
      await transaction
        .update(nativeLiveRuntimeInteractions)
        .set({
          status: "cancelled",
          cancelledAt: now,
          updatedAt: now,
        })
        .where(eq(nativeLiveRuntimeInteractions.id, input.interactionId));
      return "cancelled";
    });
  }
}

export class NativeLiveRuntimeInteractionService {
  constructor(
    private readonly repository:
      DrizzleNativeLiveRuntimeInteractionRepository,
    private readonly wakePublisher?:
      Pick<DrizzleNativeLiveWorkWakePublisher, "notify">,
    private readonly wakeBroker?:
      Pick<
        NativeLiveWorkWakeBroker,
        "start" | "interactionVersion" | "waitForInteractionChange"
      > & {
        release?: () => Promise<void>;
      },
  ) {}

  create(
    input: Parameters<
      DrizzleNativeLiveRuntimeInteractionRepository["create"]
    >[0],
  ) {
    return this.repository.create(input);
  }

  readForListener(
    input: Parameters<
      DrizzleNativeLiveRuntimeInteractionRepository["readForListener"]
    >[0],
  ) {
    return this.repository.readForListener(input);
  }

  async waitForListener(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    interactionId: string;
    timeoutMs: number;
    signal?: AbortSignal | null;
  }): Promise<
    | {
        outcome: "terminal";
        interaction: NativeLiveRuntimeInteractionRecord;
      }
    | { outcome: "timeout" }
  > {
    const read = () =>
      this.repository.readForListener({
        userId: input.userId,
        listenerInstanceId: input.listenerInstanceId,
        reservationId: input.reservationId,
        interactionId: input.interactionId,
      });

    const cancelIfOrphaned = async (
      interaction: NativeLiveRuntimeInteractionRecord,
    ): Promise<NativeLiveRuntimeInteractionRecord> => {
      if (interaction.status !== "pending") return interaction;

      const active = await this.repository.isTurnActiveForListener({
        userId: input.userId,
        listenerInstanceId: input.listenerInstanceId,
        reservationId: input.reservationId,
      });
      if (active) return interaction;

      await this.repository.cancelForListener({
        userId: input.userId,
        listenerInstanceId: input.listenerInstanceId,
        reservationId: input.reservationId,
        interactionId: input.interactionId,
      });
      const cancelled = await read();
      if (!cancelled) {
        throw new NativeLiveRuntimeInteractionError(
          "INTERACTION_NOT_FOUND",
          "Native live interaction was not found after orphan cleanup.",
        );
      }
      return cancelled;
    };

    const immediateRaw = await read();
    const immediate = immediateRaw
      ? await cancelIfOrphaned(immediateRaw)
      : null;
    if (!immediate) {
      throw new NativeLiveRuntimeInteractionError(
        "INTERACTION_NOT_FOUND",
        "Native live interaction was not found.",
      );
    }
    if (immediate.status !== "pending") {
      return {
        outcome: "terminal",
        interaction: immediate,
      };
    }
    if (!this.wakeBroker) {
      return { outcome: "timeout" };
    }

    await this.wakeBroker.start();
    try {
      const version = this.wakeBroker.interactionVersion(
        input.userId,
        input.interactionId,
      );

      const racedRaw = await read();
      const raced = racedRaw
        ? await cancelIfOrphaned(racedRaw)
        : null;
      if (!raced) {
        throw new NativeLiveRuntimeInteractionError(
          "INTERACTION_NOT_FOUND",
          "Native live interaction was not found.",
        );
      }
      if (raced.status !== "pending") {
        return {
          outcome: "terminal",
          interaction: raced,
        };
      }

      const wake =
        await this.wakeBroker.waitForInteractionChange({
          userId: input.userId,
          interactionId: input.interactionId,
          afterVersion: version,
          timeoutMs: input.timeoutMs,
          signal: input.signal,
        });
      if (wake.outcome !== "ready") {
        const afterTimeoutRaw = await read();
        const afterTimeout = afterTimeoutRaw
          ? await cancelIfOrphaned(afterTimeoutRaw)
          : null;
        if (!afterTimeout) {
          throw new NativeLiveRuntimeInteractionError(
            "INTERACTION_NOT_FOUND",
            "Native live interaction was not found.",
          );
        }
        return afterTimeout.status === "pending"
          ? { outcome: "timeout" }
          : {
              outcome: "terminal",
              interaction: afterTimeout,
            };
      }

      const terminal = await read();
      if (!terminal) {
        throw new NativeLiveRuntimeInteractionError(
          "INTERACTION_NOT_FOUND",
          "Native live interaction was not found.",
        );
      }
      return terminal.status === "pending"
        ? { outcome: "timeout" }
        : {
            outcome: "terminal",
            interaction: terminal,
          };
    } finally {
      await this.wakeBroker.release?.();
    }
  }

  listForUser(
    input: Parameters<
      DrizzleNativeLiveRuntimeInteractionRepository["listForUser"]
    >[0],
  ) {
    return this.repository.listForUser(input);
  }

  async resolve(
    input: Parameters<
      DrizzleNativeLiveRuntimeInteractionRepository["resolve"]
    >[0],
  ) {
    const result = await this.repository.resolve(input);
    try {
      await this.wakePublisher?.notify({
        userId: input.userId,
        kind: "runtime_interaction",
        interactionId: input.interactionId,
      });
    } catch {
      // Durable interaction state is authoritative.
    }
    return result;
  }

  async cancelForListener(
    input: Parameters<
      DrizzleNativeLiveRuntimeInteractionRepository["cancelForListener"]
    >[0],
  ) {
    const result = await this.repository.cancelForListener(input);
    try {
      await this.wakePublisher?.notify({
        userId: input.userId,
        kind: "runtime_interaction",
        interactionId: input.interactionId,
      });
    } catch {
      // Durable interaction state is authoritative.
    }
    return result;
  }
}

function normalizeRequest(
  kind: NativeLiveRuntimeInteractionKind,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new NativeLiveRuntimeInteractionError(
      "INTERACTION_INVALID",
      "Native live interaction request must be an object.",
    );
  }
  if (kind === "permission") {
    if (
      typeof input.toolName !== "string"
      || input.toolName.trim().length === 0
      || !isRecord(input.input)
    ) {
      throw new NativeLiveRuntimeInteractionError(
        "INTERACTION_INVALID",
        "Permission interaction requires toolName and input.",
      );
    }
    return input;
  }

  if (
    input.toolName !== "AskUserQuestion"
    || !isRecord(input.input)
    || !Array.isArray(input.questions)
    || input.questions.length === 0
  ) {
    throw new NativeLiveRuntimeInteractionError(
      "INTERACTION_INVALID",
      "Question interaction requires AskUserQuestion input and questions.",
    );
  }
  return input;
}

function normalizeDecision(
  kind: NativeLiveRuntimeInteractionKind,
  input: Record<string, unknown>,
): NativeLiveRuntimeInteractionDecision {
  if (!isRecord(input)) {
    throw new NativeLiveRuntimeInteractionError(
      "INTERACTION_INVALID",
      "Native live interaction response must be an object.",
    );
  }

  if (kind === "permission") {
    if (input.decision === "allow") {
      if (
        input.updatedInput !== undefined
        && !isRecord(input.updatedInput)
      ) {
        throw new NativeLiveRuntimeInteractionError(
          "INTERACTION_INVALID",
          "Permission allow updatedInput must be an object.",
        );
      }
      return {
        decision: "allow",
        ...(input.updatedInput === undefined
          ? {}
          : { updatedInput: input.updatedInput }),
      };
    }
    if (
      input.decision === "deny"
      && typeof input.message === "string"
      && input.message.trim().length > 0
      && (
        input.interrupt === undefined
        || typeof input.interrupt === "boolean"
      )
    ) {
      return {
        decision: "deny",
        message: input.message.trim(),
        interrupt: input.interrupt === true,
      };
    }
    throw new NativeLiveRuntimeInteractionError(
      "INTERACTION_INVALID",
      "Permission interaction response must allow or deny.",
    );
  }

  if (input.decision === "answer" && isRecord(input.answers)) {
    const entries = Object.entries(input.answers);
    if (
      entries.length > 0
      && entries.every(
        ([question, answer]) =>
          question.trim().length > 0
          && typeof answer === "string"
          && answer.trim().length > 0,
      )
    ) {
      return {
        decision: "answer",
        answers: Object.fromEntries(
          entries.map(([question, answer]) => [
            question.trim(),
            (answer as string).trim(),
          ]),
        ),
      };
    }
  }
  if (
    input.decision === "cancel"
    && typeof input.message === "string"
    && input.message.trim().length > 0
  ) {
    return {
      decision: "cancel",
      message: input.message.trim(),
    };
  }
  throw new NativeLiveRuntimeInteractionError(
    "INTERACTION_INVALID",
    "Question interaction response must answer or cancel.",
  );
}

function mapInteraction(
  row: typeof nativeLiveRuntimeInteractions.$inferSelect,
): NativeLiveRuntimeInteractionRecord {
  return {
    interactionId: row.id,
    prepareId: row.prepareId,
    kind: row.kind,
    request: row.request,
    status: row.status,
    response:
      row.response as NativeLiveRuntimeInteractionDecision | null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
