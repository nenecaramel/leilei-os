import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversations,
  nativeLiveBackgroundModelJobs,
  runtimeProactivityWakes,
  runtimeSubjectStates,
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

export type NativeLiveBackgroundModelWorkflowKind =
  | "topic_resurface"
  | "distillation"
  | "proactivity_wake";

export type NativeLiveBackgroundModelWorkflow = {
  kind: NativeLiveBackgroundModelWorkflowKind;
  runId: string;
  payload: Record<string, unknown>;
};

export type NativeLiveBackgroundModelJob = {
  id: string;
  userId: string;
  subjectId: string;
  workflow: NativeLiveBackgroundModelWorkflow | null;
  command: NativeLiveBackgroundModelCommand;
  status: "pending" | "reserved" | "completed" | "failed";
  reservedBy: string | null;
  resultText: string | null;
  errorCode: string | null;
  consumedAt: Date | null;
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
    workflow?: NativeLiveBackgroundModelWorkflow;
  }): Promise<NativeLiveBackgroundModelJob> {
    const command = parseNativeLiveBackgroundModelCommand(input.command);
    const subjectId = input.subjectId.trim();
    if (!subjectId) {
      throw new Error("Background model subject id must not be blank.");
    }

    return this.db.transaction(async (transaction) => {
      await assertWorkflowSourceActive(
        transaction as Transaction,
        input.userId,
        subjectId,
        input.workflow,
      );

      await transaction
        .insert(nativeLiveBackgroundModelJobs)
        .values({
          id: command.task_id,
          userId: input.userId,
          subjectId,
          workflowKind: input.workflow?.kind ?? null,
          workflowRunId: input.workflow?.runId ?? null,
          workflowPayload: input.workflow?.payload ?? null,
          taskKind: command.task_kind,
          promptContractVersion: command.prompt_contract_version,
          prompt: command.prompt,
          status: "pending",
        })
        .onConflictDoNothing();

      const existing = await this.getWithExecutor(
        transaction as Transaction,
        input.userId,
        command.task_id,
      );
      if (
        !existing
        || existing.subjectId !== subjectId
        || existing.command.task_kind !== command.task_kind
        || existing.command.prompt_contract_version
          !== command.prompt_contract_version
        || existing.command.prompt !== command.prompt
        || !isDeepStrictEqual(
          existing.workflow,
          input.workflow ?? null,
        )
      ) {
        throw new NativeLiveBackgroundModelQueueError(
          "TASK_CONFLICT",
          "Background model task conflicts with an existing task id.",
        );
      }
      return existing;
    });
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
            AND (
              workflow_kind IS NULL
              OR workflow_kind = 'topic_resurface'
              OR (
                workflow_kind = 'distillation'
                AND EXISTS (
                  SELECT 1
                  FROM conversations AS source_conversation
                  WHERE source_conversation.user_id =
                      native_live_background_model_jobs.user_id
                    AND source_conversation.origin = 'native_live'
                    AND source_conversation.lifecycle_status = 'active'
                    AND source_conversation.id::text =
                      native_live_background_model_jobs.workflow_payload
                        ->> 'conversation_id'
                )
              )
              OR (
                workflow_kind = 'proactivity_wake'
                AND EXISTS (
                  SELECT 1
                  FROM runtime_proactivity_wakes AS source_wake
                  WHERE source_wake.id =
                      native_live_background_model_jobs.workflow_run_id
                    AND source_wake.user_id =
                      native_live_background_model_jobs.user_id
                    AND (
                      NULLIF(
                        btrim(
                          source_wake.context_snapshot
                            ->> 'sourceConversationId'
                        ),
                        ''
                      ) IS NULL
                      OR EXISTS (
                        SELECT 1
                        FROM conversations AS source_conversation
                        WHERE source_conversation.user_id =
                            source_wake.user_id
                          AND source_conversation.origin = 'native_live'
                          AND source_conversation.lifecycle_status = 'active'
                          AND source_conversation.id::text =
                            source_wake.context_snapshot
                              ->> 'sourceConversationId'
                      )
                    )
                )
              )
            )
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
                consumedAt: current.workflow ? null : completedAt,
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
                consumedAt: current.workflow ? null : completedAt,
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
        workflowKind: nativeLiveBackgroundModelJobs.workflowKind,
        workflowRunId: nativeLiveBackgroundModelJobs.workflowRunId,
        workflowPayload: nativeLiveBackgroundModelJobs.workflowPayload,
        taskKind: nativeLiveBackgroundModelJobs.taskKind,
        promptContractVersion:
          nativeLiveBackgroundModelJobs.promptContractVersion,
        prompt: nativeLiveBackgroundModelJobs.prompt,
        status: nativeLiveBackgroundModelJobs.status,
        reservedBy: nativeLiveBackgroundModelJobs.reservedBy,
        resultText: nativeLiveBackgroundModelJobs.resultText,
        errorCode: nativeLiveBackgroundModelJobs.errorCode,
        consumedAt: nativeLiveBackgroundModelJobs.consumedAt,
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
      workflow:
        (
          row.workflowKind === "topic_resurface"
          || row.workflowKind === "distillation"
          || row.workflowKind === "proactivity_wake"
        )
        && row.workflowRunId
        && row.workflowPayload
          ? {
              kind: row.workflowKind,
              runId: row.workflowRunId,
              payload: row.workflowPayload,
            }
          : null,
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
      consumedAt: row.consumedAt,
    };
  }

  async findOpenTopicResurface(input: {
    userId: string;
    subjectId: string;
  }): Promise<NativeLiveBackgroundModelJob | null> {
    const [row] = await this.db
      .select({ id: nativeLiveBackgroundModelJobs.id })
      .from(nativeLiveBackgroundModelJobs)
      .where(
        and(
          eq(nativeLiveBackgroundModelJobs.userId, input.userId),
          eq(nativeLiveBackgroundModelJobs.subjectId, input.subjectId),
          eq(nativeLiveBackgroundModelJobs.workflowKind, "topic_resurface"),
          or(
            eq(nativeLiveBackgroundModelJobs.status, "pending"),
            eq(nativeLiveBackgroundModelJobs.status, "reserved"),
            and(
              or(
                eq(nativeLiveBackgroundModelJobs.status, "completed"),
                eq(nativeLiveBackgroundModelJobs.status, "failed"),
              ),
              isNull(nativeLiveBackgroundModelJobs.consumedAt),
            ),
          ),
        ),
      )
      .orderBy(
        asc(nativeLiveBackgroundModelJobs.createdAt),
        asc(nativeLiveBackgroundModelJobs.id),
      )
      .limit(1);
    return row
      ? this.get({ userId: input.userId, taskId: row.id })
      : null;
  }

  async findOpenDistillation(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
  }): Promise<NativeLiveBackgroundModelJob | null> {
    const [row] = await this.db
      .select({ id: nativeLiveBackgroundModelJobs.id })
      .from(nativeLiveBackgroundModelJobs)
      .where(
        and(
          eq(nativeLiveBackgroundModelJobs.userId, input.userId),
          eq(nativeLiveBackgroundModelJobs.subjectId, input.subjectId),
          eq(nativeLiveBackgroundModelJobs.workflowKind, "distillation"),
          sql`${nativeLiveBackgroundModelJobs.workflowPayload}
            ->> 'conversation_id' = ${input.conversationId}`,
          or(
            eq(nativeLiveBackgroundModelJobs.status, "pending"),
            eq(nativeLiveBackgroundModelJobs.status, "reserved"),
            and(
              or(
                eq(nativeLiveBackgroundModelJobs.status, "completed"),
                eq(nativeLiveBackgroundModelJobs.status, "failed"),
              ),
              isNull(nativeLiveBackgroundModelJobs.consumedAt),
            ),
          ),
        ),
      )
      .orderBy(
        asc(nativeLiveBackgroundModelJobs.createdAt),
        asc(nativeLiveBackgroundModelJobs.id),
      )
      .limit(1);
    return row
      ? this.get({ userId: input.userId, taskId: row.id })
      : null;
  }

  async findNextUnconsumedTerminalForWorkflow(input: {
    userId: string;
    workflowKind: NativeLiveBackgroundModelWorkflowKind;
  }): Promise<NativeLiveBackgroundModelJob | null> {
    const [row] = await this.db
      .select({ id: nativeLiveBackgroundModelJobs.id })
      .from(nativeLiveBackgroundModelJobs)
      .where(
        and(
          eq(nativeLiveBackgroundModelJobs.userId, input.userId),
          eq(
            nativeLiveBackgroundModelJobs.workflowKind,
            input.workflowKind,
          ),
          isNull(nativeLiveBackgroundModelJobs.consumedAt),
          or(
            eq(nativeLiveBackgroundModelJobs.status, "completed"),
            eq(nativeLiveBackgroundModelJobs.status, "failed"),
          ),
          sql`(
              workflow_kind IS NULL
              OR workflow_kind = 'topic_resurface'
              OR (
                workflow_kind = 'distillation'
                AND EXISTS (
                  SELECT 1
                  FROM conversations AS source_conversation
                  WHERE source_conversation.user_id =
                      native_live_background_model_jobs.user_id
                    AND source_conversation.origin = 'native_live'
                    AND source_conversation.lifecycle_status = 'active'
                    AND source_conversation.id::text =
                      native_live_background_model_jobs.workflow_payload
                        ->> 'conversation_id'
                )
              )
              OR (
                workflow_kind = 'proactivity_wake'
                AND EXISTS (
                  SELECT 1
                  FROM runtime_proactivity_wakes AS source_wake
                  WHERE source_wake.id =
                      native_live_background_model_jobs.workflow_run_id
                    AND source_wake.user_id =
                      native_live_background_model_jobs.user_id
                    AND (
                      NULLIF(
                        btrim(
                          source_wake.context_snapshot
                            ->> 'sourceConversationId'
                        ),
                        ''
                      ) IS NULL
                      OR EXISTS (
                        SELECT 1
                        FROM conversations AS source_conversation
                        WHERE source_conversation.user_id =
                            source_wake.user_id
                          AND source_conversation.origin = 'native_live'
                          AND source_conversation.lifecycle_status = 'active'
                          AND source_conversation.id::text =
                            source_wake.context_snapshot
                              ->> 'sourceConversationId'
                      )
                    )
                )
              )
            )`,
        ),
      )
      .orderBy(
        asc(nativeLiveBackgroundModelJobs.completedAt),
        asc(nativeLiveBackgroundModelJobs.id),
      )
      .limit(1);
    return row
      ? this.get({ userId: input.userId, taskId: row.id })
      : null;
  }

  findNextUnconsumedTerminal(input: {
    userId: string;
  }): Promise<NativeLiveBackgroundModelJob | null> {
    return this.findNextUnconsumedTerminalForWorkflow({
      ...input,
      workflowKind: "topic_resurface",
    });
  }

  async markConsumed(input: {
    userId: string;
    taskId: string;
  }): Promise<void> {
    const consumedAt = new Date();
    await this.db
      .update(nativeLiveBackgroundModelJobs)
      .set({ consumedAt, updatedAt: consumedAt })
      .where(
        and(
          eq(nativeLiveBackgroundModelJobs.userId, input.userId),
          eq(nativeLiveBackgroundModelJobs.id, input.taskId),
          isNull(nativeLiveBackgroundModelJobs.consumedAt),
          or(
            eq(nativeLiveBackgroundModelJobs.status, "completed"),
            eq(nativeLiveBackgroundModelJobs.status, "failed"),
          ),
        ),
      );
  }
}

export class NativeLiveBackgroundModelQueueService {
  constructor(
    private readonly repository:
      DrizzleNativeLiveBackgroundModelQueueRepository,
    private readonly workWake?: {
      notify(input: {
        userId: string;
        kind: "background_model";
      }): Promise<void>;
    },
  ) {}

  async stage(input: {
    userId: string;
    subjectId: string;
    command: NativeLiveBackgroundModelCommand;
    workflow?: NativeLiveBackgroundModelWorkflow;
  }): Promise<NativeLiveBackgroundModelJob> {
    const job = await this.repository.stage(input);
    try {
      await this.workWake?.notify({
        userId: input.userId,
        kind: "background_model",
      });
    } catch {
      // Durable background queue state is authoritative.
    }
    return job;
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

  findOpenTopicResurface(input: {
    userId: string;
    subjectId: string;
  }): Promise<NativeLiveBackgroundModelJob | null> {
    return this.repository.findOpenTopicResurface(input);
  }

  findOpenDistillation(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
  }): Promise<NativeLiveBackgroundModelJob | null> {
    return this.repository.findOpenDistillation(input);
  }

  findNextUnconsumedTerminalForWorkflow(input: {
    userId: string;
    workflowKind: NativeLiveBackgroundModelWorkflowKind;
  }): Promise<NativeLiveBackgroundModelJob | null> {
    return this.repository.findNextUnconsumedTerminalForWorkflow(input);
  }

  findNextUnconsumedTerminal(input: {
    userId: string;
  }): Promise<NativeLiveBackgroundModelJob | null> {
    return this.repository.findNextUnconsumedTerminal(input);
  }

  markConsumed(input: {
    userId: string;
    taskId: string;
  }): Promise<void> {
    return this.repository.markConsumed(input);
  }
}

async function assertWorkflowSourceActive(
  transaction: Transaction,
  userId: string,
  subjectId: string,
  workflow: NativeLiveBackgroundModelWorkflow | undefined,
): Promise<void> {
  if (!workflow) return;

  if (workflow.kind === "distillation") {
    const conversationId = workflow.payload.conversation_id;
    if (typeof conversationId !== "string") {
      throw new Error("Distillation workflow source conversation is invalid.");
    }
    const active = await transaction.execute<{ id: string }>(sql`
      SELECT id
      FROM conversations
      WHERE id = ${conversationId}::uuid
        AND user_id = ${userId}::uuid
        AND origin = 'native_live'
        AND lifecycle_status = 'active'
      FOR SHARE
    `);
    if (active.length !== 1) {
      throw new Error("BackgroundWorkflowSourceInactive");
    }
    return;
  }

  if (workflow.kind === "proactivity_wake") {
    const [snapshot] = await transaction
      .select({
        id: runtimeProactivityWakes.id,
        contextSnapshot: runtimeProactivityWakes.contextSnapshot,
      })
      .from(runtimeProactivityWakes)
      .where(and(
        eq(runtimeProactivityWakes.id, workflow.runId),
        eq(runtimeProactivityWakes.userId, userId),
      ))
      .limit(1);
    if (!snapshot) {
      throw new Error("BackgroundWorkflowSourceInactive");
    }

    const sourceConversationId =
      typeof snapshot.contextSnapshot.sourceConversationId === "string"
        ? snapshot.contextSnapshot.sourceConversationId.trim()
        : "";
    if (sourceConversationId) {
      const active = await transaction.execute<{ id: string }>(sql`
        SELECT id
        FROM conversations
        WHERE id = ${sourceConversationId}::uuid
          AND user_id = ${userId}::uuid
          AND origin = 'native_live'
          AND lifecycle_status = 'active'
        FOR SHARE
      `);
      if (active.length !== 1) {
        throw new Error("BackgroundWorkflowSourceInactive");
      }
    }

    const locked = await transaction
      .select({ id: runtimeProactivityWakes.id })
      .from(runtimeProactivityWakes)
      .where(and(
        eq(runtimeProactivityWakes.id, workflow.runId),
        eq(runtimeProactivityWakes.userId, userId),
      ))
      .for("share")
      .limit(1);
    if (locked.length !== 1) {
      throw new Error("BackgroundWorkflowSourceInactive");
    }
    return;
  }

  const stateIds = collectWorkflowStateIds(workflow.payload);
  if (stateIds.length === 0) {
    throw new Error("Topic resurface workflow source state is missing.");
  }
  const rows = await transaction
    .select({ id: runtimeSubjectStates.id })
    .from(runtimeSubjectStates)
    .where(and(
      eq(runtimeSubjectStates.userId, userId),
      eq(runtimeSubjectStates.subjectId, subjectId),
      inArray(runtimeSubjectStates.id, stateIds),
      eq(runtimeSubjectStates.validityStatus, "valid"),
    ))
    .for("share");
  if (rows.length !== stateIds.length) {
    throw new Error("BackgroundWorkflowSourceInactive");
  }
}

function collectWorkflowStateIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (
      !candidate
      || typeof candidate !== "object"
      || Array.isArray(candidate)
    ) {
      return;
    }
    for (const [key, child] of Object.entries(
      candidate as Record<string, unknown>,
    )) {
      if (
        key === "stateId"
        && typeof child === "string"
        && child.trim()
      ) {
        ids.add(child);
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return [...ids];
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
        AND consumed_at IS NOT NULL
        AND consumed_at < ${cutoff.toISOString()}::timestamptz
      ORDER BY consumed_at ASC, id ASC
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
