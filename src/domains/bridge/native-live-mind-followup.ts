import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { nativeLiveMindFollowUps } from "../../database/schema.js";
import type { MindWriteIntent } from "../runtime/mind-intent-parser.js";
import type { MindSemanticAction } from "../runtime/mind-semantic-action.js";
import type {
  MindSemanticActionReceipt,
  NativeLiveMindSemanticActionExecutor,
} from "./native-live-mind-semantic-action.js";
import type {
  NativeLiveBackendMindRuntime,
} from "./native-live-backend-mind-runtime.js";
import type {
  NativeLiveDistillationTrigger,
} from "../runtime/distillation-trigger-contract.js";
import type {
  NativeLiveBackendTurnPort,
  NativeLivePostFinalizeRunner,
} from "./native-live-backend-turn-coordinator.js";

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
        errorName: error instanceof Error ? error.name : "UnknownError",
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
          SELECT prepare_id
          FROM native_live_mind_followups
          WHERE
            (status = 'pending' AND available_at <= now())
            OR
            (status = 'processing' AND locked_until <= now())
          ORDER BY available_at ASC, created_at ASC, prepare_id ASC
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
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        if (!quarantined) throw error;
      }
    }
    return null;
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
    private readonly backgroundOpportunity:
      Pick<NativeLiveDistillationTrigger, "schedule"> | null = null,
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

      try {
        this.backgroundOpportunity?.schedule({
          userId: job.userId,
          conversationId: job.conversationId,
        });
      } catch {
        // The durable Mind follow-up is already complete. A soft background
        // opportunity must never reopen it or turn the foreground result into
        // failure.
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

export function nativeLiveMindFollowUpStateId(
  prepareId: string,
  index: number,
): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("Mind follow-up state index must be a nonnegative integer.");
  }

  const digest = createHash("sha256")
    .update("leileios:mind-follow-up:v1:" + prepareId + ":" + index, "utf8")
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
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

  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Native live Mind follow-up intent is invalid.");
    }
    const record = candidate as Record<string, unknown>;
    if (
      (record.kind !== "feel"
        && record.kind !== "memory"
        && record.kind !== "dream"
        && record.kind !== "drive"
        && record.kind !== "thought"
        && record.kind !== "curiosity"
        && record.kind !== "topic")
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
    return {
      kind: record.kind,
      text: record.text,
      sourceStart: record.sourceStart as number,
      sourceEnd: record.sourceEnd as number,
      raw: record.raw,
    };
  });
}


function parseActions(value: unknown): MindSemanticAction[] {
  if (!Array.isArray(value)) {
    throw new Error("Native live Mind follow-up actions must be an array.");
  }

  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Native live Mind follow-up action is invalid.");
    }
    const record = candidate as Record<string, unknown>;
    if (
      (record.kind !== "mind_satisfy" && record.kind !== "mind_resolve")
      || typeof record.stateId !== "string"
      || !record.stateId.trim()
      || typeof record.sourceStart !== "number"
      || !Number.isInteger(record.sourceStart)
      || typeof record.sourceEnd !== "number"
      || !Number.isInteger(record.sourceEnd)
      || typeof record.raw !== "string"
    ) {
      throw new Error("Native live Mind follow-up action is invalid.");
    }
    if (
      record.kind === "mind_satisfy"
      && record.level !== "partial"
      && record.level !== "full"
    ) {
      throw new Error("Native live Mind satisfaction level is invalid.");
    }

    return record.kind === "mind_satisfy"
      ? {
          kind: "mind_satisfy" as const,
          stateId: record.stateId,
          level: record.level as "partial" | "full",
          sourceStart: record.sourceStart,
          sourceEnd: record.sourceEnd,
          raw: record.raw,
        }
      : {
          kind: "mind_resolve" as const,
          stateId: record.stateId,
          sourceStart: record.sourceStart,
          sourceEnd: record.sourceEnd,
          raw: record.raw,
        };
  });
}
