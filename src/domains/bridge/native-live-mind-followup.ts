import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { nativeLiveMindFollowUps } from "../../database/schema.js";
import type { MindWriteIntent } from "../runtime/mind-intent-parser.js";
import {
  THOUGHT_REF_PATTERN,
  type MindSemanticAction,
} from "../runtime/mind-semantic-action.js";
import type {
  MindSemanticActionReceipt,
  NativeLiveMindSemanticActionExecutor,
} from "./native-live-mind-semantic-action.js";
import type {
  NativeLiveBackendMindRuntime,
} from "./native-live-backend-mind-runtime.js";
import type {
  NativeLiveBackendTurnPort,
  NativeLivePostFinalizeRunner,
} from "./native-live-backend-turn-coordinator.js";
import { nativeLiveMindFollowUpStateId } from "./native-live-mind-state-id.js";
export { nativeLiveMindFollowUpStateId } from "./native-live-mind-state-id.js";

type Database = ReturnType<typeof createDatabase>["db"];

export const NATIVE_LIVE_MIND_FOLLOW_UP_LEASE_MS = 60_000;
export const NATIVE_LIVE_MIND_FOLLOW_UP_RETRY_MS = 5_000;
export const NATIVE_LIVE_MIND_FOLLOW_UP_QUARANTINE_SCAN_LIMIT = 25;
export type NativeLiveMindFollowUpJob = {
  prepareId: string;
  userId: string;
  conversationId: string;
  assistantMessageId: string;
  operation: "send" | "retry" | "edit";
  intents: MindWriteIntent[];
  actions: MindSemanticAction[];
};

export interface NativeLiveMindFollowUpPort {
  claimByPreparation(input: {
    userId: string;
    prepareId: string;
    workerId: string;
  }): Promise<NativeLiveMindFollowUpJob | null>;

  claimNext(input: {
    workerId: string;
  }): Promise<NativeLiveMindFollowUpJob | null>;

  complete(input: {
    prepareId: string;
    workerId: string;
    receipts: readonly MindSemanticActionReceipt[];
  }): Promise<boolean>;

  releaseFailure(input: {
    prepareId: string;
    workerId: string;
    errorName: string;
  }): Promise<boolean>;
}

type RawFollowUpRow = {
  prepare_id: string;
  user_id: string;
  conversation_id: string;
  assistant_message_id: string;
  operation: string;
  intents: unknown;
  actions: unknown;
};

export class DrizzleNativeLiveMindFollowUpRepository
implements NativeLiveMindFollowUpPort {
  constructor(private readonly db: Database) {}

  async claimByPreparation(input: {
    userId: string;
    prepareId: string;
    workerId: string;
  }): Promise<NativeLiveMindFollowUpJob | null> {
    const rows = await this.db.execute<RawFollowUpRow>(sql`
      UPDATE native_live_mind_followups
      SET status = 'processing',
          locked_by = ${input.workerId}::uuid,
          locked_until =
            now() + ${NATIVE_LIVE_MIND_FOLLOW_UP_LEASE_MS} * interval '1 millisecond',
          updated_at = now()
      WHERE prepare_id = ${input.prepareId}::uuid
        AND user_id = ${input.userId}::uuid
        AND EXISTS (
          SELECT 1
          FROM conversations AS conversation
          WHERE conversation.id =
            native_live_mind_followups.conversation_id
            AND conversation.user_id =
              native_live_mind_followups.user_id
            AND conversation.origin = 'native_live'
            AND conversation.lifecycle_status = 'active'
        )
        AND (
          (status = 'pending' AND available_at <= now())
          OR
          (status = 'processing' AND locked_until <= now())
        )
      RETURNING prepare_id, user_id, conversation_id, assistant_message_id,
        operation, intents, actions
    `);
    const row = rows[0];
    if (!row) return null;
    try {
      return parseJob(row);
    } catch (error) {
      const quarantined = await this.quarantineClaim({
        prepareId: row.prepare_id,
        workerId: input.workerId,
        errorName: "NativeLiveMindFollowUpPayloadInvalid",
      });
      if (!quarantined) throw error;
      return null;
    }
  }

  async claimNext(input: {
    workerId: string;
  }): Promise<NativeLiveMindFollowUpJob | null> {
    for (
      let scanned = 0;
      scanned < NATIVE_LIVE_MIND_FOLLOW_UP_QUARANTINE_SCAN_LIMIT;
      scanned += 1
    ) {
      const rows = await this.db.execute<RawFollowUpRow>(sql`
        WITH candidate AS (
          SELECT candidate_follow_up.prepare_id
          FROM native_live_mind_followups AS candidate_follow_up
          WHERE EXISTS (
            SELECT 1
            FROM conversations AS conversation
            WHERE conversation.id = candidate_follow_up.conversation_id
              AND conversation.user_id = candidate_follow_up.user_id
              AND conversation.origin = 'native_live'
              AND conversation.lifecycle_status = 'active'
          )
            AND (
              (candidate_follow_up.status = 'pending'
                AND candidate_follow_up.available_at <= now())
              OR
              (candidate_follow_up.status = 'processing'
                AND candidate_follow_up.locked_until <= now())
            )
          ORDER BY candidate_follow_up.available_at ASC,
            candidate_follow_up.created_at ASC,
            candidate_follow_up.prepare_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE native_live_mind_followups AS follow_up
        SET status = 'processing',
            locked_by = ${input.workerId}::uuid,
            locked_until =
              now() + ${NATIVE_LIVE_MIND_FOLLOW_UP_LEASE_MS} * interval '1 millisecond',
            updated_at = now()
        FROM candidate
        WHERE follow_up.prepare_id = candidate.prepare_id
        RETURNING follow_up.prepare_id, follow_up.user_id,
          follow_up.conversation_id, follow_up.assistant_message_id,
          follow_up.operation, follow_up.intents, follow_up.actions
      `);
      const row = rows[0];
      if (!row) return null;

      try {
        return parseJob(row);
      } catch (error) {
        const quarantined = await this.quarantineClaim({
          prepareId: row.prepare_id,
          workerId: input.workerId,
          errorName: "NativeLiveMindFollowUpPayloadInvalid",
        });
        if (!quarantined) throw error;
      }
    }
    throw new Error("NativeLiveMindFollowUpQuarantineScanLimit");
  }

  private async quarantineClaim(input: {
    prepareId: string;
    workerId: string;
    errorName: string;
  }): Promise<boolean> {
    const rows = await this.db
      .update(nativeLiveMindFollowUps)
      .set({
        status: "quarantined",
        retryCount: sql`${nativeLiveMindFollowUps.retryCount} + 1`,
        lockedBy: null,
        lockedUntil: null,
        lastErrorName: input.errorName.slice(0, 128),
        updatedAt: sql`now()`,
      })
      .where(sql`
        ${nativeLiveMindFollowUps.prepareId} = ${input.prepareId}::uuid
        AND ${nativeLiveMindFollowUps.status} = 'processing'
        AND ${nativeLiveMindFollowUps.lockedBy} = ${input.workerId}::uuid
      `)
      .returning({ prepareId: nativeLiveMindFollowUps.prepareId });
    return rows.length === 1;
  }

  async complete(input: {
    prepareId: string;
    workerId: string;
    receipts: readonly MindSemanticActionReceipt[];
  }): Promise<boolean> {
    const rows = await this.db
      .update(nativeLiveMindFollowUps)
      .set({
        status: "completed",
        lockedBy: null,
        lockedUntil: null,
        lastErrorName: null,
        receipts: input.receipts.map((receipt) => ({ ...receipt })),
        completedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(sql`
        ${nativeLiveMindFollowUps.prepareId} = ${input.prepareId}::uuid
        AND ${nativeLiveMindFollowUps.status} = 'processing'
        AND ${nativeLiveMindFollowUps.lockedBy} = ${input.workerId}::uuid
      `)
      .returning({ prepareId: nativeLiveMindFollowUps.prepareId });
    return rows.length === 1;
  }

  async releaseFailure(input: {
    prepareId: string;
    workerId: string;
    errorName: string;
  }): Promise<boolean> {
    const rows = await this.db
      .update(nativeLiveMindFollowUps)
      .set({
        status: "pending",
        retryCount: sql`${nativeLiveMindFollowUps.retryCount} + 1`,
        availableAt:
          sql`now() + ${NATIVE_LIVE_MIND_FOLLOW_UP_RETRY_MS} * interval '1 millisecond'`,
        lockedBy: null,
        lockedUntil: null,
        lastErrorName: input.errorName.slice(0, 128),
        updatedAt: sql`now()`,
      })
      .where(sql`
        ${nativeLiveMindFollowUps.prepareId} = ${input.prepareId}::uuid
        AND ${nativeLiveMindFollowUps.status} = 'processing'
        AND ${nativeLiveMindFollowUps.lockedBy} = ${input.workerId}::uuid
      `)
      .returning({ prepareId: nativeLiveMindFollowUps.prepareId });
    return rows.length === 1;
  }
}

export class NativeLiveMindFollowUpService
implements NativeLivePostFinalizeRunner {
  private readonly workerId: string;

  constructor(
    private readonly port: NativeLiveMindFollowUpPort,
    private readonly turns: Pick<NativeLiveBackendTurnPort, "getPreparation">,
    private readonly mind: NativeLiveBackendMindRuntime,
    workerId: string = randomUUID(),
    private readonly semanticActions:
      Pick<NativeLiveMindSemanticActionExecutor, "execute"> | null = null,
  ) {
    this.workerId = workerId;
  }

  async processPreparation(input: {
    userId: string;
    prepareId: string;
  }): Promise<"processed" | "idle"> {
    const job = await this.port.claimByPreparation({
      ...input,
      workerId: this.workerId,
    });
    if (!job) return "idle";
    await this.processClaimed(job);
    return "processed";
  }

  async processNext(): Promise<"processed" | "idle"> {
    const job = await this.port.claimNext({ workerId: this.workerId });
    if (!job) return "idle";
    await this.processClaimed(job);
    return "processed";
  }

  private async processClaimed(
    job: NativeLiveMindFollowUpJob,
  ): Promise<void> {
    try {
      const preparation = await this.turns.getPreparation({
        userId: job.userId,
        prepareId: job.prepareId,
      });
      if (!preparation) {
        throw new Error("NativeLiveMindFollowUpPreparationMissing");
      }
      if (
        preparation.conversationId !== job.conversationId
        || preparation.operation !== job.operation
      ) {
        throw new Error("NativeLiveMindFollowUpPreparationMismatch");
      }

      await this.mind.afterFinalize({
        userId: job.userId,
        preparation,
        assistantMessageId: job.assistantMessageId,
        intents: job.intents,
        stateIds: job.intents.map((_intent, index) =>
          nativeLiveMindFollowUpStateId(job.prepareId, index)
        ),
      });

      if (job.actions.length > 0 && !this.semanticActions) {
        throw new Error("NativeLiveMindSemanticActionExecutorMissing");
      }
      const receipts: MindSemanticActionReceipt[] = [];
      for (const [actionIndex, action] of job.actions.entries()) {
        receipts.push(
          await this.semanticActions!.execute({
            userId: job.userId,
            conversationId: job.conversationId,
            assistantMessageId: job.assistantMessageId,
            prepareId: job.prepareId,
            actionIndex,
            action,
          }),
        );
      }

      const completed = await this.port.complete({
        prepareId: job.prepareId,
        workerId: this.workerId,
        receipts,
      });
      if (!completed) {
        throw new Error("NativeLiveMindFollowUpCompletionLost");
      }
    } catch (error) {
      await this.port.releaseFailure({
        prepareId: job.prepareId,
        workerId: this.workerId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }).catch(() => false);
      throw error;
    }
  }
}

export type NativeLiveMindFollowUpRecoveryRunner = {
  stop(): void;
  runNow(): Promise<number>;
  drain(): Promise<void>;
};

export function createNativeLiveMindFollowUpRecoveryRunner(input: {
  service: Pick<NativeLiveMindFollowUpService, "processNext">;
  batchLimit?: number;
}): NativeLiveMindFollowUpRecoveryRunner {
  const batchLimit = input.batchLimit ?? 25;
  let inFlight: Promise<number> | null = null;
  let stopped = false;

  const runNow = (): Promise<number> => {
    if (stopped) return Promise.resolve(0);
    if (inFlight) return inFlight;

    const run = (async () => {
      let attempted = 0;
      let processed = 0;
      while (attempted < batchLimit) {
        attempted += 1;
        try {
          const outcome = await input.service.processNext();
          if (outcome === "idle") break;
          processed += 1;
        } catch {
          // Failed jobs are durably released with a retry delay. Startup
          // recovery is bounded and never installs a periodic cloud poller.
        }
      }
      return processed;
    })();

    const tracked = run.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };

  return {
    stop(): void {
      stopped = true;
    },
    runNow,
    async drain(): Promise<void> {
      const current = inFlight;
      if (current) await current.catch(() => undefined);
    },
  };
}

function parseJob(row: RawFollowUpRow): NativeLiveMindFollowUpJob {
  if (
    row.operation !== "send"
    && row.operation !== "retry"
    && row.operation !== "edit"
  ) {
    throw new Error("Native live Mind follow-up operation is invalid.");
  }

  return {
    prepareId: row.prepare_id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    assistantMessageId: row.assistant_message_id,
    operation: row.operation,
    intents: parseIntents(row.intents),
    actions: parseActions(row.actions),
  };
}

function parseIntents(value: unknown): MindWriteIntent[] {
  if (!Array.isArray(value)) {
    throw new Error("Native live Mind follow-up intents must be an array.");
  }

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Native live Mind follow-up intent is invalid.");
    }
    const record = candidate as Record<string, unknown>;
    // An open follow-up staged before the Mind rework may still carry a
    // Drive or Curiosity intent. Those kinds no longer exist and are not
    // given a new meaning: the intent is skipped and the rest of the job runs.
    if (record.kind === "drive" || record.kind === "curiosity") {
      return [];
    }
    if (
      (record.kind !== "feel"
        && record.kind !== "memory"
        && record.kind !== "thought")
      || typeof record.text !== "string"
      || !record.text.trim()
      || typeof record.sourceStart !== "number"
      || !Number.isInteger(record.sourceStart)
      || typeof record.sourceEnd !== "number"
      || !Number.isInteger(record.sourceEnd)
      || typeof record.raw !== "string"
    ) {
      throw new Error("Native live Mind follow-up intent is invalid.");
    }
    return [{
      kind: record.kind,
      text: record.text,
      sourceStart: record.sourceStart as number,
      sourceEnd: record.sourceEnd as number,
      raw: record.raw,
    }];
  });
}

function parseActions(value: unknown): MindSemanticAction[] {
  if (!Array.isArray(value)) {
    throw new Error("Native live Mind follow-up actions must be an array.");
  }

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Native live Mind follow-up action is invalid.");
    }
    const record = candidate as Record<string, unknown>;
    // Satisfy/resolve actions belonged to the retired Drive and Curiosity
    // kinds. Dropping them keeps the rest of an open follow-up intact.
    if (record.kind === "mind_satisfy" || record.kind === "mind_resolve") {
      return [];
    }
    if (
      record.kind !== "thought_drop"
      || typeof record.ref !== "string"
      || !THOUGHT_REF_PATTERN.test(record.ref)
      || typeof record.sourceStart !== "number"
      || !Number.isInteger(record.sourceStart)
      || typeof record.sourceEnd !== "number"
      || !Number.isInteger(record.sourceEnd)
      || typeof record.raw !== "string"
    ) {
      throw new Error("Native live Mind follow-up action is invalid.");
    }

    return [{
      kind: "thought_drop" as const,
      ref: record.ref,
      sourceStart: record.sourceStart,
      sourceEnd: record.sourceEnd,
      raw: record.raw,
    }];
  });
}
