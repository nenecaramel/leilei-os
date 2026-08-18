import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { toyCommands, users } from "../../database/schema.js";
import type {
  ToyAckInput,
  ToyCommandRecord,
  ToyCreateInput,
} from "./toy-command-types.js";
import { TOY_DEFAULT_DURATION_SECONDS } from "./toy-command-types.js";
import { requireActiveUser } from "../require-active-user.js";
import {
  lockAndReadMcpIdempotency,
  recordMcpIdempotency,
  type McpIdempotentToolName,
} from "../mcp-write/mcp-write-idempotency.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const selection = {
  id: toyCommands.id,
  userId: toyCommands.userId,
  action: toyCommands.action,
  percent: toyCommands.percent,
  durationSeconds: toyCommands.durationSeconds,
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

export type ToyIdempotentCreateResult =
  | { outcome: "created" | "replayed"; command: ToyCommandRecord }
  | { outcome: "conflict" };

export interface ToyCommandRepository {
  findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null>;
  create(userId: string, input: ToyCreateInput): Promise<ToyCommandRecord>;
  createIdempotently?(
    userId: string,
    input: ToyCreateInput & {
      toolName: Extract<McpIdempotentToolName, "toy_set" | "toy_stop">;
      idempotencyKey: string;
      requestHash: string;
    },
  ): Promise<ToyIdempotentCreateResult>;
  claim(userId: string): Promise<ToyCommandRecord | null>;
  ack(userId: string, id: string, input: ToyAckInput): Promise<ToyAckRepositoryResult>;
}

export class DrizzleToyCommandRepository implements ToyCommandRepository {
  constructor(private readonly db: Database) {}

  async findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ?? null;
  }

  async create(userId: string, input: ToyCreateInput): Promise<ToyCommandRecord> {
    return this.db.transaction((transaction) =>
      this.withActiveUser(transaction, userId, () =>
        this.createInTransaction(transaction, userId, input),
      ),
    );
  }

  async createIdempotently(
    userId: string,
    input: ToyCreateInput & {
      toolName: "toy_set" | "toy_stop";
      idempotencyKey: string;
      requestHash: string;
    },
  ): Promise<ToyIdempotentCreateResult> {
    return this.db.transaction(async (transaction) => {
      await this.requireActiveUserInTransaction(transaction, userId);
      const idempotency = await lockAndReadMcpIdempotency(transaction, {
        userId,
        toolName: input.toolName,
        idempotencyKey: input.idempotencyKey,
      });

      if (idempotency) {
        if (
          idempotency.requestHash !== input.requestHash ||
          idempotency.resourceType !== "toy_command"
        ) {
          return { outcome: "conflict" };
        }

        const [command] = await transaction
          .select(selection)
          .from(toyCommands)
          .where(
            and(
              eq(toyCommands.userId, userId),
              eq(toyCommands.id, idempotency.resourceId),
            ),
          )
          .limit(1);

        if (!command) throw new Error("Idempotent toy command was not found.");
        return { outcome: "replayed", command };
      }

      const command = await this.createInTransaction(transaction, userId, input);
      await recordMcpIdempotency(transaction, {
        userId,
        toolName: input.toolName,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        resourceType: "toy_command",
        resourceId: command.id,
      });
      return { outcome: "created", command };
    });
  }

  private async createInTransaction(
    transaction: Transaction,
    userId: string,
    input: ToyCreateInput,
  ): Promise<ToyCommandRecord> {
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
        durationSeconds:
          input.action === "set"
            ? input.durationSeconds ?? TOY_DEFAULT_DURATION_SECONDS
            : null,
        status: "pending",
        createdAt: sql`now()`,
        expiresAt: sql`now() + interval '10 seconds'`,
      })
      .returning(selection);

    if (!command) throw new Error("Toy command insert did not return a record.");
    return command;
  }

  async claim(userId: string): Promise<ToyCommandRecord | null> {
    return this.db.transaction(async (transaction) => {
      await this.requireActiveUserInTransaction(transaction, userId);
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
      await this.requireActiveUserInTransaction(transaction, userId);
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

  private async withActiveUser<T>(
    transaction: Transaction,
    userId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    await this.requireActiveUserInTransaction(transaction, userId);
    return work();
  }

  private async requireActiveUserInTransaction(
    transaction: Transaction,
    userId: string,
  ): Promise<void> {
    await requireActiveUser(
      {
        findUserById: async (candidate) => {
          const [user] = await transaction
            .select({ status: users.status })
            .from(users)
            .where(eq(users.id, candidate))
            .limit(1);
          return user ?? null;
        },
      },
      userId,
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
    durationSeconds:
      row.duration_seconds === null ? null : Number(row.duration_seconds),
    status: row.status as ToyCommandRecord["status"],
    createdAt: new Date(String(row.created_at)),
    expiresAt: new Date(String(row.expires_at)),
    claimedAt: row.claimed_at ? new Date(String(row.claimed_at)) : null,
    completedAt: row.completed_at ? new Date(String(row.completed_at)) : null,
    expiredAt: row.expired_at ? new Date(String(row.expired_at)) : null,
    error: row.error === null ? null : String(row.error),
  };
}
