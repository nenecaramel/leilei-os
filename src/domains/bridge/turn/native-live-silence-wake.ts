import { nativeSessionOwnershipSql, nativeSessionExecutableSql, nativeSessionTurnSql, readNativeSessionOwner } from "./turn-repository/session-owner.js";
import { nativeResumeCheckpointSql } from "./native-live-resume-checkpoint.js";
import { createHash } from "node:crypto";
import { parseNativeLiveExecutionSelection, type NativeLiveExecutionSelection } from "./native-live-execution-selection.js";
import { and, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  nativeLiveSilenceWakeReceipts,
  nativeLiveTurnPreparations,
  type NativeLiveRecurringIdleSlot,
  type NativeLiveWakeReceiptSlot,
} from "../../../database/schema.js";
import {
  concernWakeDueAt,
  formatConcernWakeBlock,
  isConcernWakeSlot,
  markConcernsWoken,
  nextConcernWakeSlot,
  selectConversationConcerns,
  CONCERN_LIMITS,
  CONCERN_WAKE_SLOTS,
  type ConcernWakeReceipt,
} from "../concern/native-live-concern.js";
import type {
  DrizzleNativeLiveWorkWakePublisher,
} from "../relay/native-live-work-wake.js";

export type NativeLiveSilenceWakeSlot =
  | "post_turn_idle"
  | "mid_idle"
  | "long_idle";

// What the Mac may ask to fire; the server maps "concern" to a bounded slot.
export type NativeLiveWakeFireSlot =
  | NativeLiveSilenceWakeSlot
  | "concern";

// On the wire the long slot carries the next recurring wake, so a Mac that
// already knows the long slot fires every recurring wake without an update;
// longIdleConsumed means the recurring safety limit was reached.
export type NativeLiveSilenceWakeSchedule = {
  epochId: string;
  conversationId: string;
  postTurnDueAt: string;
  longIdleDueAt: string;
  postTurnConsumed: boolean;
  longIdleConsumed: boolean;
  // Retired; servers since the recurring wake send null.
  midIdleDueAt?: string | null;
  midIdleConsumed?: boolean;
  // Absent from older servers; null when no concern wake is pending.
  concernDueAt?: string | null;
};

export type NativeLiveSilenceWakeIgnoredReason =
  | "source_changed"
  | "slot_not_due"
  | "foreground_active"
  | "already_consumed";

export type NativeLiveSilenceWakeFireResult =
  | {
      outcome: "queued";
      schedule: NativeLiveSilenceWakeSchedule | null;
    }
  | {
      outcome: "ignored";
      reason: NativeLiveSilenceWakeIgnoredReason;
      schedule: NativeLiveSilenceWakeSchedule | null;
    };

// Post-reply wake: 2–5 minutes after the reply (owner's choice, 10/22).
const POST_TURN_MIN_MS = 2 * 60_000;
const POST_TURN_SPAN_MS = 3 * 60_000;
// Recurring wake (owner's choice, 10/29): every 30–40 minutes after the later of
// Claude's last message and the last wake, so the prompt cache stays warm, until
// she replies. The owner turns Wake off at night; the limit is only a backstop.
const RECURRING_IDLE_MIN_MS = 30 * 60_000;
const RECURRING_IDLE_SPAN_MS = 10 * 60_000;
export const RECURRING_IDLE_LIMIT = 64;

// The post-reply window measures the owner's silence from the reply that ended
// the turn; time spent waiting for that reply is not silence.
export function silenceWakeDeadlines(input: {
  epochId: string;
  assistantCompletedAt: string;
}): {
  postTurnDueAt: string;
} {
  const base = Date.parse(input.assistantCompletedAt);
  if (!Number.isFinite(base)) {
    throw new Error("Silence wake source timestamps are invalid.");
  }
  return {
    postTurnDueAt: new Date(
      base
        + POST_TURN_MIN_MS
        + stableOffset(input.epochId, "post_turn_idle", POST_TURN_SPAN_MS),
    ).toISOString(),
  };
}

export function recurringIdleDueAt(input: {
  epochId: string;
  sequence: number;
  lastActivityAt: Date;
}): Date {
  return new Date(
    input.lastActivityAt.getTime()
      + RECURRING_IDLE_MIN_MS
      + stableOffset(input.epochId, `idle_${input.sequence}`, RECURRING_IDLE_SPAN_MS),
  );
}

// Any wake, quiet or visible, refreshed the cache as much as Claude's last message.
export function recurringIdleAnchor(input: {
  lastAssistantCompletedAt: Date;
  receipts: readonly ConcernWakeReceipt[];
}): Date {
  return new Date(Math.max(
    input.lastAssistantCompletedAt.getTime(),
    ...input.receipts.map((receipt) => receipt.consumedAt.getTime()),
  ));
}

export function nextRecurringIdleSlot(
  receipts: readonly ConcernWakeReceipt[],
): NativeLiveRecurringIdleSlot | null {
  const used = receipts.filter((receipt) => isRecurringIdleSlot(receipt.slot)).length;
  return used < RECURRING_IDLE_LIMIT ? `idle_${used + 1}` : null;
}

export function isRecurringIdleSlot(
  slot: string,
): slot is NativeLiveRecurringIdleSlot {
  const match = /^idle_([1-9][0-9]?)$/u.exec(slot);
  return match !== null && Number(match[1]) <= RECURRING_IDLE_LIMIT;
}

export function chooseDueSilenceWakeSlot(
  schedule: NativeLiveSilenceWakeSchedule | null,
  nowMs: number,
): NativeLiveSilenceWakeSlot | null {
  if (!schedule || schedule.longIdleConsumed) return null;
  const longDue = Date.parse(schedule.longIdleDueAt);
  const midDue = schedule.midIdleDueAt ? Date.parse(schedule.midIdleDueAt) : Number.NaN;
  const postDue = Date.parse(schedule.postTurnDueAt);

  // A resumed Mac never catches up several opportunities. The latest due slot
  // owns the silence epoch and every shorter missed opportunity is stale.
  if (Number.isFinite(longDue) && nowMs >= longDue) {
    return "long_idle";
  }
  if (Number.isFinite(midDue) && nowMs >= midDue) {
    return schedule.midIdleConsumed ? null : "mid_idle";
  }
  if (
    !schedule.postTurnConsumed
    && Number.isFinite(postDue)
    && nowMs >= postDue
  ) {
    return "post_turn_idle";
  }
  return null;
}

// Fixed slots keep priority; a due fixed wake carries due concerns itself.
export function chooseDueWakeFireSlot(
  schedule: NativeLiveSilenceWakeSchedule | null,
  nowMs: number,
): NativeLiveWakeFireSlot | null {
  const fixed = chooseDueSilenceWakeSlot(schedule, nowMs);
  if (fixed) return fixed;
  const concernDue = schedule?.concernDueAt
    ? Date.parse(schedule.concernDueAt)
    : Number.NaN;
  return Number.isFinite(concernDue) && nowMs >= concernDue
    ? "concern"
    : null;
}

export function nextSilenceWakeDeadline(
  schedule: NativeLiveSilenceWakeSchedule | null,
  nowMs: number,
): number | null {
  if (!schedule) return null;
  if (chooseDueWakeFireSlot(schedule, nowMs)) return nowMs;

  const candidates: number[] = [];
  if (!schedule.longIdleConsumed) {
    const longDue = Date.parse(schedule.longIdleDueAt);
    if (Number.isFinite(longDue)) candidates.push(longDue);
    if (!schedule.midIdleConsumed && schedule.midIdleDueAt) {
      const midDue = Date.parse(schedule.midIdleDueAt);
      if (Number.isFinite(midDue)) candidates.push(midDue);
    }
    if (!schedule.postTurnConsumed && !schedule.midIdleConsumed) {
      const postDue = Date.parse(schedule.postTurnDueAt);
      if (Number.isFinite(postDue)) candidates.push(postDue);
    }
  }
  const concernDue = schedule.concernDueAt
    ? Date.parse(schedule.concernDueAt)
    : Number.NaN;
  if (Number.isFinite(concernDue)) candidates.push(concernDue);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

export function formatSilenceWakeMarker(input: {
  now: Date;
  assistantCompletedAt: Date;
}): string {
  const elapsedMs = Math.max(
    0,
    input.now.getTime() - input.assistantCompletedAt.getTime(),
  );
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const elapsed =
    totalMinutes >= 60
      ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
      : `${totalMinutes}m`;

  // The timestamp is supplied by the shared hook; avoid repeating it in Wake.
  return `[wake · +${elapsed} · no reply]`;
}

export function silenceWakeDeterministicUuid(key: string): string {
  const hex = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 32);
  const chars = hex.split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20, 32),
  ].join("-");
}

function stableOffset(
  epochId: string,
  slot: NativeLiveSilenceWakeSlot | NativeLiveRecurringIdleSlot,
  spanMs: number,
): number {
  const digest = createHash("sha256")
    .update(`${epochId}:${slot}`, "utf8")
    .digest();
  return digest.readUInt32BE(0) % (spanMs + 1);
}

type SilenceWakeDatabase = ReturnType<typeof createDatabase>["db"];
type SilenceWakeTransaction =
  Parameters<SilenceWakeDatabase["transaction"]>[0] extends (
    tx: infer T,
  ) => unknown
    ? T
    : never;
type SilenceWakeExecutor = SilenceWakeDatabase | SilenceWakeTransaction;

type SilenceWakeSource = {
  conversationId: string;
  epochId: string;
  assistantCompletedAt: Date;
  lastAssistantCompletedAt: Date;
  currentHeadMessageId: string;
  providerSessionId: string;
  effectiveWorkingDirectory: string | null;
  providerCheckpointId: string | null;
  presentationOwnerId: string | null;
  writerGeneration: string | null;
  nativeSourceRevision: string | null;
  nativeSourceOwner: string | null;
  executionSelection: NativeLiveExecutionSelection | null;
};

export class NativeLiveSilenceWakeService {
  constructor(
    private readonly db: SilenceWakeDatabase,
    private readonly now: () => Date = () => new Date(),
    private readonly wakePublisher:
      Pick<DrizzleNativeLiveWorkWakePublisher, "notify"> | null = null,
  ) {}

  async readSchedule(input: {
    userId: string;
  }): Promise<NativeLiveSilenceWakeSchedule | null> {
    const source = await this.readSource(this.db, input.userId);
    return source
      ? this.scheduleForSource(this.db, input.userId, source)
      : null;
  }

  async fire(input: {
    userId: string;
    epochId: string;
    slot: NativeLiveWakeFireSlot;
  }): Promise<NativeLiveSilenceWakeFireResult> {
    const firedAt = this.now();
    const result = await this.db.transaction(
      async (transaction) => {
        const source = await this.readSource(
          transaction as SilenceWakeTransaction,
          input.userId,
        );
        if (!source || source.epochId !== input.epochId) {
          return {
            outcome: "ignored" as const,
            reason: "source_changed" as const,
            schedule: source
              ? await this.scheduleForSource(
                  transaction as SilenceWakeTransaction,
                  input.userId,
                  source,
                )
              : null,
          };
        }

        // Begin-release and Wake creation serialize on the same conversation.
        // Otherwise a newly queued Wake can make complete/attach permanently BUSY
        // after the daemon was drained. Use the existing ignored vocabulary so
        // older Mac clients need no protocol/parser change.
        await transaction.execute(sql`SELECT id FROM conversations
          WHERE id=${source.conversationId}::uuid AND user_id=${input.userId}::uuid FOR UPDATE`);
        if (await readNativeSessionOwner(transaction,{userId:input.userId,conversationId:source.conversationId}) === "releasing") {
          return {outcome:"ignored" as const,reason:"source_changed" as const,schedule:null};
        }

        const schedule = await this.scheduleForSource(
          transaction as SilenceWakeTransaction,
          input.userId,
          source,
        );
        const dueSlot = chooseDueWakeFireSlot(
          schedule,
          firedAt.getTime(),
        );
        const receiptSlot: NativeLiveWakeReceiptSlot | null =
          input.slot === "concern"
            ? nextConcernWakeSlot(
                await this.readReceipts(
                  transaction as SilenceWakeTransaction,
                  input.userId,
                  source.epochId,
                ),
              )
            : input.slot === "long_idle"
              ? nextRecurringIdleSlot(
                  await this.readReceipts(
                    transaction as SilenceWakeTransaction,
                    input.userId,
                    source.epochId,
                  ),
                )
              : input.slot;
        if (dueSlot !== input.slot || !receiptSlot) {
          return {
            outcome: "ignored" as const,
            reason: "slot_not_due" as const,
            schedule,
          };
        }
        // Every wake, fixed or concern, carries the concerns now due so a
        // concern handled by a fixed wake never fires again on its own.
        const carried = handedOff(source)
          ? []
          : (await selectConversationConcerns(transaction, {
              userId: input.userId,
              conversationId: source.conversationId,
              now: firedAt,
              pendingOnly: true,
              dueOnly: true,
            })).slice(0, CONCERN_LIMITS.maxConcernsPerWake);
        if (input.slot === "concern" && carried.length === 0) {
          return {
            outcome: "ignored" as const,
            reason: "slot_not_due" as const,
            schedule,
          };
        }

        const [foreground] = await transaction
          .select({ id: nativeLiveTurnPreparations.id })
          .from(nativeLiveTurnPreparations)
          .where(
            and(
              eq(nativeLiveTurnPreparations.userId, input.userId),
              eq(nativeLiveTurnPreparations.status, "prepared"),
              ne(nativeLiveTurnPreparations.operation, "wake"),
              or(
                inArray(
                  nativeLiveTurnPreparations.dispatchStatus,
                  [
                    "pending",
                    "reserved",
                    "executing",
                    "delivery_unknown",
                  ],
                ),
                and(
                  eq(
                    nativeLiveTurnPreparations.dispatchStatus,
                    "staged",
                  ),
                  gte(
                    nativeLiveTurnPreparations.createdAt,
                    source.assistantCompletedAt,
                  ),
                ),
              ),
            ),
          )
          .limit(1);
        if (foreground) {
          return {
            outcome: "ignored" as const,
            reason: "foreground_active" as const,
            schedule: null,
          };
        }

        const preparationId = silenceWakePreparationId(
          input.epochId,
          receiptSlot,
        );
        const [receipt] = await transaction
          .insert(nativeLiveSilenceWakeReceipts)
          .values({
            userId: input.userId,
            epochId: input.epochId,
            slot: receiptSlot,
            consumedAt: firedAt,
          })
          .onConflictDoNothing()
          .returning({
            epochId: nativeLiveSilenceWakeReceipts.epochId,
          });

        if (!receipt) {
          const [existing] = await transaction
            .select({
              id: nativeLiveTurnPreparations.id,
              status: nativeLiveTurnPreparations.status,
            })
            .from(nativeLiveTurnPreparations)
            .where(
              and(
                eq(nativeLiveTurnPreparations.userId, input.userId),
                eq(nativeLiveTurnPreparations.id, preparationId),
              ),
            )
            .limit(1);
          if (existing?.status === "prepared") {
            return {
              outcome: "queued" as const,
              schedule: await this.consumedSchedule(transaction as SilenceWakeTransaction, input.userId, source, schedule, receiptSlot),
            };
          }
          return {
            outcome: "ignored" as const,
            reason: "already_consumed" as const,
            schedule: await this.consumedSchedule(transaction as SilenceWakeTransaction, input.userId, source, schedule, receiptSlot),
          };
        }

        const marker = formatSilenceWakeMarker({
          now: firedAt,
          assistantCompletedAt: source.assistantCompletedAt,
        });
        const prompt = carried.length > 0
          ? `${marker}\n${formatConcernWakeBlock(carried)}`
          : marker;
        const requestId = silenceWakeDeterministicUuid(
          `silence-wake:request:${input.userId}:${input.epochId}:${receiptSlot}`,
        );
        const requestHash = createHash("sha256")
          .update(
            JSON.stringify({
              version: 1,
              conversationId: source.conversationId,
              epochId: input.epochId,
              slot: receiptSlot,
              sourceHeadMessageId: source.currentHeadMessageId,
              marker: prompt,
            }),
            "utf8",
          )
          .digest("hex");

        await transaction.insert(nativeLiveTurnPreparations).values({
          id: preparationId,
          userId: input.userId,
          requestId,
          conversationId: source.conversationId,
          operation: "wake",
          requestHash,
          canonicalUserMessageId: null,
          replacementTargetUserMessageId: null,
          wakeContext: {
            version: 1,
            epoch_id: input.epochId,
            slot: receiptSlot,
            ...(carried.length > 0
              ? {
                  concerns: carried.map((concern) => ({
                    id: concern.id,
                    revision: concern.revision,
                  })),
                }
              : {}),
            source_user_message_id: input.epochId,
            source_head_message_id:
              source.currentHeadMessageId,
            runtime_generation: { presentation_owner_id: source.presentationOwnerId, source_revision: source.nativeSourceRevision, writer_generation: source.writerGeneration },
          },
          runtimeMode: "fork",
          parentProviderSessionId: source.providerSessionId,
          expectedWorkingDirectory: source.effectiveWorkingDirectory,
          parentProviderCheckpointId: source.providerCheckpointId,
          // After a daemon restart this Wake may reopen the native writer;
          // it opens with the owner's last choice so the next send continues it.
          executionSelection: source.executionSelection,
          attachments: [],
          prompt,
          mindPrepared: true,
          status: "prepared",
          dispatchStatus: "pending",
        });
        await markConcernsWoken(transaction, {
          userId: input.userId,
          concernIds: carried.map((concern) => concern.id),
          now: firedAt,
        });

        return {
          outcome: "queued" as const,
          schedule: await this.scheduleForSource(
            transaction as SilenceWakeTransaction,
            input.userId,
            source,
          ),
        };
      },
      { isolationLevel: "serializable" },
    );
    if (result.outcome === "queued" && this.wakePublisher) {
      await this.wakePublisher.notify({
        userId: input.userId,
        kind: "silence_wake",
      }).catch(() => undefined);
    }
    return result;
  }

  private async scheduleForSource(
    executor: SilenceWakeExecutor,
    userId: string,
    source: SilenceWakeSource,
  ): Promise<NativeLiveSilenceWakeSchedule> {
    const receipts = await this.readReceipts(
      executor,
      userId,
      source.epochId,
    );
    const consumed = new Set(receipts.map((row) => row.slot));
    const deadlines = silenceWakeDeadlines({
      epochId: source.epochId,
      assistantCompletedAt:
        source.assistantCompletedAt.toISOString(),
    });
    const nextIdle = nextRecurringIdleSlot(receipts);
    const fixed = {
      ...deadlines,
      postTurnConsumed: consumed.has("post_turn_idle"),
      longIdleDueAt: recurringIdleDueAt({
        epochId: source.epochId,
        sequence: nextIdle ? Number(nextIdle.slice("idle_".length)) : RECURRING_IDLE_LIMIT,
        lastActivityAt: recurringIdleAnchor({
          lastAssistantCompletedAt: source.lastAssistantCompletedAt,
          receipts,
        }),
      }).toISOString(),
      longIdleConsumed: nextIdle === null,
      midIdleDueAt: null,
      midIdleConsumed: false,
    };
    const pending = handedOff(source)
      ? []
      : await selectConversationConcerns(executor, {
          userId,
          conversationId: source.conversationId,
          now: this.now(),
          pendingOnly: true,
        });
    const concernDueAt = concernWakeDueAt({
      pending,
      receipts,
      fixed,
      assistantCompletedAt: source.assistantCompletedAt,
    });
    return {
      epochId: source.epochId,
      conversationId: source.conversationId,
      ...fixed,
      concernDueAt: concernDueAt?.toISOString() ?? null,
    };
  }

  // A recurring receipt moves the next due time, so read it back instead.
  private async consumedSchedule(
    executor: SilenceWakeExecutor,
    userId: string,
    source: SilenceWakeSource,
    schedule: NativeLiveSilenceWakeSchedule,
    slot: NativeLiveWakeReceiptSlot,
  ): Promise<NativeLiveSilenceWakeSchedule> {
    return isRecurringIdleSlot(slot)
      ? this.scheduleForSource(executor, userId, source)
      : markConsumed(schedule, slot);
  }

  private async readReceipts(
    executor: SilenceWakeExecutor,
    userId: string,
    epochId: string,
  ): Promise<ConcernWakeReceipt[]> {
    return executor
      .select({
        slot: nativeLiveSilenceWakeReceipts.slot,
        consumedAt: nativeLiveSilenceWakeReceipts.consumedAt,
      })
      .from(nativeLiveSilenceWakeReceipts)
      .where(
        and(
          eq(nativeLiveSilenceWakeReceipts.userId, userId),
          eq(nativeLiveSilenceWakeReceipts.epochId, epochId),
        ),
      );
  }

  private async readSource(
    executor: SilenceWakeExecutor,
    userId: string,
  ): Promise<SilenceWakeSource | null> {
    const rows = await executor.execute<{
      conversation_id: string;
      user_message_id: string;
      assistant_completed_at: Date | string;
      head_completed_at: Date | string;
      current_head_message_id: string;
      provider_session_id: string;
      effective_working_directory: string | null;
      provider_checkpoint_id: string | null;
      presentation_owner_id: string | null;
      writer_generation: string | null;
      source_revision: string | null;
      source_owner: string | null;
      execution_selection: unknown;
    }>(sql`
      WITH RECURSIVE latest_user AS (
        SELECT
          message.conversation_id,
          message.id AS user_message_id
        FROM conversation_messages AS message
        JOIN conversations AS conversation
          ON conversation.id = message.conversation_id
         AND conversation.user_id = message.user_id
        WHERE message.user_id = ${userId}::uuid
          AND message.role = 'user'
          AND conversation.origin = 'native_live'
          AND conversation.lifecycle_status = 'active'
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ),
      current_path AS (
        SELECT
          conversation.id AS conversation_id,
          conversation.current_head_message_id AS current_head_message_id,
          message.id,
          message.parent_message_id,
          message.role,
          message.status,
          message.created_at,
          message.completed_at
        FROM latest_user AS source
        JOIN conversations AS conversation
          ON conversation.id = source.conversation_id
         AND conversation.user_id = ${userId}::uuid
         AND conversation.origin = 'native_live'
         AND conversation.lifecycle_status = 'active'
        JOIN conversation_messages AS message
          ON message.id = conversation.current_head_message_id
         AND message.user_id = conversation.user_id
         AND message.conversation_id = conversation.id
        WHERE conversation.current_head_message_id IS NOT NULL

        UNION ALL

        SELECT
          path.conversation_id,
          path.current_head_message_id,
          parent.id,
          parent.parent_message_id,
          parent.role,
          parent.status,
          parent.created_at,
          parent.completed_at
        FROM current_path AS path
        JOIN conversation_messages AS parent
          ON parent.id = path.parent_message_id
         AND parent.user_id = ${userId}::uuid
         AND parent.conversation_id = path.conversation_id
      ),
      direct_reply AS (
        SELECT
          reply.completed_at AS assistant_completed_at
        FROM latest_user AS source
        JOIN current_path AS reply
          ON reply.conversation_id = source.conversation_id
         AND reply.parent_message_id = source.user_message_id
         AND reply.role = 'assistant'
         AND reply.status = 'completed'
         AND reply.completed_at IS NOT NULL
        ORDER BY reply.created_at ASC, reply.id ASC
        LIMIT 1
      )
      SELECT
        source.conversation_id,
        source.user_message_id,
        reply.assistant_completed_at,
        path.current_head_message_id,
        path.completed_at AS head_completed_at,
        checkpoint.provider_session_id,
        checkpoint.effective_working_directory,
        ${nativeResumeCheckpointSql("checkpoint", "tail_surface")} AS provider_checkpoint_id,
        ${nativeSessionTurnSql("tail_surface").prepareId} AS presentation_owner_id,
        (SELECT o.writer_generation::text FROM native_live_session_owners o
          WHERE o.conversation_id = tail_surface.id AND o.user_id = tail_surface.user_id) AS writer_generation,
        ${nativeSessionOwnershipSql("tail_surface").revision} AS source_revision,
        -- This internal value classifies executability; releasing uses today's
        -- existing non-LeileiOS refusal path, without a new wire error code.
        CASE WHEN ${nativeSessionExecutableSql("tail_surface")} THEN 'leileios' ELSE 'desktop' END AS source_owner,
        (SELECT p.execution_selection FROM native_live_turn_preparations p
          WHERE p.conversation_id = source.conversation_id AND p.user_id = ${userId}::uuid
            AND p.operation IN ('send', 'edit', 'retry')
          ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS execution_selection
      FROM latest_user AS source
      JOIN conversations tail_surface ON tail_surface.id = source.conversation_id AND tail_surface.user_id = ${userId}::uuid
      JOIN direct_reply AS reply ON TRUE
      JOIN current_path AS path
        ON path.id = path.current_head_message_id
       AND path.role = 'assistant'
       AND path.status = 'completed'
      JOIN conversation_provider_session_checkpoints AS checkpoint
        ON checkpoint.user_id = ${userId}::uuid
       AND checkpoint.conversation_id = source.conversation_id
       AND checkpoint.canonical_message_id =
         path.current_head_message_id
       AND checkpoint.provider = 'claude_code'
      LIMIT 1
    `);
    const row = rows[0];
    return row
      ? {
          conversationId: row.conversation_id,
          epochId: row.user_message_id,
          assistantCompletedAt: readDatabaseTimestamp(
            row.assistant_completed_at,
            "assistant_completed_at",
          ),
          // The head is Claude's latest completed message, a visible wake included.
          lastAssistantCompletedAt: readDatabaseTimestamp(
            row.head_completed_at,
            "head_completed_at",
          ),
          currentHeadMessageId: row.current_head_message_id,
          providerSessionId: row.provider_session_id,
          effectiveWorkingDirectory: row.effective_working_directory,
          providerCheckpointId: row.provider_checkpoint_id,
          presentationOwnerId: row.presentation_owner_id ?? null,
          writerGeneration: row.writer_generation ?? null,
          nativeSourceRevision: row.source_revision ?? null,
          nativeSourceOwner: row.source_owner ?? null,
          executionSelection: readExecutionSelection(row.execution_selection),
        }
      : null;
  }
}

// A stored selection a later release no longer supports opens with the default.
function readExecutionSelection(value: unknown): NativeLiveExecutionSelection | null {
  if (value == null) return null;
  try { return parseNativeLiveExecutionSelection(value); } catch { return null; }
}

function readDatabaseTimestamp(
  value: Date | string,
  field: string,
): Date {
  const date =
    value instanceof Date
      ? value
      : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(
      `Silence wake source ${field} is invalid.`,
    );
  }
  return date;
}

const RECEIPT_SLOT_CODES: Record<Exclude<NativeLiveWakeReceiptSlot, NativeLiveRecurringIdleSlot>, number> = {
  post_turn_idle: 0x01,
  long_idle: 0x02,
  concern_1: 0x03,
  concern_2: 0x04,
  concern_3: 0x05,
  mid_idle: 0x06,
};

// Recurring wakes take 0x41..0x80, clear of the fixed and concern codes.
function receiptSlotCode(slot: NativeLiveWakeReceiptSlot): number {
  return isRecurringIdleSlot(slot)
    ? 0x40 + Number(slot.slice("idle_".length))
    : RECEIPT_SLOT_CODES[slot];
}

export function silenceWakePreparationId(
  epochId: string,
  slot: NativeLiveWakeReceiptSlot,
): string {
  const compact = epochId.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/u.test(compact)) {
    throw new Error("Silence wake epoch id must be a UUID.");
  }
  const bytes = Buffer.from(compact, "hex");
  bytes[15] = (bytes[15] ?? 0) ^ receiptSlotCode(slot);
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function silenceWakeEpochFromPreparationId(
  preparationId: string,
  slot: NativeLiveWakeReceiptSlot,
): string {
  return silenceWakePreparationId(preparationId, slot);
}

export function silenceWakeReceiptCandidatesForPreparationId(
  preparationId: string,
): Array<{
  epochId: string;
  slot: NativeLiveWakeReceiptSlot;
}> {
  return ([
    "post_turn_idle",
    "mid_idle",
    "long_idle",
    ...CONCERN_WAKE_SLOTS,
    ...Array.from({ length: RECURRING_IDLE_LIMIT }, (_, index) => `idle_${index + 1}` as const),
  ] as const).map((slot) => ({
    epochId: silenceWakeEpochFromPreparationId(preparationId, slot),
    slot,
  }));
}

// A Native Live session handed to the official client is not ours to wake.
function handedOff(source: SilenceWakeSource): boolean {
  return (source.nativeSourceOwner ?? "leileios") !== "leileios";
}

function markConsumed(
  schedule: NativeLiveSilenceWakeSchedule,
  slot: NativeLiveWakeReceiptSlot,
): NativeLiveSilenceWakeSchedule {
  if (isConcernWakeSlot(slot)) return { ...schedule, concernDueAt: null };
  return {
    ...schedule,
    ...(slot === "post_turn_idle"
      ? { postTurnConsumed: true }
      : slot === "mid_idle"
        ? { midIdleConsumed: true }
        : { longIdleConsumed: true }),
  };
}
