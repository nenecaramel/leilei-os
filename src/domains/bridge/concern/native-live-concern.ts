import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import type {
  NativeLiveConcernReleaseReason,
  NativeLiveConcernWakeSlot,
  NativeLiveWakeReceiptSlot,
} from "../../../database/schema.js";
import { formatCurrentTime } from "../../time/current-time.js";

// Program-owned bounds. The model edits a concern's content and timing; it can
// never raise these, reset the execution record or bypass the wake switch.
export const CONCERN_LIMITS = {
  maxActivePerUser: 12,
  maxTextLength: 300,
  // As soon as the 2–5 minute reply wake, which can then carry it.
  minConsiderInMinutes: 2,
  maxHorizonMs: 7 * 24 * 60 * 60_000,
  maxWakesPerConcern: 3,
  maxConcernsPerWake: 5,
  cooldownMs: 30 * 60_000,
  postTurnGapMs: 2 * 60_000,
  duplicateWindowMs: 10 * 60_000,
  endedRetentionMs: 7 * 24 * 60 * 60_000,
} as const;

export const CONCERN_WAKE_SLOTS: readonly NativeLiveConcernWakeSlot[] = [
  "concern_1",
  "concern_2",
  "concern_3",
];

export function isConcernWakeSlot(
  slot: NativeLiveWakeReceiptSlot,
): slot is NativeLiveConcernWakeSlot {
  return (CONCERN_WAKE_SLOTS as readonly string[]).includes(slot);
}

export type PendingConcern = {
  id: string;
  content: string;
  reason: string | null;
  progress: string | null;
  considerAt: Date;
  expiresAt: Date;
  revision: number;
  wakeCount: number;
};

export type ConcernWakeReceipt = {
  slot: NativeLiveWakeReceiptSlot;
  consumedAt: Date;
};

export type FixedWakeWindow = {
  postTurnDueAt: string;
  longIdleDueAt: string;
  postTurnConsumed: boolean;
  longIdleConsumed: boolean;
};

/**
 * When the next concern-only wake may fire for one silence epoch, or null.
 * A concern that an imminent fixed wake will carry anyway does not get its
 * own wake, and every wake in the epoch opens a shared cooldown.
 */
export function concernWakeDueAt(input: {
  pending: readonly Pick<PendingConcern, "considerAt" | "expiresAt">[];
  receipts: readonly ConcernWakeReceipt[];
  fixed: FixedWakeWindow;
  assistantCompletedAt: Date;
}): Date | null {
  if (nextConcernWakeSlot(input.receipts) === null) return null;
  let gate = input.assistantCompletedAt.getTime() + CONCERN_LIMITS.postTurnGapMs;
  for (const receipt of input.receipts) {
    gate = Math.max(gate, receipt.consumedAt.getTime() + CONCERN_LIMITS.cooldownMs);
  }

  let due: number | null = null;
  for (const concern of input.pending) {
    const effective = Math.max(concern.considerAt.getTime(), gate);
    if (effective >= concern.expiresAt.getTime()) continue;
    if (due === null || effective < due) due = effective;
  }
  if (due === null) return null;

  for (const fixedDue of pendingFixedDeadlines(input.fixed)) {
    if (fixedDue >= due && fixedDue <= due + CONCERN_LIMITS.cooldownMs) {
      return null;
    }
  }
  return new Date(due);
}

export function nextConcernWakeSlot(
  receipts: readonly ConcernWakeReceipt[],
): NativeLiveConcernWakeSlot | null {
  const consumed = new Set(receipts.map((receipt) => receipt.slot));
  return CONCERN_WAKE_SLOTS.find((slot) => !consumed.has(slot)) ?? null;
}

function pendingFixedDeadlines(fixed: FixedWakeWindow): number[] {
  if (fixed.longIdleConsumed) return [];
  const longDue = Date.parse(fixed.longIdleDueAt);
  const postDue = Date.parse(fixed.postTurnDueAt);
  const deadlines: number[] = [];
  if (Number.isFinite(longDue)) deadlines.push(longDue);
  // A short slot later than the long slot never fires; see silence wake.
  if (!fixed.postTurnConsumed && Number.isFinite(postDue)
    && (!Number.isFinite(longDue) || postDue < longDue)) {
    deadlines.push(postDue);
  }
  return deadlines;
}

export function formatConcernWakeBlock(
  concerns: readonly PendingConcern[],
): string {
  const lines = concerns.map((concern) => {
    const header = `[concern · id=${concern.id} · expected_revision=${concern.revision}`
      + ` · woken ${concern.wakeCount + 1}/${CONCERN_LIMITS.maxWakesPerConcern}`
      + ` · keep until ${shortProductTime(concern.expiresAt)}]`;
    return [
      header,
      concern.content,
      ...(concern.reason ? [`reason: ${concern.reason}`] : []),
      ...(concern.progress ? [`progress: ${concern.progress}`] : []),
    ].join("\n");
  });
  return [
    ...lines,
    "These are concerns you chose to keep. Bring one up if it fits now,"
      + " postpone or edit it with update_concern, release it once settled,"
      + " or output <quiet />.",
  ].join("\n");
}

function shortProductTime(value: Date): string {
  const { date, time } = formatCurrentTime(value);
  return `${date.slice(5)} ${time.slice(0, 5)}`;
}

type ConcernDatabase = ReturnType<typeof createDatabase>["db"];
// Raw SQL only, so a database handle or any of its transactions qualifies.
export type ConcernExecutor = Pick<ConcernDatabase, "execute">;

/**
 * Active, unexpired concerns of one conversation whose origin turn is still on
 * the current head path (or is the in-flight latest user turn). pendingOnly
 * additionally requires an unspent wake for the current consider time.
 */
export async function selectConversationConcerns(
  executor: ConcernExecutor,
  input: {
    userId: string;
    conversationId: string;
    now: Date;
    pendingOnly: boolean;
    dueOnly?: boolean;
  },
): Promise<PendingConcern[]> {
  return (await selectConcernRows(executor, input)).map(pendingConcernFromRow);
}

async function selectConcernRows(
  executor: ConcernExecutor,
  input: {
    userId: string;
    conversationId: string;
    now: Date;
    pendingOnly: boolean;
    dueOnly?: boolean;
  },
): Promise<ConcernRecordRow[]> {
  const now = input.now.toISOString();
  return executor.execute<ConcernRecordRow>(sql`
    WITH RECURSIVE current_path AS (
      SELECT message.id, message.parent_message_id
      FROM conversations AS conversation
      JOIN conversation_messages AS message
        ON message.id = conversation.current_head_message_id
       AND message.user_id = conversation.user_id
       AND message.conversation_id = conversation.id
      WHERE conversation.id = ${input.conversationId}::uuid
        AND conversation.user_id = ${input.userId}::uuid

      UNION ALL

      SELECT parent.id, parent.parent_message_id
      FROM current_path AS path
      JOIN conversation_messages AS parent
        ON parent.id = path.parent_message_id
       AND parent.user_id = ${input.userId}::uuid
       AND parent.conversation_id = ${input.conversationId}::uuid
    ),
    -- A turn in flight leaves the head at its user message's parent.
    in_flight_user AS (
      SELECT message.id
      FROM conversation_messages AS message
      JOIN conversations AS conversation
        ON conversation.id = message.conversation_id
       AND conversation.user_id = message.user_id
      WHERE message.user_id = ${input.userId}::uuid
        AND message.conversation_id = ${input.conversationId}::uuid
        AND message.role = 'user'
        AND message.parent_message_id IS NOT DISTINCT FROM conversation.current_head_message_id
      ORDER BY message.created_at DESC, message.id DESC
      LIMIT 1
    )
    SELECT concern.*
    FROM native_live_concerns AS concern
    WHERE concern.user_id = ${input.userId}::uuid
      AND concern.conversation_id = ${input.conversationId}::uuid
      AND concern.status = 'active'
      AND concern.expires_at > ${now}::timestamptz
      AND (
        concern.origin_message_id IN (SELECT id FROM current_path)
        OR concern.origin_message_id IN (SELECT id FROM in_flight_user)
      )
      AND (${!input.pendingOnly}::boolean OR (
        concern.wake_count < ${CONCERN_LIMITS.maxWakesPerConcern}
        AND concern.woken_consider_at IS DISTINCT FROM concern.consider_at
      ))
      AND (${!input.dueOnly}::boolean OR concern.consider_at <= ${now}::timestamptz)
    ORDER BY concern.consider_at ASC, concern.id ASC
    LIMIT ${CONCERN_LIMITS.maxActivePerUser}
  `);
}

/** Records that a wake carried these concerns for their current consider time. */
export async function markConcernsWoken(
  executor: ConcernExecutor,
  input: { userId: string; concernIds: readonly string[]; now: Date },
): Promise<void> {
  if (input.concernIds.length === 0) return;
  await executor.execute(sql`
    UPDATE native_live_concerns
    SET wake_count = wake_count + 1,
        last_woken_at = ${input.now.toISOString()}::timestamptz,
        woken_consider_at = consider_at
    WHERE user_id = ${input.userId}::uuid
      AND status = 'active'
      AND id IN (${sql.join(input.concernIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
}

function pendingConcernFromRow(row: ConcernRecordRow): PendingConcern {
  return {
    id: row.id,
    content: row.content,
    reason: row.reason,
    progress: row.progress,
    considerAt: readTimestamp(row.consider_at),
    expiresAt: readTimestamp(row.expires_at),
    revision: Number(row.revision),
    wakeCount: Number(row.wake_count),
  };
}

function readTimestamp(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Concern timestamp is invalid.");
  }
  return date;
}

export type NativeLiveConcernView = {
  id: string;
  content: string;
  reason: string | null;
  progress: string | null;
  consider_at: string;
  expires_at: string;
  status: "active" | "released" | "expired";
  release_reason: NativeLiveConcernReleaseReason | null;
  revision: number;
  wake_count: number;
  max_wakes: number;
  last_woken_at: string | null;
};

export type NativeLiveConcernErrorCode =
  | "NO_ACTIVE_CONVERSATION"
  | "CONCERN_NOT_FOUND"
  | "CONCERN_LIMIT_REACHED"
  | "STALE_REVISION"
  | "CONCERN_NOT_ACTIVE"
  | "INVALID_CONCERN_WINDOW";

export class NativeLiveConcernError extends Error {
  constructor(
    readonly code: NativeLiveConcernErrorCode,
    message: string,
    readonly current: NativeLiveConcernView | null = null,
  ) {
    super(message);
    this.name = "NativeLiveConcernError";
  }
}

export type CreateConcernInput = {
  userId: string;
  content: string;
  reason?: string | null;
  considerInMinutes: number;
  expiresAt: string;
};

export type UpdateConcernInput = {
  userId: string;
  concernId: string;
  expectedRevision: number;
  content?: string;
  reason?: string | null;
  progress?: string | null;
  considerInMinutes?: number;
  expiresAt?: string;
};

export type ReleaseConcernInput = {
  userId: string;
  concernId: string;
  expectedRevision: number;
  outcome: NativeLiveConcernReleaseReason;
};

export class NativeLiveConcernService {
  constructor(
    private readonly db: ConcernDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: CreateConcernInput): Promise<{
    concern: NativeLiveConcernView;
    replayed: boolean;
  }> {
    const now = this.now();
    const content = requireText(input.content);
    const reason = optionalText(input.reason);
    const considerAt = considerAtFrom(now, input.considerInMinutes);
    const expiresAt = expiresAtFrom(now, input.expiresAt);
    assertWindow(considerAt, expiresAt);

    return this.db.transaction(async (transaction) => {
      // One writer per user keeps the active bound exact under parallel turns.
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${"native_live_concern:" + input.userId}, 0))
      `);
      const source = await readCurrentTurnSource(transaction, input.userId);
      if (!source) {
        throw new NativeLiveConcernError(
          "NO_ACTIVE_CONVERSATION",
          "No active Native Live conversation to attach this concern to.",
        );
      }

      await transaction.execute(sql`
        DELETE FROM native_live_concerns
        WHERE user_id = ${input.userId}::uuid
          AND (
            (status = 'released' AND released_at < ${new Date(now.getTime() - CONCERN_LIMITS.endedRetentionMs).toISOString()}::timestamptz)
            OR expires_at < ${new Date(now.getTime() - CONCERN_LIMITS.endedRetentionMs).toISOString()}::timestamptz
          )
      `);

      // A retried MCP call must not record the same concern twice.
      const [duplicate] = await transaction.execute<ConcernRecordRow>(sql`
        SELECT * FROM native_live_concerns
        WHERE user_id = ${input.userId}::uuid
          AND conversation_id = ${source.conversationId}::uuid
          AND status = 'active'
          AND content = ${content}
          AND created_at > ${new Date(now.getTime() - CONCERN_LIMITS.duplicateWindowMs).toISOString()}::timestamptz
        ORDER BY created_at DESC
        LIMIT 1
      `);
      if (duplicate) return { concern: viewFromRecord(duplicate, now), replayed: true };

      const [count] = await transaction.execute<{ active: number }>(sql`
        SELECT count(*)::int AS active FROM native_live_concerns
        WHERE user_id = ${input.userId}::uuid
          AND status = 'active'
          AND expires_at > ${now.toISOString()}::timestamptz
      `);
      if ((count?.active ?? 0) >= CONCERN_LIMITS.maxActivePerUser) {
        throw new NativeLiveConcernError(
          "CONCERN_LIMIT_REACHED",
          `At most ${CONCERN_LIMITS.maxActivePerUser} concerns may be active; release one first.`,
        );
      }

      const [created] = await transaction.execute<ConcernRecordRow>(sql`
        INSERT INTO native_live_concerns (
          user_id, conversation_id, origin_message_id, content, reason,
          consider_at, expires_at, created_at, updated_at
        ) VALUES (
          ${input.userId}::uuid, ${source.conversationId}::uuid,
          ${source.userMessageId}::uuid, ${content}, ${reason},
          ${considerAt.toISOString()}::timestamptz,
          ${expiresAt.toISOString()}::timestamptz,
          ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz
        )
        RETURNING *
      `);
      if (!created) throw new Error("Concern insert returned no row.");
      return { concern: viewFromRecord(created, now), replayed: false };
    });
  }

  async update(input: UpdateConcernInput): Promise<NativeLiveConcernView> {
    const now = this.now();
    const current = await this.readActive(input, now);
    const content = input.content === undefined
      ? current.content : requireText(input.content);
    const reason = input.reason === undefined
      ? current.reason : optionalText(input.reason);
    const progress = input.progress === undefined
      ? current.progress : optionalText(input.progress);
    const considerAt = input.considerInMinutes === undefined
      ? readTimestamp(current.consider_at)
      : considerAtFrom(now, input.considerInMinutes);
    const expiresAt = input.expiresAt === undefined
      ? readTimestamp(current.expires_at)
      : expiresAtFrom(now, input.expiresAt);
    assertWindow(considerAt, expiresAt);

    // The revision fence is the write itself: a stale caller can never
    // overwrite a newer edit, release or expiry.
    const [updated] = await this.db.execute<ConcernRecordRow>(sql`
      UPDATE native_live_concerns
      SET content = ${content}, reason = ${reason}, progress = ${progress},
          consider_at = ${considerAt.toISOString()}::timestamptz,
          expires_at = ${expiresAt.toISOString()}::timestamptz,
          revision = revision + 1,
          updated_at = ${now.toISOString()}::timestamptz
      WHERE id = ${input.concernId}::uuid
        AND user_id = ${input.userId}::uuid
        AND status = 'active'
        AND revision = ${input.expectedRevision}
        AND expires_at > ${now.toISOString()}::timestamptz
      RETURNING *
    `);
    if (!updated) throw await this.conflict(input, now);
    return viewFromRecord(updated, now);
  }

  async release(input: ReleaseConcernInput): Promise<NativeLiveConcernView> {
    const now = this.now();
    const [released] = await this.db.execute<ConcernRecordRow>(sql`
      UPDATE native_live_concerns
      SET status = 'released',
          release_reason = ${input.outcome},
          released_at = ${now.toISOString()}::timestamptz,
          revision = revision + 1,
          updated_at = ${now.toISOString()}::timestamptz
      WHERE id = ${input.concernId}::uuid
        AND user_id = ${input.userId}::uuid
        AND status = 'active'
        AND revision = ${input.expectedRevision}
      RETURNING *
    `);
    if (!released) throw await this.conflict(input, now);
    return viewFromRecord(released, now);
  }

  async list(input: { userId: string }): Promise<{
    conversationId: string | null;
    concerns: NativeLiveConcernView[];
  }> {
    const now = this.now();
    const source = await readCurrentTurnSource(this.db, input.userId);
    if (!source) return { conversationId: null, concerns: [] };
    const rows = await selectConcernRows(this.db, {
      userId: input.userId,
      conversationId: source.conversationId,
      now,
      pendingOnly: false,
    });
    return {
      conversationId: source.conversationId,
      concerns: rows.map((row) => viewFromRecord(row, now)),
    };
  }

  private async readActive(
    input: { userId: string; concernId: string; expectedRevision: number },
    now: Date,
  ): Promise<ConcernRecordRow> {
    const row = await readRecord(this.db, input.userId, input.concernId);
    if (!row) {
      throw new NativeLiveConcernError("CONCERN_NOT_FOUND", "Concern was not found.");
    }
    const view = viewFromRecord(row, now);
    if (view.status !== "active") {
      throw new NativeLiveConcernError(
        "CONCERN_NOT_ACTIVE",
        `Concern is already ${view.status}.`,
        view,
      );
    }
    if (row.revision !== input.expectedRevision) {
      throw new NativeLiveConcernError(
        "STALE_REVISION",
        `Concern revision is ${row.revision}; re-read it before editing.`,
        view,
      );
    }
    return row;
  }

  private async conflict(
    input: { userId: string; concernId: string; expectedRevision: number },
    now: Date,
  ): Promise<NativeLiveConcernError> {
    try {
      await this.readActive(input, now);
    } catch (error) {
      if (error instanceof NativeLiveConcernError) return error;
      throw error;
    }
    // Active at the expected revision on re-read means a concurrent writer
    // raced this one; report it as stale rather than retrying blindly.
    const row = await readRecord(this.db, input.userId, input.concernId);
    return new NativeLiveConcernError(
      "STALE_REVISION",
      "Concern changed concurrently; re-read it before editing.",
      row ? viewFromRecord(row, now) : null,
    );
  }
}

type ConcernRecordRow = {
  id: string;
  content: string;
  reason: string | null;
  progress: string | null;
  consider_at: Date | string;
  expires_at: Date | string;
  status: "active" | "released";
  release_reason: NativeLiveConcernReleaseReason | null;
  revision: number;
  wake_count: number;
  last_woken_at: Date | string | null;
};

async function readRecord(
  executor: ConcernExecutor,
  userId: string,
  concernId: string,
): Promise<ConcernRecordRow | null> {
  const [row] = await executor.execute<ConcernRecordRow>(sql`
    SELECT * FROM native_live_concerns
    WHERE id = ${concernId}::uuid AND user_id = ${userId}::uuid
    LIMIT 1
  `);
  return row ?? null;
}

/** The conversation and user message of the turn Claude is answering now. */
async function readCurrentTurnSource(
  executor: ConcernExecutor,
  userId: string,
): Promise<{ conversationId: string; userMessageId: string } | null> {
  const [row] = await executor.execute<{
    conversation_id: string;
    user_message_id: string;
  }>(sql`
    SELECT message.conversation_id, message.id AS user_message_id
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
  `);
  return row
    ? { conversationId: row.conversation_id, userMessageId: row.user_message_id }
    : null;
}

function viewFromRecord(row: ConcernRecordRow, now: Date): NativeLiveConcernView {
  const expiresAt = readTimestamp(row.expires_at);
  const lastWokenAt = row.last_woken_at === null ? null : readTimestamp(row.last_woken_at);
  return {
    id: row.id,
    content: row.content,
    reason: row.reason,
    progress: row.progress,
    consider_at: formatCurrentTime(readTimestamp(row.consider_at)).datetime,
    expires_at: formatCurrentTime(expiresAt).datetime,
    status: row.status === "active" && expiresAt.getTime() <= now.getTime()
      ? "expired"
      : row.status,
    release_reason: row.release_reason,
    revision: Number(row.revision),
    wake_count: Number(row.wake_count),
    max_wakes: CONCERN_LIMITS.maxWakesPerConcern,
    last_woken_at: lastWokenAt ? formatCurrentTime(lastWokenAt).datetime : null,
  };
}

function requireText(value: string): string {
  const text = value.trim();
  if (!text) {
    throw new NativeLiveConcernError("INVALID_CONCERN_WINDOW", "Concern content must not be blank.");
  }
  return truncate(text);
}

function optionalText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? truncate(text) : null;
}

function truncate(text: string): string {
  const characters = Array.from(text);
  return characters.length <= CONCERN_LIMITS.maxTextLength
    ? text
    : characters.slice(0, CONCERN_LIMITS.maxTextLength).join("");
}

function considerAtFrom(now: Date, minutes: number): Date {
  if (!Number.isInteger(minutes) || minutes < CONCERN_LIMITS.minConsiderInMinutes) {
    throw new NativeLiveConcernError(
      "INVALID_CONCERN_WINDOW",
      `consider_in_minutes must be an integer of at least ${CONCERN_LIMITS.minConsiderInMinutes}.`,
    );
  }
  return new Date(now.getTime() + minutes * 60_000);
}

function expiresAtFrom(now: Date, value: string): Date {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/(?:Z|[+-]\d{2}:\d{2})$/iu.test(value.trim())) {
    throw new NativeLiveConcernError(
      "INVALID_CONCERN_WINDOW",
      "expires_at must be an ISO 8601 datetime with an explicit offset.",
    );
  }
  if (parsed <= now.getTime()) {
    throw new NativeLiveConcernError("INVALID_CONCERN_WINDOW", "expires_at must be in the future.");
  }
  if (parsed > now.getTime() + CONCERN_LIMITS.maxHorizonMs) {
    throw new NativeLiveConcernError(
      "INVALID_CONCERN_WINDOW",
      "Concerns are short-term: expires_at must be within 7 days. Use Memory for lasting facts.",
    );
  }
  return new Date(parsed);
}

function assertWindow(considerAt: Date, expiresAt: Date): void {
  if (considerAt.getTime() >= expiresAt.getTime()) {
    throw new NativeLiveConcernError(
      "INVALID_CONCERN_WINDOW",
      "The next consider time must be before expires_at.",
    );
  }
}
