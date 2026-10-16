import { createTaskControl, readTaskControl, reserveTaskControl, taskSource, validateTaskReceipt, type NativeLiveTaskBinding } from "./native-live-task-control-repository.js";
import { isDeepStrictEqual } from "node:util";
import {
  and,
  asc,
  eq,
  inArray,
} from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import type {
  DrizzleNativeLiveWorkWakePublisher,
  NativeLiveWorkWakeBroker,
} from "../relay/native-live-work-wake.js";
import {
  nativeLiveRuntimeControls,
  nativeLiveTurnPreparations,
  type NativeLiveRuntimeControlKind,
  type NativeLiveRuntimeControlStatus,
} from "../../../database/schema.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type NativeLiveRuntimeControlRecord = {
  controlId: string;
  prepareId: string;
  kind: NativeLiveRuntimeControlKind;
  payload: Record<string, unknown>;
  status: NativeLiveRuntimeControlStatus;
  reservedBy: string | null;
  receipt: Record<string, unknown> | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
};

export class NativeLiveRuntimeControlError extends Error {
  constructor(
    readonly code:
      | "CONTROL_INVALID"
      | "CONTROL_NOT_FOUND"
      | "CONTROL_CONFLICT"
      | "TURN_NOT_ACTIVE"
      | "RESERVATION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveRuntimeControlError";
  }
}

export class DrizzleNativeLiveRuntimeControlRepository {
  constructor(private readonly db: Database) {}

  async createForUser(input: {
    userId: string;
    prepareId: string;
    controlId: string;
    kind: NativeLiveRuntimeControlKind;
    payload: Record<string, unknown>;
  }): Promise<{
    outcome: "created" | "idempotent";
    control: NativeLiveRuntimeControlRecord;
  }> {
    if (input.kind === "task") return createTaskControl(this.db, input);
    const payload = normalizePayload(input.kind, input.payload);

    return this.db.transaction(async (transaction) => {
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
        .for("update")
        .limit(1);
      if (
        !preparation
        || (
          preparation.dispatchStatus !== "executing"
          && preparation.dispatchStatus !== "delivery_unknown"
        )
      ) {
        throw new NativeLiveRuntimeControlError(
          "TURN_NOT_ACTIVE",
          "Native live turn is not accepting runtime controls.",
        );
      }

      const [existing] = await transaction
        .select()
        .from(nativeLiveRuntimeControls)
        .where(eq(nativeLiveRuntimeControls.id, input.controlId))
        .limit(1);
      if (existing) {
        if (
          existing.userId !== input.userId
          || existing.prepareId !== input.prepareId
          || existing.kind !== input.kind
          || !isDeepStrictEqual(existing.payload, payload)
        ) {
          throw new NativeLiveRuntimeControlError(
            "CONTROL_CONFLICT",
            "Native live runtime control id is already bound to different data.",
          );
        }
        return {
          outcome: "idempotent" as const,
          control: mapControl(existing),
        };
      }

      const [created] = await transaction
        .insert(nativeLiveRuntimeControls)
        .values({
          id: input.controlId,
          userId: input.userId,
          prepareId: input.prepareId,
          kind: input.kind,
          payload,
        })
        .returning();
      if (!created) {
        throw new NativeLiveRuntimeControlError(
          "CONTROL_CONFLICT",
          "Native live runtime control could not be created.",
        );
      }
      return {
        outcome: "created" as const,
        control: mapControl(created),
      };
    });
  }

  async checkTaskAdmission(input: { userId:string;prepareId:string;listenerInstanceId:string;providerSessionId:string }):Promise<boolean> {
    return this.db.transaction(async tx=>{const source=await taskSource(tx,input);return source?.providerSessionId===input.providerSessionId;});
  }
  readTaskForUser(input: { userId: string; prepareId: string; controlId: string }) { return readTaskControl(this.db, input); }
  reserveTaskForListener(input: { userId: string; listenerInstanceId: string; bindings: NativeLiveTaskBinding[] }) { return reserveTaskControl(this.db, input); }

  async reserveNextForListener(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<NativeLiveRuntimeControlRecord | null> {
    return this.db.transaction(async (transaction) => {
      const [preparation] = await transaction
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
        .for("update")
        .limit(1);
      if (
        !preparation
        || preparation.reservedBy !== input.listenerInstanceId
        || (
          preparation.dispatchStatus !== "executing"
          && preparation.dispatchStatus !== "delivery_unknown"
        )
      ) {
        throw new NativeLiveRuntimeControlError(
          "RESERVATION_CONFLICT",
          "Native live runtime control reservation is no longer active.",
        );
      }

      const [candidate] = await transaction
        .select()
        .from(nativeLiveRuntimeControls)
        .where(
          and(
            eq(nativeLiveRuntimeControls.userId, input.userId),
            eq(nativeLiveRuntimeControls.prepareId, input.reservationId),
            eq(nativeLiveRuntimeControls.status, "pending"),
            inArray(nativeLiveRuntimeControls.kind, ["mid_turn_input", "interrupt"]),
          ),
        )
        .orderBy(
          asc(nativeLiveRuntimeControls.createdAt),
          asc(nativeLiveRuntimeControls.id),
        )
        .for("update")
        .limit(1);
      if (!candidate) return null;

      const now = new Date();
      const [reserved] = await transaction
        .update(nativeLiveRuntimeControls)
        .set({
          status: "reserved",
          reservedBy: input.listenerInstanceId,
          reservedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(nativeLiveRuntimeControls.id, candidate.id),
            eq(nativeLiveRuntimeControls.status, "pending"),
          ),
        )
        .returning();
      if (!reserved) {
        throw new NativeLiveRuntimeControlError(
          "CONTROL_CONFLICT",
          "Native live runtime control reservation raced with another mutation.",
        );
      }
      return mapControl(reserved);
    });
  }

  async completeForListener(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    controlId: string;
    outcome:
      | {
          status: "applied";
          receipt: Record<string, unknown>;
        }
      | {
          status: "failed";
          failureCode: string;
        };
  }): Promise<"applied" | "failed" | "idempotent"> {
    return this.db.transaction(async (transaction) => {
      const [kind] = await transaction.select({ kind: nativeLiveRuntimeControls.kind }).from(nativeLiveRuntimeControls).where(and(eq(nativeLiveRuntimeControls.id,input.controlId),eq(nativeLiveRuntimeControls.userId,input.userId),eq(nativeLiveRuntimeControls.prepareId,input.reservationId)));
      if (kind?.kind === "task" && !await taskSource(transaction,{ ...input,prepareId:input.reservationId })) throw new NativeLiveRuntimeControlError("TURN_NOT_ACTIVE", "Task session ownership changed.");
      const [row] = await transaction
        .select()
        .from(nativeLiveRuntimeControls)
        .where(
          and(
            eq(nativeLiveRuntimeControls.id, input.controlId),
            eq(nativeLiveRuntimeControls.userId, input.userId),
            eq(nativeLiveRuntimeControls.prepareId, input.reservationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) {
        throw new NativeLiveRuntimeControlError(
          "CONTROL_NOT_FOUND",
          "Native live runtime control was not found.",
        );
      }
      if (
        row.status === "applied"
        && input.outcome.status === "applied"
        && isDeepStrictEqual(row.receipt, input.outcome.receipt)
      ) {
        return "idempotent";
      }
      if (
        row.status === "failed"
        && input.outcome.status === "failed"
        && row.failureCode === normalizeFailureCode(input.outcome.failureCode)
      ) {
        return "idempotent";
      }
      if (
        row.status !== "reserved"
        || row.reservedBy !== input.listenerInstanceId
      ) {
        throw new NativeLiveRuntimeControlError(
          "CONTROL_CONFLICT",
          "Native live runtime control is not reserved by this listener.",
        );
      }

      const now = new Date();
      if (input.outcome.status === "applied") {
        const receipt = row.kind === "task" ? validateTaskReceipt(row.payload, input.outcome.receipt) : normalizeReceipt(input.outcome.receipt);
        await transaction
          .update(nativeLiveRuntimeControls)
          .set({
            status: "applied",
            receipt,
            appliedAt: now,
            updatedAt: now,
          })
          .where(eq(nativeLiveRuntimeControls.id, input.controlId));
        return "applied";
      }

      const failureCode =
        normalizeFailureCode(input.outcome.failureCode);
      await transaction
        .update(nativeLiveRuntimeControls)
        .set({
          status: "failed",
          failureCode,
          appliedAt: now,
          updatedAt: now,
        })
        .where(eq(nativeLiveRuntimeControls.id, input.controlId));
      return "failed";
    });
  }

  async listForUser(input: {
    userId: string;
    prepareId: string;
    limit: number;
  }): Promise<NativeLiveRuntimeControlRecord[] | null> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new NativeLiveRuntimeControlError(
        "CONTROL_INVALID",
        "Native live runtime control limit must be between 1 and 100.",
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
      .from(nativeLiveRuntimeControls)
      .where(
        and(
          eq(nativeLiveRuntimeControls.userId, input.userId),
          eq(nativeLiveRuntimeControls.prepareId, input.prepareId),
          inArray(nativeLiveRuntimeControls.kind, ["mid_turn_input", "interrupt"]),
        ),
      )
      .orderBy(
        asc(nativeLiveRuntimeControls.createdAt),
        asc(nativeLiveRuntimeControls.id),
      )
      .limit(input.limit);
    return rows.map(mapControl);
  }
}

export class NativeLiveRuntimeControlService {
  constructor(
    private readonly repository:
      DrizzleNativeLiveRuntimeControlRepository,
    private readonly wakePublisher?:
      Pick<DrizzleNativeLiveWorkWakePublisher, "notify">,
    private readonly wakeBroker?:
      Pick<
        NativeLiveWorkWakeBroker,
        "start" | "controlVersion" | "waitForControlChange"
      > & Partial<Pick<NativeLiveWorkWakeBroker, "version" | "waitForChange">> & {
        release?: () => Promise<void>;
      },
  ) {}

  async createForUser(
    input: Parameters<
      DrizzleNativeLiveRuntimeControlRepository["createForUser"]
    >[0],
  ) {
    const result = await this.repository.createForUser(input);
    if (result.control.status === "pending") {
      try {
        await this.wakePublisher?.notify({
          userId: input.userId,
          ...(input.kind === "task" ? { kind: "foreground" as const } : { kind: "runtime_control" as const, reservationId: input.prepareId }),
        });
      } catch {
        // Durable control state is authoritative; notification is advisory.
      }
    }
    return result;
  }

  checkTaskAdmission(input: Parameters<DrizzleNativeLiveRuntimeControlRepository["checkTaskAdmission"]>[0]) {return this.repository.checkTaskAdmission(input);}
  readTaskForUser(input: Parameters<DrizzleNativeLiveRuntimeControlRepository["readTaskForUser"]>[0]) { return this.repository.readTaskForUser(input); }

  async waitTaskForListener(input: Parameters<DrizzleNativeLiveRuntimeControlRepository["reserveTaskForListener"]>[0] & { timeoutMs: number; signal?: AbortSignal | null }) {
    const take = () => this.repository.reserveTaskForListener(input);
    const immediate = await take();
    if (immediate) return { outcome: "reserved" as const, control: immediate };
    const broker = this.wakeBroker;
    if (!broker?.version || !broker.waitForChange || input.signal?.aborted) return { outcome: "timeout" as const };
    await broker.start();
    try {
      const version = broker.version(input.userId);
      const raced = await take();
      if (raced) return { outcome: "reserved" as const, control: raced };
      const wake = await broker.waitForChange({ userId: input.userId, afterVersion: version, timeoutMs: input.timeoutMs, signal: input.signal });
      const control = wake.outcome === "ready" ? await take() : null;
      return control ? { outcome: "reserved" as const, control } : { outcome: "timeout" as const };
    } finally { await broker.release?.(); }
  }

  reserveNextForListener(
    input: Parameters<
      DrizzleNativeLiveRuntimeControlRepository["reserveNextForListener"]
    >[0],
  ) {
    return this.repository.reserveNextForListener(input);
  }

  async waitNextForListener(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    timeoutMs: number;
    signal?: AbortSignal | null;
  }): Promise<
    | {
        outcome: "reserved";
        control: NativeLiveRuntimeControlRecord;
      }
    | { outcome: "timeout" }
  > {
    const immediate =
      await this.repository.reserveNextForListener({
        userId: input.userId,
        listenerInstanceId: input.listenerInstanceId,
        reservationId: input.reservationId,
      });
    if (immediate) {
      return { outcome: "reserved", control: immediate };
    }
    if (!this.wakeBroker) {
      return { outcome: "timeout" };
    }

    await this.wakeBroker.start();
    try {
      const version = this.wakeBroker.controlVersion(
        input.userId,
        input.reservationId,
      );

      const raced =
        await this.repository.reserveNextForListener({
          userId: input.userId,
          listenerInstanceId: input.listenerInstanceId,
          reservationId: input.reservationId,
        });
      if (raced) {
        return { outcome: "reserved", control: raced };
      }

      const wake = await this.wakeBroker.waitForControlChange({
        userId: input.userId,
        reservationId: input.reservationId,
        afterVersion: version,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });
      if (wake.outcome !== "ready") {
        return { outcome: "timeout" };
      }

      const control =
        await this.repository.reserveNextForListener({
          userId: input.userId,
          listenerInstanceId: input.listenerInstanceId,
          reservationId: input.reservationId,
        });
      return control
        ? { outcome: "reserved", control }
        : { outcome: "timeout" };
    } finally {
      await this.wakeBroker.release?.();
    }
  }

  async completeForListener(
    input: Parameters<
      DrizzleNativeLiveRuntimeControlRepository["completeForListener"]
    >[0],
  ) {
    const result =
      await this.repository.completeForListener(input);
    if (
      result === "applied"
      && input.outcome.status === "applied"
      && Array.isArray(input.outcome.receipt.still_queued)
    ) {
      try {
        await this.wakePublisher?.notify({
          userId: input.userId,
          kind: "turn_terminal",
          prepareId: input.reservationId,
        });
      } catch {
        // Applied control state is authoritative; wake delivery is advisory.
      }
    }
    return result;
  }

  listForUser(
    input: Parameters<
      DrizzleNativeLiveRuntimeControlRepository["listForUser"]
    >[0],
  ) {
    return this.repository.listForUser(input);
  }
}

function normalizePayload(
  kind: NativeLiveRuntimeControlKind,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new NativeLiveRuntimeControlError(
      "CONTROL_INVALID",
      "Native live runtime control payload must be an object.",
    );
  }
  if (kind === "interrupt") {
    if (Object.keys(input).length !== 0) {
      throw new NativeLiveRuntimeControlError(
        "CONTROL_INVALID",
        "Interrupt control payload must be empty.",
      );
    }
    return {};
  }

  if (
    typeof input.text !== "string"
    || input.text.trim().length === 0
    || input.text.trim().length > 8_000
    || Object.keys(input).some((key) => key !== "text")
  ) {
    throw new NativeLiveRuntimeControlError(
      "CONTROL_INVALID",
      "Mid-turn input requires only a nonblank text field up to 8000 characters.",
    );
  }
  return { text: input.text.trim() };
}

function normalizeReceipt(
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new NativeLiveRuntimeControlError(
      "CONTROL_INVALID",
      "Native live runtime control receipt must be an object.",
    );
  }
  return input;
}

function normalizeFailureCode(value: string): string {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > 64
    || !/^[A-Z0-9_:-]+$/u.test(normalized)
  ) {
    throw new NativeLiveRuntimeControlError(
      "CONTROL_INVALID",
      "Native live runtime control failure code is invalid.",
    );
  }
  return normalized;
}

export function mapControl(
  row: typeof nativeLiveRuntimeControls.$inferSelect,
): NativeLiveRuntimeControlRecord {
  return {
    controlId: row.id,
    prepareId: row.prepareId,
    kind: row.kind,
    payload: row.payload,
    status: row.status,
    reservedBy: row.reservedBy,
    receipt: row.receipt,
    failureCode: row.failureCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    appliedAt: row.appliedAt?.toISOString() ?? null,
  };
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
