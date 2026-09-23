import { and, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  nativeLiveBackgroundModelJobs,
} from "../../database/schema.js";
import {
  RETENTION_BATCH_SIZE,
} from "../retention/retention-policy.js";
import {
  assertBackgroundModelResultMatchesCommand,
  parseNativeLiveBackgroundModelCommand,
  parseNativeLiveBackgroundModelExecutionResult,
  type NativeLiveBackgroundModelCommand,
  type NativeLiveBackgroundModelExecutionResult,
} from "./native-live-background-model-protocol.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const BACKGROUND_RESERVATION_LEASE_MS = 60_000;

export type NativeLiveBackgroundModelReservation = {
  reservationId: string;
  command: NativeLiveBackgroundModelCommand;
};

export type NativeLiveBackgroundModelJob = {
  id: string;
  userId: string;
  subjectId: string;
  command: NativeLiveBackgroundModelCommand;
  status: "pending" | "reserved" | "completed" | "failed";
  reservedBy: string | null;
  resultText: string | null;
  errorCode: string | null;
};

export class NativeLiveBackgroundModelQueueError extends Error {
  constructor(
    readonly code:
      | "LISTENER_NOT_ACTIVE"
      | "TASK_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveBackgroundModelQueueError";
  }
}

export class DrizzleNativeLiveBackgroundModelQueueRepository {
  constructor(private readonly db: Database) {}

  async stage(input: {
    userId: string;
    subjectId: string;
    command: NativeLiveBackgroundModelCommand;
  }): Promise<NativeLiveBackgroundModelJob> {
    const command = parseNativeLiveBackgroundModelCommand(input.command);
    const subjectId = input.subjectId.trim();
    if (!subjectId) {
      throw new Error("Background model subject id must not be blank.");
    }

    await this.db
      .insert(nativeLiveBackgroundModelJobs)
      .values({
        id: command.task_id,
        userId: input.userId,
        subjectId,
        taskKind: command.task_kind,
        promptContractVersion: command.prompt_contract_version,
        prompt: command.prompt,
        status: "pending",
      })
      .onConflictDoNothing();

    const existing = await this.get({
      userId: input.userId,
      taskId: command.task_id,
    });
    if (
      !existing
      || existing.subjectId !== subjectId
      || existing.command.task_kind !== command.task_kind
      || existing.command.prompt_contract_version
        !== command.prompt_contract_version
      || existing.command.prompt !== command.prompt
    ) {
      throw new NativeLiveBackgroundModelQueueError(
        "TASK_CONFLICT",
        "Background model task conflicts with an existing task id.",
      );
    }
    return existing;
  }

  async reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLiveBackgroundModelReservation | null> {
    return this.db.transaction(async (transaction) => {
      const lease = await transaction.execute<{ user_id: string }>(sql`
        UPDATE native_live_runtime_listener_leases
        SET lease_expires_at =
              now() + 60000 * interval '1 millisecond',
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND dispatch_target = 'claude_code'
          AND listener_instance_id = ${input.listenerInstanceId}::uuid
          AND lease_expires_at > now()
        RETURNING user_id
      `);
      if (lease.length !== 1) {
        throw new NativeLiveBackgroundModelQueueError(
          "LISTENER_NOT_ACTIVE",
          "Native live background listener lease is not active.",
        );
      }

      await transaction.execute(sql`
        UPDATE native_live_background_model_jobs
        SET status = 'pending',
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND status = 'reserved'
          AND reservation_expires_at <= now()
      `);

      const reserved = await transaction.execute<{ id: string }>(sql`
        WITH candidate AS (
          SELECT id
          FROM native_live_background_model_jobs
          WHERE user_id = ${input.userId}::uuid
            AND status = 'pending'
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE native_live_background_model_jobs AS job
        SET status = 'reserved',
            reserved_by = ${input.listenerInstanceId}::uuid,
            reserved_at = now(),
            reservation_expires_at =
              now() + ${BACKGROUND_RESERVATION_LEASE_MS}
                * interval '1 millisecond',
            updated_at = now()
        FROM candidate
        WHERE job.id = candidate.id
          AND job.user_id = ${input.userId}::uuid
          AND job.status = 'pending'
        RETURNING job.id
      `);

      const taskId = reserved[0]?.id;
      if (!taskId) return null;
      const job = await this.getWithExecutor(
        transaction as Transaction,
        input.userId,
        taskId,
      );
      if (!job) {
        throw new Error("Reserved background model task disappeared.");
      }
      return {
        reservationId: job.id,
        command: job.command,
      };
    });
  }

  async submitResult(input: {
    userId: string;
    listenerInstanceId: string;
    taskId: string;
    result: NativeLiveBackgroundModelExecutionResult;
  }): Promise<NativeLiveBackgroundModelJob> {
    const parsedResult =
      parseNativeLiveBackgroundModelExecutionResult(input.result);

    return this.db.transaction(async (transaction) => {
      const current = await this.getWithExecutor(
        transaction as Transaction,
        input.userId,
        input.taskId,
        true,
      );
      if (!current) {
        throw new NativeLiveBackgroundModelQueueError(
          "TASK_CONFLICT",
          "Background model task was not found.",
        );
      }

      try {
        assertBackgroundModelResultMatchesCommand(
          current.command,
          parsedResult,
        );
      } catch {
        throw new NativeLiveBackgroundModelQueueError(
          "TASK_CONFLICT",
          "Background model result does not match task identity.",
        );
      }

      if (
        current.status === "completed"
        || current.status === "failed"
      ) {
        const same =
          (
            current.status === "completed"
            && parsedResult.status === "success"
            && current.resultText === parsedResult.final_text
          )
          || (
            current.status === "failed"
            && parsedResult.status === "failure"
            && current.errorCode === parsedResult.error_code
          );
        if (!same) {
          throw new NativeLiveBackgroundModelQueueError(
            "TASK_CONFLICT",
            "Background model result conflicts with terminal task state.",
          );
        }
        return current;
      }

      if (
        current.status !== "reserved"
        || current.reservedBy !== input.listenerInstanceId
      ) {
        throw new NativeLiveBackgroundModelQueueError(
          "TASK_CONFLICT",
          "Background model task is not reserved by this listener.",
        );
      }

      const completedAt = new Date();
      await transaction
        .update(nativeLiveBackgroundModelJobs)
        .set(
          parsedResult.status === "success"
            ? {
                status: "completed",
                reservedBy: null,
                reservedAt: null,
                reservationExpiresAt: null,
                resultText: parsedResult.final_text,
                errorCode: null,
                completedAt,
                updatedAt: completedAt,
              }
            : {
                status: "failed",
                reservedBy: null,
                reservedAt: null,
                reservationExpiresAt: null,
                resultText: null,
                errorCode: parsedResult.error_code,
                completedAt,
                updatedAt: completedAt,
              },
        )
        .where(
          and(
            eq(nativeLiveBackgroundModelJobs.id, input.taskId),
            eq(nativeLiveBackgroundModelJobs.userId, input.userId),
            eq(nativeLiveBackgroundModelJobs.status, "reserved"),
            eq(
              nativeLiveBackgroundModelJobs.reservedBy,
              input.listenerInstanceId,
            ),
          ),
        );

      const updated = await this.getWithExecutor(
        transaction as Transaction,
        input.userId,
        input.taskId,
      );
      if (!updated) {
        throw new Error("Completed background model task disappeared.");
      }
      return updated;
    });
  }

  async get(input: {
    userId: string;
    taskId: string;
  }): Promise<NativeLiveBackgroundModelJob | null> {
    return this.getWithExecutor(this.db, input.userId, input.taskId);
  }

  private async getWithExecutor(
    executor: Database | Transaction,
    userId: string,
    taskId: string,
    lock = false,
  ): Promise<NativeLiveBackgroundModelJob | null> {
    const query = executor
      .select({
        id: nativeLiveBackgroundModelJobs.id,
        userId: nativeLiveBackgroundModelJobs.userId,
        subjectId: nativeLiveBackgroundModelJobs.subjectId,
        taskKind: nativeLiveBackgroundModelJobs.taskKind,
        promptContractVersion:
          nativeLiveBackgroundModelJobs.promptContractVersion,
        prompt: nativeLiveBackgroundModelJobs.prompt,
        status: nativeLiveBackgroundModelJobs.status,
        reservedBy: nativeLiveBackgroundModelJobs.reservedBy,
        resultText: nativeLiveBackgroundModelJobs.resultText,
        errorCode: nativeLiveBackgroundModelJobs.errorCode,
      })
      .from(nativeLiveBackgroundModelJobs)
      .where(
        and(
          eq(nativeLiveBackgroundModelJobs.id, taskId),
          eq(nativeLiveBackgroundModelJobs.userId, userId),
        ),
      );

    const rows = lock
      ? await query.for("update").limit(1)
      : await query.limit(1);
    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      subjectId: row.subjectId,
      command: parseNativeLiveBackgroundModelCommand({
        protocol_version: 1,
        task_id: row.id,
        task_kind: row.taskKind,
        prompt_contract_version: row.promptContractVersion,
        prompt: row.prompt,
      }),
      status: row.status,
      reservedBy: row.reservedBy,
      resultText: row.resultText,
      errorCode: row.errorCode,
    };
  }
}

export class NativeLiveBackgroundModelQueueService {
  constructor(
    private readonly repository:
      DrizzleNativeLiveBackgroundModelQueueRepository,
  ) {}

  stage(input: {
    userId: string;
    subjectId: string;
    command: NativeLiveBackgroundModelCommand;
  }): Promise<NativeLiveBackgroundModelJob> {
    return this.repository.stage(input);
  }

  reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLiveBackgroundModelReservation | null> {
    return this.repository.reserveNext(input);
  }

  submitResult(input: {
    userId: string;
    listenerInstanceId: string;
    taskId: string;
    result: NativeLiveBackgroundModelExecutionResult;
  }): Promise<NativeLiveBackgroundModelJob> {
    return this.repository.submitResult(input);
  }
}

export async function deleteExpiredNativeLiveBackgroundModelJobsBatch(
  db: Database,
  cutoff: Date,
  limit: number,
): Promise<number> {
  if (
    !Number.isInteger(limit)
    || limit <= 0
    || limit > RETENTION_BATCH_SIZE
  ) {
    throw new RangeError(
      `limit must be a positive integer no greater than ${RETENTION_BATCH_SIZE}`,
    );
  }

  return db.transaction(async (transaction) => {
    const victims = await transaction.execute<{ id: string }>(sql`
      SELECT id
      FROM native_live_background_model_jobs
      WHERE status IN ('completed', 'failed')
        AND completed_at < ${cutoff.toISOString()}::timestamptz
      ORDER BY completed_at ASC, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    const ids = victims.map((victim) => victim.id);
    if (ids.length === 0) return 0;

    const deleted = await transaction
      .delete(nativeLiveBackgroundModelJobs)
      .where(inArray(nativeLiveBackgroundModelJobs.id, ids))
      .returning({ id: nativeLiveBackgroundModelJobs.id });
    return deleted.length;
  });
}
