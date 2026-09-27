import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversations,
  runtimeProactivityWakes,
} from "../../database/schema.js";
import type {
  EffectStatus,
} from "./effect-protocol.js";
import type {
  ProactivityWakeDecision,
  ProactivityWakeGateInput,
} from "./proactivity-wake-contract.js";
import {
  normalizeProactivityWakeContext,
  type ProactivityWakeContextSnapshot,
  type ProactivityWakePort,
  type ProactivityWakeRecord,
  type ProactivityWakeStatus,
} from "./proactivity-wake-state.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;
type Executor = Database | Transaction;

type RawWakeRow = {
  id: string;
  userId: string;
  subjectId: string;
  gate: Record<string, unknown>;
  contactTarget: string | null;
  contextSnapshot: Record<string, unknown>;
  status: string;
  modelTaskId: string | null;
  decision: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  decidedAt: Date | null;
};

export class DrizzleProactivityWakeRepository
implements ProactivityWakePort {
  constructor(private readonly db: Database) {}

  async createOrGet(input: {
    gate: ProactivityWakeGateInput;
    contactTarget: string | null;
    context: ProactivityWakeContextSnapshot;
  }): Promise<ProactivityWakeRecord> {
    const gate = normalizeGate(input.gate);
    const context = normalizeProactivityWakeContext(input.context);
    const contactTarget = normalizeTarget(input.contactTarget);

    return this.db.transaction(async (transaction) => {
      await assertSourceConversationActive(
        transaction as Transaction,
        gate.userId,
        context,
      );

      await transaction
        .insert(runtimeProactivityWakes)
        .values({
          id: gate.wakeId,
          userId: gate.userId,
          subjectId: gate.subjectId,
          gate,
          contactTarget,
          contextSnapshot: context,
          status: "created",
        })
        .onConflictDoNothing();

      const current = await this.getWithExecutor(
        transaction as Transaction,
        gate.userId,
        gate.wakeId,
        true,
      );
      if (!current) {
        throw new Error(
          "Proactivity wake disappeared after create.",
        );
      }
      if (
        current.subjectId !== gate.subjectId
        || !isDeepStrictEqual(current.gate, gate)
        || current.contactTarget !== contactTarget
        || !isDeepStrictEqual(current.context, context)
      ) {
        throw new Error(
          "Proactivity wake id conflicts with existing durable state.",
        );
      }
      return current;
    });
  }

  get(input: {
    userId: string;
    wakeId: string;
  }): Promise<ProactivityWakeRecord | null> {
    return this.getWithExecutor(
      this.db,
      input.userId,
      input.wakeId,
      false,
    );
  }

  async markWaitingModel(input: {
    userId: string;
    wakeId: string;
    modelTaskId: string;
  }): Promise<ProactivityWakeRecord> {
    const taskId = input.modelTaskId.trim();
    if (!taskId) {
      throw new Error(
        "Proactivity wake model task id must not be blank.",
      );
    }

    return this.db.transaction(async (transaction) => {
      const snapshot = await this.requireCurrentWithExecutor(
        transaction as Transaction,
        input.userId,
        input.wakeId,
        false,
      );
      if (snapshot.status === "decided") return snapshot;

      await assertSourceConversationActive(
        transaction as Transaction,
        input.userId,
        snapshot.context,
      );

      const current = await this.requireCurrentWithExecutor(
        transaction as Transaction,
        input.userId,
        input.wakeId,
        true,
      );
      if (
        current.status === "waiting_model"
        && current.modelTaskId === taskId
      ) {
        return current;
      }
      if (current.status === "decided") return current;
      if (current.status !== "created") {
        throw new Error(
          "Proactivity wake model task binding conflicted.",
        );
      }

      await transaction
        .update(runtimeProactivityWakes)
        .set({
          status: "waiting_model",
          modelTaskId: taskId,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(runtimeProactivityWakes.id, input.wakeId),
            eq(runtimeProactivityWakes.userId, input.userId),
            eq(runtimeProactivityWakes.status, "created"),
          ),
        );

      const updated = await this.requireCurrentWithExecutor(
        transaction as Transaction,
        input.userId,
        input.wakeId,
        false,
      );
      if (
        updated.status === "waiting_model"
        && updated.modelTaskId === taskId
      ) {
        return updated;
      }
      throw new Error(
        "Proactivity wake model task binding conflicted.",
      );
    });
  }

  async completeDecision(input: {
    userId: string;
    wakeId: string;
    decision: ProactivityWakeDecision;
  }): Promise<ProactivityWakeRecord> {
    if (
      input.decision.wakeId !== input.wakeId
      || input.decision.userId !== input.userId
    ) {
      throw new Error(
        "Proactivity decision does not match wake identity.",
      );
    }

    return this.db.transaction(async (transaction) => {
      const snapshot = await this.requireCurrentWithExecutor(
        transaction as Transaction,
        input.userId,
        input.wakeId,
        false,
      );
      if (
        input.decision.subjectId !== snapshot.subjectId
        || input.decision.offeredAt !== snapshot.gate.offeredAt
      ) {
        throw new Error(
          "Proactivity decision does not match durable wake snapshot.",
        );
      }
      if (snapshot.status === "decided") {
        if (!isDeepStrictEqual(snapshot.decision, input.decision)) {
          throw new Error(
            "Proactivity wake already has a different decision.",
          );
        }
        return snapshot;
      }

      await assertSourceConversationActive(
        transaction as Transaction,
        input.userId,
        snapshot.context,
      );

      const current = await this.requireCurrentWithExecutor(
        transaction as Transaction,
        input.userId,
        input.wakeId,
        true,
      );
      if (current.status === "decided") {
        if (!isDeepStrictEqual(current.decision, input.decision)) {
          throw new Error(
            "Proactivity wake already has a different decision.",
          );
        }
        return current;
      }

      await transaction
        .update(runtimeProactivityWakes)
        .set({
          status: "decided",
          decision: input.decision,
          decidedAt: new Date(input.decision.decidedAt),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(runtimeProactivityWakes.id, input.wakeId),
            eq(runtimeProactivityWakes.userId, input.userId),
            inArray(runtimeProactivityWakes.status, [
              "created",
              "waiting_model",
            ]),
          ),
        );

      const completed = await this.requireCurrentWithExecutor(
        transaction as Transaction,
        input.userId,
        input.wakeId,
        false,
      );
      if (
        completed.status !== "decided"
        || !isDeepStrictEqual(
          completed.decision,
          input.decision,
        )
      ) {
        throw new Error(
          "Proactivity wake decision completion conflicted.",
        );
      }
      return completed;
    });
  }

  private async getWithExecutor(
    executor: Executor,
    userId: string,
    wakeId: string,
    lock: boolean,
  ): Promise<ProactivityWakeRecord | null> {
    const query = executor
      .select({
        id: runtimeProactivityWakes.id,
        userId: runtimeProactivityWakes.userId,
        subjectId: runtimeProactivityWakes.subjectId,
        gate: runtimeProactivityWakes.gate,
        contactTarget: runtimeProactivityWakes.contactTarget,
        contextSnapshot:
          runtimeProactivityWakes.contextSnapshot,
        status: runtimeProactivityWakes.status,
        modelTaskId: runtimeProactivityWakes.modelTaskId,
        decision: runtimeProactivityWakes.decision,
        createdAt: runtimeProactivityWakes.createdAt,
        updatedAt: runtimeProactivityWakes.updatedAt,
        decidedAt: runtimeProactivityWakes.decidedAt,
      })
      .from(runtimeProactivityWakes)
      .where(
        and(
          eq(runtimeProactivityWakes.id, wakeId),
          eq(runtimeProactivityWakes.userId, userId),
        ),
      );
    const rows = lock
      ? await query.for("update").limit(1)
      : await query.limit(1);
    return rows[0] ? parseRow(rows[0] as RawWakeRow) : null;
  }

  private async requireCurrentWithExecutor(
    executor: Executor,
    userId: string,
    wakeId: string,
    lock: boolean,
  ): Promise<ProactivityWakeRecord> {
    const current = await this.getWithExecutor(
      executor,
      userId,
      wakeId,
      lock,
    );
    if (!current) {
      throw new Error("Proactivity wake was not found.");
    }
    return current;
  }
}

async function assertSourceConversationActive(
  transaction: Transaction,
  userId: string,
  context: ProactivityWakeContextSnapshot,
): Promise<void> {
  const conversationId = context.sourceConversationId?.trim() ?? "";
  if (!conversationId) return;

  const rows = await transaction.execute<{ id: string }>(sql`
    SELECT id
    FROM conversations
    WHERE id = ${conversationId}::uuid
      AND user_id = ${userId}::uuid
      AND origin = 'native_live'
      AND lifecycle_status = 'active'
    FOR SHARE
  `);
  if (rows.length !== 1) {
    throw new Error("ProactivityWakeSourceConversationInactive");
  }
}

function normalizeTarget(value: string | null): string | null {
  if (value === null) return null;
  const target = value.trim();
  if (!target) {
    throw new Error(
      "Proactivity wake contact target must not be blank.",
    );
  }
  if ([...target].length > 512) {
    throw new Error(
      "Proactivity wake contact target is too long.",
    );
  }
  return target;
}

function normalizeGate(
  input: ProactivityWakeGateInput,
): ProactivityWakeGateInput {
  const wakeId = input.wakeId.trim();
  const userId = input.userId.trim();
  const subjectId = input.subjectId.trim();
  if (!wakeId || !userId || !subjectId) {
    throw new Error(
      "Proactivity wake identity fields must not be blank.",
    );
  }

  return {
    ...input,
    wakeId,
    userId,
    subjectId,
    offeredAt: iso(input.offeredAt, "offeredAt"),
    quietUntil:
      input.quietUntil === null
        ? null
        : iso(input.quietUntil, "quietUntil"),
    nextEligibleAt:
      input.nextEligibleAt === null
        ? null
        : iso(input.nextEligibleAt, "nextEligibleAt"),
  };
}

function parseRow(row: RawWakeRow): ProactivityWakeRecord {
  return {
    id: row.id,
    userId: row.userId,
    subjectId: row.subjectId,
    gate: parseGate(row.gate),
    contactTarget: row.contactTarget,
    context: parseContext(row.contextSnapshot),
    status: parseStatus(row.status),
    modelTaskId: row.modelTaskId,
    decision:
      row.decision === null
        ? null
        : parseDecision(row.decision),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

function parseStatus(value: string): ProactivityWakeStatus {
  if (
    value !== "created"
    && value !== "waiting_model"
    && value !== "decided"
  ) {
    throw new Error(
      "Proactivity wake status is invalid.",
    );
  }
  return value;
}

function parseGate(
  value: Record<string, unknown>,
): ProactivityWakeGateInput {
  const status = value.outstandingEffectStatus;
  if (
    status !== null
    && !isEffectStatus(status)
  ) {
    throw new Error(
      "Proactivity wake outstanding effect status is invalid.",
    );
  }
  if (
    typeof value.wakeId !== "string"
    || typeof value.userId !== "string"
    || typeof value.subjectId !== "string"
    || typeof value.offeredAt !== "string"
    || (value.mode !== "live" && value.mode !== "replay")
    || typeof value.enabled !== "boolean"
    || typeof value.foregroundActive !== "boolean"
    || (
      value.quietUntil !== null
      && typeof value.quietUntil !== "string"
    )
    || (
      value.nextEligibleAt !== null
      && typeof value.nextEligibleAt !== "string"
    )
  ) {
    throw new Error(
      "Proactivity wake gate snapshot is invalid.",
    );
  }
  return normalizeGate({
    wakeId: value.wakeId,
    userId: value.userId,
    subjectId: value.subjectId,
    offeredAt: value.offeredAt,
    mode: value.mode,
    enabled: value.enabled,
    foregroundActive: value.foregroundActive,
    outstandingEffectStatus: status,
    quietUntil: value.quietUntil,
    nextEligibleAt: value.nextEligibleAt,
  });
}

function parseContext(
  value: Record<string, unknown>,
): ProactivityWakeContextSnapshot {
  if (
    value.version !== 1
    || (
      value.contextManifestId !== null
      && typeof value.contextManifestId !== "string"
    )
    || typeof value.capsule !== "string"
    || (
      value.sourceConversationId !== undefined
      && value.sourceConversationId !== null
      && typeof value.sourceConversationId !== "string"
    )
    || (
      value.sourceHeadMessageId !== undefined
      && value.sourceHeadMessageId !== null
      && typeof value.sourceHeadMessageId !== "string"
    )
    || (
      value.sourceActivityAt !== undefined
      && value.sourceActivityAt !== null
      && typeof value.sourceActivityAt !== "string"
    )
  ) {
    throw new Error(
      "Proactivity wake context snapshot is invalid.",
    );
  }
  return normalizeProactivityWakeContext({
    version: 1,
    contextManifestId: value.contextManifestId,
    capsule: value.capsule,
    sourceConversationId:
      value.sourceConversationId as string | null | undefined,
    sourceHeadMessageId:
      value.sourceHeadMessageId as string | null | undefined,
    sourceActivityAt:
      value.sourceActivityAt as string | null | undefined,
  });
}

function parseDecision(
  value: Record<string, unknown>,
): ProactivityWakeDecision {
  if (
    typeof value.decisionId !== "string"
    || typeof value.wakeId !== "string"
    || typeof value.userId !== "string"
    || typeof value.subjectId !== "string"
    || typeof value.offeredAt !== "string"
    || typeof value.decidedAt !== "string"
    || (
      value.outcome !== "quiet"
      && value.outcome !== "reflect"
      && value.outcome !== "contact_candidate"
    )
    || typeof value.reasonCode !== "string"
    || (
      value.contactText !== null
      && typeof value.contactText !== "string"
    )
    || (
      value.effectIntent !== null
      && (
        typeof value.effectIntent !== "object"
        || Array.isArray(value.effectIntent)
      )
    )
  ) {
    throw new Error(
      "Proactivity wake decision snapshot is invalid.",
    );
  }
  return value as unknown as ProactivityWakeDecision;
}

function isEffectStatus(value: unknown): value is EffectStatus {
  return (
    value === "pending"
    || value === "reserved"
    || value === "dispatching"
    || value === "observed"
    || value === "failed"
    || value === "unknown"
  );
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Proactivity wake " + field + " must be an ISO timestamp.",
    );
  }
  return new Date(parsed).toISOString();
}
