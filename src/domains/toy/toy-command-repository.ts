import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { toyCommands } from "../../database/schema.js";
import type {
  ToyAckInput,
  ToyCommandRecord,
  ToyCreateInput,
} from "./toy-command-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const selection = {
  id: toyCommands.id,
  userId: toyCommands.userId,
  action: toyCommands.action,
  percent: toyCommands.percent,
  status: toyCommands.status,
  createdAt: toyCommands.createdAt,
  expiresAt: toyCommands.expiresAt,
  claimedAt: toyCommands.claimedAt,
  completedAt: toyCommands.completedAt,
  expiredAt: toyCommands.expiredAt,
  error: toyCommands.error,
};

export type ToyAckRepositoryResult =
  | { kind: "updated" | "idempotent"; command: ToyCommandRecord }
  | { kind: "not_found" | "expired" | "conflict" };

export interface ToyCommandRepository {
  create(userId: string, input: ToyCreateInput): Promise<ToyCommandRecord>;
  claim(userId: string): Promise<ToyCommandRecord | null>;
  ack(userId: string, id: string, input: ToyAckInput): Promise<ToyAckRepositoryResult>;
}

export class DrizzleToyCommandRepository implements ToyCommandRepository {
  constructor(private readonly db: Database) {}

  async create(userId: string, input: ToyCreateInput): Promise<ToyCommandRecord> {
    return this.db.transaction(async (transaction) => {
      // Serialize command creation for one bound user so concurrent set/stop
      // transactions have one deterministic predecessor to replace.
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
      `);
      await this.expireElapsed(transaction, userId);

      await transaction
        .update(toyCommands)
        .set({
          status: "expired",
          expiredAt: sql`now()`,
        })
        .where(
          and(
            eq(toyCommands.userId, userId),
            eq(toyCommands.status, "pending"),
            eq(toyCommands.action, "set"),
            ...(input.action === "set"
              ? [gt(toyCommands.expiresAt, sql`now()`)]
              : []),
          ),
        );

      const [command] = await transaction
        .insert(toyCommands)
        .values({
          userId,
          action: input.action,
          percent: input.action === "set" ? input.percent : null,
          status: "pending",
          createdAt: sql`now()`,
          expiresAt: sql`now() + interval '10 seconds'`,
        })
        .returning(selection);

      if (!command) throw new Error("Toy command insert did not return a record.");
      return command;
    });
  }

  async claim(userId: string): Promise<ToyCommandRecord | null> {
    return this.db.transaction(async (transaction) => {
      await this.expireElapsed(transaction, userId);

      const result = await transaction.execute(sql`
        WITH candidate AS (
          SELECT id
          FROM toy_commands
          WHERE user_id = ${userId}::uuid
            AND status = 'pending'
            AND expires_at > now()
          ORDER BY
            CASE action WHEN 'stop' THEN 0 ELSE 1 END,
            created_at ASC,
            id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE toy_commands AS command
        SET status = 'claimed',
            claimed_at = now()
        FROM candidate
        WHERE command.id = candidate.id
          AND command.user_id = ${userId}::uuid
          AND command.status = 'pending'
          AND command.expires_at > now()
        RETURNING command.*
      `);

      return mapRawRecord(result[0]) ?? null;
    });
  }

  async ack(
    userId: string,
    id: string,
    input: ToyAckInput,
  ): Promise<ToyAckRepositoryResult> {
    return this.db.transaction(async (transaction) => {
      const locked = await transaction.execute(sql`
        SELECT *, expires_at <= now() AS is_expired
        FROM toy_commands
        WHERE id = ${id}::uuid
          AND user_id = ${userId}::uuid
        FOR UPDATE
      `);
      const command = mapRawRecord(locked[0]);
      if (!command) return { kind: "not_found" };

      if (
        (command.status === "pending" || command.status === "claimed") &&
        (locked[0] as Record<string, unknown>).is_expired === true
      ) {
        await transaction
          .update(toyCommands)
          .set({ status: "expired", expiredAt: sql`now()` })
          .where(and(eq(toyCommands.id, id), eq(toyCommands.userId, userId)));
        return { kind: "expired" };
      }

      if (command.status === "expired" || command.status === "pending") {
        return { kind: command.status === "expired" ? "expired" : "conflict" };
      }

      if (command.status === "completed") {
        return input.status === "completed"
          ? { kind: "idempotent", command }
          : { kind: "conflict" };
      }
      if (command.status === "failed") {
        return input.status === "failed" && command.error === input.error
          ? { kind: "idempotent", command }
          : { kind: "conflict" };
      }

      const [updated] = await transaction
        .update(toyCommands)
        .set({
          status: input.status,
          error: input.status === "failed" ? input.error : null,
          completedAt: sql`now()`,
        })
        .where(
          and(
            eq(toyCommands.id, id),
            eq(toyCommands.userId, userId),
            eq(toyCommands.status, "claimed"),
            gt(toyCommands.expiresAt, sql`now()`),
          ),
        )
        .returning(selection);

      return updated
        ? { kind: "updated", command: updated }
        : { kind: "conflict" };
    });
  }

  private async expireElapsed(transaction: Transaction, userId: string): Promise<void> {
    await transaction
      .update(toyCommands)
      .set({ status: "expired", expiredAt: sql`now()` })
      .where(
        and(
          eq(toyCommands.userId, userId),
          inArray(toyCommands.status, ["pending", "claimed"]),
          sql`${toyCommands.expiresAt} <= now()`,
        ),
      );
  }
}

function mapRawRecord(value: unknown): ToyCommandRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    action: row.action as ToyCommandRecord["action"],
    percent: row.percent === null ? null : Number(row.percent),
    status: row.status as ToyCommandRecord["status"],
    createdAt: new Date(String(row.created_at)),
    expiresAt: new Date(String(row.expires_at)),
    claimedAt: row.claimed_at ? new Date(String(row.claimed_at)) : null,
    completedAt: row.completed_at ? new Date(String(row.completed_at)) : null,
    expiredAt: row.expired_at ? new Date(String(row.expired_at)) : null,
    error: row.error === null ? null : String(row.error),
  };
}
