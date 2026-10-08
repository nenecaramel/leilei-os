import { SUBJECT_STATE_ISO_PATTERN, SUBJECT_STATE_TRIM_CHARS } from "../subject-state/subject-state-temporal.js";
import { memoryContentVersion, patchMemoryTemporal } from "./mind-memory-content.js";
import { requireActiveUserInTransaction } from "../../require-active-user-transaction.js";
import {
  and,
  desc,
  eq,
  inArray,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  conversationMessages,
  nativeLiveBackgroundModelJobs,
  runtimeEffects,
  runtimeMindSemanticGroupingRequests,
  runtimeProactivityWakes,
  runtimeSubjectStates,
} from "../../../database/schema.js";
import { lockAndReadMcpIdempotency, recordMcpIdempotency } from "../../mcp-write/mcp-write-idempotency.js";
import {
  structuredValueReferencesAnyId,
} from "../lifecycle/persistent-reference-scan.js";
import {
  lockAndReadProductCreateIdempotency,
  recordProductCreateIdempotency,
} from "../../product-write/product-create-idempotency.js";
import type {
  PersistentWriteEnvelope,
} from "../shared/persistent-write-envelope.js";
import {
  CURRENT_SUBJECT_STATE_KINDS,
  type CurrentSubjectStateKind,
  type SubjectStateWrite,
} from "../subject-state/subject-state-contract.js";
import type {
  MindMemoryCursor,
  MindMemoryUpdateInput,
  MindProductCursor,
  MindProductRepository,
  MindProductRow,
} from "./mind-product-service.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type Row = {
  id: string;
  kind: CurrentSubjectStateKind;
  text: string | null;
  payload: Record<string, unknown> | null;
  envelope: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export class DrizzleMindProductRepository
implements MindProductRepository {
  constructor(private readonly db: Database) {}

  async insertMcpIdempotent(input: {
    userId: string; subjectId: string; state: SubjectStateWrite;
    idempotencyKey: string; requestHash: string;
  }): Promise<{ memoryId: string; replayed: boolean }> {
    return this.db.transaction(async transaction => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const receipt = await lockAndReadMcpIdempotency(transaction, {
        userId: input.userId, toolName: "write_memory", idempotencyKey: input.idempotencyKey,
      });
      if (receipt) {
        if (receipt.requestHash !== input.requestHash || receipt.resourceType !== "mind_state") throw new Error("IDEMPOTENCY_CONFLICT");
        return { memoryId: receipt.resourceId, replayed: true };
      }
      const row = await insertMindState(transaction, input.state, input);
      if (!row) throw new Error("Mind insert failed.");
      await recordMcpIdempotency(transaction, {
        userId: input.userId, toolName: "write_memory", idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash, resourceType: "mind_state", resourceId: row.id,
      });
      return { memoryId: row.id, replayed: false };
    });
  }

  async search(input: {
    userId: string;
    subjectId: string;
    query: string;
    occurredFrom?: string;
    occurredBefore?: string;
    undated?: boolean;
    limit: number;
    cursor: MindMemoryCursor | null;
  }) {
    const conditions = memoryConditions(input);
    if (input.query) {
      const literal = input.query.replace(/[\\%_]/g, (value) => `\\${value}`);
      conditions.push(
        sql`regexp_replace(normalize(${runtimeSubjectStates.text}, NFC), ${"\\s+"}, ' ', 'g') ILIKE ${`%${literal}%`} ESCAPE ${"\\"}`,
      );
    }
    if (input.undated) conditions.push(sql`${memoryOccurredAtSql()} IS NULL`);
    if (input.occurredFrom || input.occurredBefore) {
      const occurredAt = memoryOccurredAtSql();
      if (input.occurredFrom)
        conditions.push(
          sql`${occurredAt} >= ${input.occurredFrom}::timestamptz`,
        );
      if (input.occurredBefore)
        conditions.push(
          sql`${occurredAt} < ${input.occurredBefore}::timestamptz`,
        );
    }
    if (input.cursor)
      conditions.push(
        sql`(${runtimeSubjectStates.createdAt}, ${runtimeSubjectStates.id}) < (${input.cursor.createdAt}::timestamptz, ${input.cursor.id}::uuid)`,
      );
    const rows = await this.db
      .select({
        ...rowSelection(),
        cursorCreatedAt: sql<string>`to_char(${runtimeSubjectStates.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(runtimeSubjectStates)
      .where(and(...conditions))
      .orderBy(
        desc(runtimeSubjectStates.createdAt),
        desc(runtimeSubjectStates.id),
      )
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      rows: page.map(toProductRow),
      nextCursor:
        rows.length > input.limit && last
          ? { createdAt: last.cursorCreatedAt, id: last.id }
          : null,
    };
  }

  async update(input: MindMemoryUpdateInput & { subjectId: string }) {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const [row] = await transaction
        .select(rowSelection())
        .from(runtimeSubjectStates)
        .where(
          and(
            ...memoryConditions(input),
            eq(runtimeSubjectStates.id, input.stateId),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) return { outcome: "not_found" as const };
      if (memoryContentVersion(row) !== input.expectedVersion)
        return { outcome: "conflict" as const };
      // Merge only editable fields from the locked, latest row. Stop also locks
      // this row, so neither operation can overwrite the other's payload.
      const [updated] = await transaction
        .update(runtimeSubjectStates)
        .set({
          ...(input.text === undefined ? {} : { text: input.text }),
          ...(input.occurredAt === undefined
            ? {}
            : { payload: patchMemoryTemporal(row.payload, input.occurredAt) }),
          updatedAt: new Date(),
        })
        .where(eq(runtimeSubjectStates.id, row.id))
        .returning(rowSelection());
      if (!updated) throw Error("Memory update failed.");
      return { outcome: "updated" as const, row: toProductRow(updated) };
    });
  }

  async list(input: {
    userId: string;
    subjectId: string;
    kind?: CurrentSubjectStateKind;
    limit: number;
    cursor?: MindProductCursor | null;
  }): Promise<{
    rows: MindProductRow[];
    nextCursor: MindProductCursor | null;
  }> {
    const conditions = [
      eq(runtimeSubjectStates.userId, input.userId),
      eq(runtimeSubjectStates.subjectId, input.subjectId),
      inArray(runtimeSubjectStates.kind, CURRENT_SUBJECT_STATE_KINDS),
      eq(runtimeSubjectStates.settlementStatus, "settled"),
      eq(runtimeSubjectStates.pathStatus, "current"),
      eq(runtimeSubjectStates.validityStatus, "valid"),
      productVisibilityCondition(),
    ];
    if (input.kind) {
      conditions.push(eq(runtimeSubjectStates.kind, input.kind));
    }
    if (input.cursor) {
      const updatedAt = new Date(input.cursor.updatedAt);
      const cursorCondition = or(
        lt(runtimeSubjectStates.updatedAt, updatedAt),
        and(
          eq(runtimeSubjectStates.updatedAt, updatedAt),
          lt(runtimeSubjectStates.id, input.cursor.id),
        ),
      );
      if (cursorCondition) conditions.push(cursorCondition);
    }

    const rows = await this.db
      .select(rowSelection())
      .from(runtimeSubjectStates)
      .where(and(...conditions))
      .orderBy(
        desc(runtimeSubjectStates.updatedAt),
        desc(runtimeSubjectStates.id),
      )
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;
    const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      rows: pageRows.map(toProductRow),
      nextCursor:
        hasMore && last
          ? {
              updatedAt: last.updatedAt.toISOString(),
              id: last.id,
            }
          : null,
    };
  }

  async get(input: {
    userId: string;
    subjectId: string;
    stateId: string;
  }): Promise<MindProductRow | null> {
    const [row] = await this.db
      .select(rowSelection())
      .from(runtimeSubjectStates)
      .where(and(
        eq(runtimeSubjectStates.id, input.stateId),
        eq(runtimeSubjectStates.userId, input.userId),
        eq(runtimeSubjectStates.subjectId, input.subjectId),
        inArray(runtimeSubjectStates.kind, CURRENT_SUBJECT_STATE_KINDS),
        eq(runtimeSubjectStates.settlementStatus, "settled"),
        eq(runtimeSubjectStates.pathStatus, "current"),
        eq(runtimeSubjectStates.validityStatus, "valid"),
        productVisibilityCondition(),
        ))
      .limit(1);
    return row ? toProductRow(row) : null;
  }

  async insertManualIdempotent(input: {
    userId: string;
    subjectId: string;
    state: SubjectStateWrite;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<
    | { outcome: "committed"; row: MindProductRow }
    | { outcome: "idempotency_conflict" }
  > {
    return this.db.transaction(
      async (transaction) => {
        const receipt = await lockAndReadProductCreateIdempotency(
          transaction,
          {
            userId: input.userId,
            operation: "mind_manual_create",
            idempotencyKey: input.idempotencyKey,
          },
        );
        if (receipt) {
          if (receipt.requestHash !== input.requestHash) {
            return { outcome: "idempotency_conflict" as const };
          }
          return {
            outcome: "committed" as const,
            row: receipt.response as unknown as MindProductRow,
          };
        }

        const state = input.state;
        const row = await insertMindState(transaction, state, input);

        if (!row) {
          throw new Error("Manual Mind insert failed.");
        }
        const productRow = toProductRow(row);
        await recordProductCreateIdempotency(transaction, {
          userId: input.userId,
          operation: "mind_manual_create",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          resourceType: "mind_state",
          resourceId: productRow.id,
          response:
            productRow as unknown as Record<string, unknown>,
        });
        return { outcome: "committed" as const, row: productRow };
      },
      { isolationLevel: "serializable" },
    );
  }

  async delete(input: {
    userId: string;
    subjectId: string;
    stateId: string;
  }): Promise<
    { outcome: "deleted"; deletedStateCount: number }
    | { outcome: "not_found" }
  > {
    return this.db.transaction(
      async (transaction) => {
        const rows = await transaction
          .select({
            id: runtimeSubjectStates.id,
            payload: runtimeSubjectStates.payload,
            envelope: runtimeSubjectStates.envelope,
          })
          .from(runtimeSubjectStates)
          .where(and(
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
          ))
          .for("update");

        if (!rows.some((row) => row.id === input.stateId)) {
          return { outcome: "not_found" as const };
        }

        const deleteIds = new Set<string>([input.stateId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const row of rows) {
            if (deleteIds.has(row.id)) continue;
            const repairedEnvelope =
              repairEnvelopeReferences(row.envelope, deleteIds);
            const repairedPayload =
              repairPayloadReferences(row.payload, deleteIds);
            if (
              repairedEnvelope.outcome === "delete"
              || repairedPayload.outcome === "delete"
            ) {
              deleteIds.add(row.id);
              changed = true;
            }
          }
        }

        for (const row of rows) {
          if (deleteIds.has(row.id)) continue;
          const envelopeRepair =
            repairEnvelopeReferences(row.envelope, deleteIds);
          if (envelopeRepair.outcome === "repair") {
            await transaction
              .update(runtimeSubjectStates)
              .set({
                envelope: envelopeRepair.value,
                updatedAt: new Date(),
              })
              .where(and(
                eq(runtimeSubjectStates.userId, input.userId),
                eq(runtimeSubjectStates.subjectId, input.subjectId),
                eq(runtimeSubjectStates.id, row.id),
              ));
          }
        }

        await deleteOperationalReferences(
          transaction as Transaction,
          input.userId,
          input.subjectId,
          deleteIds,
        );

        const deleted = await transaction
          .delete(runtimeSubjectStates)
          .where(and(
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            inArray(runtimeSubjectStates.id, [...deleteIds]),
          ))
          .returning({ id: runtimeSubjectStates.id });

        return {
          outcome: "deleted" as const,
          deletedStateCount: deleted.length,
        };
      },
      { isolationLevel: "serializable" },
    );
  }

  async readMessageWrites(input: {
    userId: string;
    subjectId: string;
    messageId: string;
  }): Promise<
    Array<{ kind: CurrentSubjectStateKind; count: number }> | null
  > {
    const [message] = await this.db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.id, input.messageId),
        eq(conversationMessages.userId, input.userId),
        eq(conversationMessages.role, "assistant"),
      ))
      .limit(1);
    if (!message) return null;

    const rows = await this.db.execute<{
      kind: CurrentSubjectStateKind;
      count: number;
    }>(sql`
      SELECT
        state.kind,
        count(*)::int AS count
      FROM runtime_subject_states AS state
      WHERE state.user_id = ${input.userId}::uuid
        AND state.subject_id = ${input.subjectId}
        AND ${inArray(sql`state.kind`, CURRENT_SUBJECT_STATE_KINDS)}
        AND state.envelope ->> 'authority' = 'subject_authorized'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(
              state.envelope -> 'provenance' -> 'sources',
              '[]'::jsonb
            )
          ) AS source
          WHERE source ->> 'kind' = 'message'
            AND source ->> 'id' = ${input.messageId}
        )
      GROUP BY state.kind
    `);
    return rows.map((row) => ({
      kind: row.kind,
      count: Number(row.count),
    }));
  }
}

async function deleteOperationalReferences(
  transaction: Transaction,
  userId: string,
  subjectId: string,
  deleteIds: ReadonlySet<string>,
): Promise<void> {
  const wakes = await transaction
    .select({
      id: runtimeProactivityWakes.id,
      gate: runtimeProactivityWakes.gate,
      contextSnapshot: runtimeProactivityWakes.contextSnapshot,
      decision: runtimeProactivityWakes.decision,
    })
    .from(runtimeProactivityWakes)
    .where(and(
      eq(runtimeProactivityWakes.userId, userId),
      eq(runtimeProactivityWakes.subjectId, subjectId),
    ));
  const wakeIds = wakes
    .filter((wake) =>
      structuredValueReferencesAnyId(wake.gate, deleteIds)
      || structuredValueReferencesAnyId(
        wake.contextSnapshot,
        deleteIds,
      )
      || structuredValueReferencesAnyId(wake.decision, deleteIds)
    )
    .map((wake) => wake.id);

  const effects = await transaction
    .select({
      id: runtimeEffects.id,
      sourceWakeId: runtimeEffects.sourceWakeId,
      payload: runtimeEffects.payload,
    })
    .from(runtimeEffects)
    .where(and(
      eq(runtimeEffects.userId, userId),
      eq(runtimeEffects.subjectId, subjectId),
    ));
  const effectIds = effects
    .filter((effect) =>
      wakeIds.includes(effect.sourceWakeId)
      || structuredValueReferencesAnyId(effect.payload, deleteIds)
    )
    .map((effect) => effect.id);
  if (effectIds.length > 0) {
    await transaction
      .delete(runtimeEffects)
      .where(and(
        eq(runtimeEffects.userId, userId),
        inArray(runtimeEffects.id, effectIds),
      ));
  }
  if (wakeIds.length > 0) {
    await transaction
      .delete(runtimeProactivityWakes)
      .where(and(
        eq(runtimeProactivityWakes.userId, userId),
        inArray(runtimeProactivityWakes.id, wakeIds),
      ));
  }

  const groupingRows = await transaction
    .select({
      id: runtimeMindSemanticGroupingRequests.id,
      queryStateId: runtimeMindSemanticGroupingRequests.queryStateId,
      candidates: runtimeMindSemanticGroupingRequests.candidates,
      scores: runtimeMindSemanticGroupingRequests.scores,
    })
    .from(runtimeMindSemanticGroupingRequests)
    .where(and(
      eq(runtimeMindSemanticGroupingRequests.userId, userId),
      eq(runtimeMindSemanticGroupingRequests.subjectId, subjectId),
    ));

  const groupingIds = groupingRows
    .filter((row) =>
      deleteIds.has(row.queryStateId)
      || structuredValueReferencesAnyId(row.candidates, deleteIds)
      || structuredValueReferencesAnyId(row.scores, deleteIds)
    )
    .map((row) => row.id);
  if (groupingIds.length > 0) {
    await transaction
      .delete(runtimeMindSemanticGroupingRequests)
      .where(and(
        eq(runtimeMindSemanticGroupingRequests.userId, userId),
        inArray(runtimeMindSemanticGroupingRequests.id, groupingIds),
      ));
  }

  const jobs = await transaction
    .select({
      id: nativeLiveBackgroundModelJobs.id,
      workflowRunId: nativeLiveBackgroundModelJobs.workflowRunId,
      payload: nativeLiveBackgroundModelJobs.workflowPayload,
    })
    .from(nativeLiveBackgroundModelJobs)
    .where(eq(nativeLiveBackgroundModelJobs.userId, userId));
  const jobIds = jobs
    .filter((job) =>
      (
        job.workflowRunId !== null
        && wakeIds.includes(job.workflowRunId)
      )
      || structuredValueReferencesAnyId(job.payload, deleteIds)
    )
    .map((job) => job.id);
  if (jobIds.length > 0) {
    await transaction
      .delete(nativeLiveBackgroundModelJobs)
      .where(and(
        eq(nativeLiveBackgroundModelJobs.userId, userId),
        inArray(nativeLiveBackgroundModelJobs.id, jobIds),
      ));
  }
}

function repairEnvelopeReferences(
  envelope: Record<string, unknown>,
  deletedIds: ReadonlySet<string>,
):
  | { outcome: "unchanged" }
  | { outcome: "repair"; value: Record<string, unknown> }
  | { outcome: "delete" } {
  if (!structuredValueReferencesAnyId(envelope, deletedIds)) {
    return { outcome: "unchanged" };
  }

  const provenanceValue = envelope.provenance;
  if (!isRecord(provenanceValue)) return { outcome: "delete" };
  const provenance = { ...provenanceValue };
  const sources = Array.isArray(provenance.sources)
    ? provenance.sources
    : null;
  if (!sources) return { outcome: "delete" };

  const survivingSources = sources.filter((source) =>
    !(
      isRecord(source)
      && typeof source.id === "string"
      && deletedIds.has(source.id)
    )
  );
  if (survivingSources.length === 0) return { outcome: "delete" };
  provenance.sources = survivingSources;

  if (Array.isArray(provenance.derivedFrom)) {
    provenance.derivedFrom = provenance.derivedFrom.filter((value) =>
      !(typeof value === "string" && deletedIds.has(value))
    );
  }
  for (const key of [
    "parentId",
    "causedBy",
    "decisionId",
    "processRunId",
  ] as const) {
    if (
      typeof provenance[key] === "string"
      && deletedIds.has(provenance[key] as string)
    ) {
      provenance[key] = null;
    }
  }

  const next = { ...envelope, provenance };
  return structuredValueReferencesAnyId(next, deletedIds)
    ? { outcome: "delete" }
    : { outcome: "repair", value: next };
}

function repairPayloadReferences(
  payload: Record<string, unknown> | null,
  deletedIds: ReadonlySet<string>,
):
  | { outcome: "unchanged" }
  | { outcome: "delete" } {
  return payload && structuredValueReferencesAnyId(payload, deletedIds)
    ? { outcome: "delete" }
    : { outcome: "unchanged" };
}

function rowSelection() {
  return {
    id: runtimeSubjectStates.id,
    kind: runtimeSubjectStates.kind,
    text: runtimeSubjectStates.text,
    payload: runtimeSubjectStates.payload,
    envelope: runtimeSubjectStates.envelope,
    createdAt: runtimeSubjectStates.createdAt,
    updatedAt: runtimeSubjectStates.updatedAt,
  };
}

function toProductRow(row: Row): MindProductRow {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    payload: row.payload,
    envelope:
      row.envelope as unknown as PersistentWriteEnvelope,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value);
}

async function insertMindState(transaction: Transaction, state: SubjectStateWrite,
  input: {userId: string; subjectId: string}) {
  const [row] = await transaction.insert(runtimeSubjectStates).values({
    id: state.id,
    userId: input.userId,
    subjectId: input.subjectId,
    kind: state.kind,
    text: state.text ?? null,
    payload: state.payload ?? null,
    scopeApplicability: state.envelope.scope.applicability,
    scopeConversationId:
      state.envelope.scope.conversationId ?? null,
    scopePathHeadMessageId:
      state.envelope.scope.pathHeadMessageId ?? null,
    settlementStatus:
      state.envelope.status.settlementStatus,
    pathStatus: state.envelope.status.pathStatus,
    validityStatus: state.envelope.status.validityStatus,
    envelope:
      state.envelope as unknown as Record<string, unknown>,
  }).returning(rowSelection());
  return row;
}

function memoryConditions(input: { userId: string; subjectId: string }) {
  return [
    eq(runtimeSubjectStates.userId, input.userId),
    eq(runtimeSubjectStates.subjectId, input.subjectId),
    eq(runtimeSubjectStates.kind, "memory"),
    eq(runtimeSubjectStates.settlementStatus, "settled"),
    eq(runtimeSubjectStates.pathStatus, "current"),
    eq(runtimeSubjectStates.validityStatus, "valid"),
    productVisibilityCondition(),
  ];
}

function productVisibilityCondition() {
  return sql`${runtimeSubjectStates.envelope}->'scope'->>'visibility' IS DISTINCT FROM 'hidden_system'`;
}

/** Match the canonical temporal reader, including legacy manual dates. Bad
 * metadata is undated, rather than making one row abort an entire date query. */
function memoryOccurredAtSql() {
  const payload = runtimeSubjectStates.payload;
  const raw = sql`CASE WHEN jsonb_typeof(${payload}->'temporal_v1') = 'object' THEN
    CASE WHEN jsonb_typeof(${payload}->'temporal_v1'->'occurredAt') = 'string' AND (
      (${payload}->'temporal_v1'->>'basis' = 'user_supplied' AND (CASE WHEN jsonb_typeof(${payload}->'temporal_v1'->'sourceMessageId') = 'string' THEN btrim(${payload}->'temporal_v1'->>'sourceMessageId', ${SUBJECT_STATE_TRIM_CHARS}) ELSE '' END) = '') OR
      (${payload}->'temporal_v1'->>'basis' = 'source_message' AND jsonb_typeof(${payload}->'temporal_v1'->'sourceMessageId') = 'string' AND btrim(${payload}->'temporal_v1'->>'sourceMessageId', ${SUBJECT_STATE_TRIM_CHARS}) <> '')
    ) THEN ${payload}->'temporal_v1'->>'occurredAt' END
    ELSE CASE WHEN jsonb_typeof(${payload}->'manual_v1'->'occurredAt') = 'string' THEN ${payload}->'manual_v1'->>'occurredAt' END END`;
  const trimmed = sql`btrim(${raw}, ${SUBJECT_STATE_TRIM_CHARS})`;
  const iso = sql`CASE WHEN length(${trimmed}) = 10
    THEN ${trimmed} || 'T00:00:00Z' ELSE upper(${trimmed}) END`;
  // Match the canonical reader's millisecond truncation before PG can round
  // sub-millisecond digits across a day boundary.
  const milliseconds = sql`regexp_replace(${iso}, ${"(\\.[0-9]{3})[0-9]+(Z|[+-].*)$"}, ${"\\1\\2"})`;
  return sql`CASE WHEN ${trimmed} ~ ${SUBJECT_STATE_ISO_PATTERN}
    AND ${trimmed} !~ '^0000-' AND pg_input_is_valid(${milliseconds}, 'timestamp with time zone')
    THEN (${milliseconds})::timestamptz END`;
}
