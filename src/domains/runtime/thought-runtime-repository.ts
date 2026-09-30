import { and, desc, eq } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  runtimeSubjectStateTransitions,
  runtimeSubjectStates,
} from "../../database/schema.js";
import {
  THOUGHT_ACTIVE_LIMIT,
  isActiveThought,
  readThoughtLifecycle,
  writeThoughtDropped,
} from "./thought.js";

type Database = ReturnType<typeof createDatabase>["db"];
export type ThoughtTransaction =
  Parameters<Parameters<Database["transaction"]>[0]>[0];

export type ThoughtDropResult =
  | { outcome: "applied" | "idempotent" }
  | {
      outcome: "rejected";
      code: "THOUGHT_NOT_FOUND" | "THOUGHT_NOT_SETTLED";
    };

export interface ThoughtDropPort {
  dropThought(input: {
    userId: string;
    subjectId: string;
    stateId: string;
    droppedAt: string;
    droppedByMessageId: string;
  }): Promise<ThoughtDropResult>;
}

/**
 * Keeps at most `limit` active settled thoughts for one subject, dropping the
 * oldest first. Dropped thoughts are kept with their reason and a transition
 * row; nothing is deleted. Must run inside the transaction that made a thought
 * settled (or revived one), so the limit holds at every commit.
 */
export async function enforceThoughtCapacity(
  transaction: ThoughtTransaction,
  input: {
    userId: string;
    subjectId: string;
    droppedAt: string;
    limit?: number;
  },
): Promise<string[]> {
  const limit = input.limit ?? THOUGHT_ACTIVE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Thought active limit must be a positive integer.");
  }

  const rows = await transaction
    .select({
      id: runtimeSubjectStates.id,
      payload: runtimeSubjectStates.payload,
      envelope: runtimeSubjectStates.envelope,
    })
    .from(runtimeSubjectStates)
    .where(
      and(
        eq(runtimeSubjectStates.userId, input.userId),
        eq(runtimeSubjectStates.subjectId, input.subjectId),
        eq(runtimeSubjectStates.kind, "thought"),
        eq(runtimeSubjectStates.settlementStatus, "settled"),
        eq(runtimeSubjectStates.pathStatus, "current"),
        eq(runtimeSubjectStates.validityStatus, "valid"),
      ),
    )
    .orderBy(
      desc(runtimeSubjectStates.createdAt),
      desc(runtimeSubjectStates.id),
    )
    .for("update");

  const overflow = rows
    .filter((row) => isActiveThought(row.payload))
    .slice(limit);

  for (const row of overflow) {
    await transaction
      .update(runtimeSubjectStates)
      .set({
        payload: writeThoughtDropped(row.payload, {
          reason: "capacity",
          droppedAt: input.droppedAt,
        }),
        updatedAt: new Date(),
      })
      .where(eq(runtimeSubjectStates.id, row.id));
    await transaction.insert(runtimeSubjectStateTransitions).values({
      userId: input.userId,
      subjectId: input.subjectId,
      stateId: row.id,
      reason: "thought_dropped_capacity",
      beforeEnvelope: row.envelope,
      afterEnvelope: row.envelope,
    });
  }

  return overflow.map((row) => row.id);
}

export class DrizzleThoughtDropPort implements ThoughtDropPort {
  constructor(private readonly db: Database) {}

  async dropThought(input: {
    userId: string;
    subjectId: string;
    stateId: string;
    droppedAt: string;
    droppedByMessageId: string;
  }): Promise<ThoughtDropResult> {
    return this.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          id: runtimeSubjectStates.id,
          payload: runtimeSubjectStates.payload,
          envelope: runtimeSubjectStates.envelope,
          settlementStatus: runtimeSubjectStates.settlementStatus,
          pathStatus: runtimeSubjectStates.pathStatus,
          validityStatus: runtimeSubjectStates.validityStatus,
        })
        .from(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.id, input.stateId),
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            eq(runtimeSubjectStates.kind, "thought"),
          ),
        )
        .for("update")
        .limit(1);

      if (!row) return { outcome: "rejected", code: "THOUGHT_NOT_FOUND" };

      const lifecycle = readThoughtLifecycle(row.payload);
      if (lifecycle?.status === "dropped") {
        return { outcome: "idempotent" };
      }
      if (
        !lifecycle
        || row.settlementStatus !== "settled"
        || row.pathStatus !== "current"
        || row.validityStatus !== "valid"
      ) {
        return { outcome: "rejected", code: "THOUGHT_NOT_SETTLED" };
      }

      await transaction
        .update(runtimeSubjectStates)
        .set({
          payload: writeThoughtDropped(row.payload, {
            reason: "subject",
            droppedAt: input.droppedAt,
            droppedByMessageId: input.droppedByMessageId,
          }),
          updatedAt: new Date(),
        })
        .where(eq(runtimeSubjectStates.id, row.id));
      await transaction.insert(runtimeSubjectStateTransitions).values({
        userId: input.userId,
        subjectId: input.subjectId,
        stateId: row.id,
        reason: "thought_dropped_by_subject",
        beforeEnvelope: row.envelope,
        afterEnvelope: row.envelope,
      });
      return { outcome: "applied" };
    });
  }
}
