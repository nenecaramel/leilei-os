import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  runtimeContextManifests,
  runtimeSubjectStateTransitions,
  runtimeSubjectStates,
} from "../../../database/schema.js";
import {
  assertContextManifestSafe,
  type InitialContextManifest,
} from "../context/context-assembly-contract.js";
import type {
  SubjectStateRuntimePort,
  SubjectStateTransition,
} from "../mind/native-live-mind-loop-service.js";
import type { PersistentWriteEnvelope } from "../shared/persistent-write-envelope.js";
import {
  CURRENT_SUBJECT_STATE_KINDS,
  validateSubjectStateWrite,
  type SubjectStateWrite,
} from "./subject-state-contract.js";
import {
  evaluateRecallReinforcement,
  type MemoryLifecyclePolicy,
} from "../lifecycle/memory-lifecycle.js";

type Database = ReturnType<typeof createDatabase>["db"];

function envelopeRecord(
  envelope: PersistentWriteEnvelope,
): Record<string, unknown> {
  return envelope as unknown as Record<string, unknown>;
}

function rowToState(row: {
  id: string;
  kind: SubjectStateWrite["kind"];
  text: string | null;
  payload: Record<string, unknown> | null;
  envelope: Record<string, unknown>;
}): SubjectStateWrite {
  return validateSubjectStateWrite({
    id: row.id,
    kind: row.kind,
    text: row.text,
    payload: row.payload,
    envelope: row.envelope as unknown as PersistentWriteEnvelope,
  });
}

function requirePortIdentity(
  state: SubjectStateWrite,
  input: { userId: string; subjectId: string },
): void {
  if (
    state.envelope.scope.userId !== input.userId
    || state.envelope.scope.subjectId !== input.subjectId
  ) {
    throw new Error("Subject state write scope does not match the runtime port identity.");
  }
}

export class DrizzleSubjectStateRuntimePort implements SubjectStateRuntimePort {
  constructor(private readonly db: Database) {}

  async list(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    globalOnly?: boolean;
  }): Promise<SubjectStateWrite[]> {
    const rows = await this.db
      .select({
        id: runtimeSubjectStates.id,
        kind: runtimeSubjectStates.kind,
        text: runtimeSubjectStates.text,
        payload: runtimeSubjectStates.payload,
        envelope: runtimeSubjectStates.envelope,
      })
      .from(runtimeSubjectStates)
      .where(
        and(
          eq(runtimeSubjectStates.userId, input.userId),
          eq(runtimeSubjectStates.subjectId, input.subjectId),
          inArray(runtimeSubjectStates.kind, CURRENT_SUBJECT_STATE_KINDS),
          input.globalOnly
            ? eq(runtimeSubjectStates.scopeApplicability, "global")
            : or(
                isNull(runtimeSubjectStates.scopeConversationId),
                eq(runtimeSubjectStates.scopeConversationId, input.conversationId),
              ),
        ),
      )
      .orderBy(
        asc(runtimeSubjectStates.createdAt),
        asc(runtimeSubjectStates.id),
      );

    return rows.map(rowToState);
  }

  async append(input: {
    userId: string;
    subjectId: string;
    states: SubjectStateWrite[];
    sourceConversationId?: string;
  }): Promise<void> {
    if (input.states.length === 0) return;

    const states = input.states.map((candidate) => {
      const state = validateSubjectStateWrite(candidate);
      requirePortIdentity(state, input);
      return {
        ...state,
        text: state.text ?? null,
        payload: state.payload ?? null,
      };
    });

    await this.db.transaction(async (transaction) => {
      const scopedConversationIds = [
        ...new Set([
          ...(input.sourceConversationId
            ? [input.sourceConversationId]
            : []),
          ...states
            .map((state) => state.envelope.scope.conversationId ?? null)
            .filter((value): value is string => value !== null),
        ]),
      ];
      for (const conversationId of scopedConversationIds) {
        const active = await transaction.execute<{ id: string }>(sql`
          SELECT id
          FROM conversations
          WHERE id = ${conversationId}::uuid
            AND user_id = ${input.userId}::uuid
            AND origin = 'native_live'
            AND lifecycle_status = 'active'
          FOR SHARE
        `);
        if (active.length !== 1) {
          throw new Error("SubjectStateSourceConversationInactive");
        }
      }

      await transaction
        .insert(runtimeSubjectStates)
        .values(
          states.map((state) => ({
            id: state.id,
            userId: input.userId,
            subjectId: input.subjectId,
            kind: state.kind,
            text: state.text ?? null,
            payload: state.payload ?? null,
            scopeApplicability: state.envelope.scope.applicability,
            scopeConversationId: state.envelope.scope.conversationId ?? null,
            scopePathHeadMessageId:
              state.envelope.scope.pathHeadMessageId ?? null,
            settlementStatus: state.envelope.status.settlementStatus,
            pathStatus: state.envelope.status.pathStatus,
            validityStatus: state.envelope.status.validityStatus,
            envelope: envelopeRecord(state.envelope),
          })),
        )
        .onConflictDoNothing();

      const rows = await transaction
        .select({
          id: runtimeSubjectStates.id,
          kind: runtimeSubjectStates.kind,
          text: runtimeSubjectStates.text,
          payload: runtimeSubjectStates.payload,
          envelope: runtimeSubjectStates.envelope,
        })
        .from(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            inArray(
              runtimeSubjectStates.id,
              states.map((state) => state.id),
            ),
          ),
        );

      if (rows.length !== states.length) {
        throw new Error(
          "Subject state idempotent append could not verify every state.",
        );
      }

      const byId = new Map(rows.map((row) => [row.id, rowToState(row)]));
      for (const expected of states) {
        const actual = byId.get(expected.id);
        if (!actual || !isDeepStrictEqual(actual, expected)) {
          throw new Error(
            "Subject state idempotent append encountered a conflicting state id.",
          );
        }
      }
    });
  }

  async transition(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    transitions: SubjectStateTransition[];
  }): Promise<void> {
    if (input.transitions.length === 0) return;

    await this.db.transaction(async (transaction) => {
      const active = await transaction.execute<{ id: string }>(sql`
        SELECT id
        FROM conversations
        WHERE id = ${input.conversationId}::uuid
          AND user_id = ${input.userId}::uuid
          AND origin = 'native_live'
          AND lifecycle_status = 'active'
        FOR SHARE
      `);
      if (active.length !== 1) {
        throw new Error("SubjectStateSourceConversationInactive");
      }

      for (const requested of input.transitions) {
        const [row] = await transaction
          .select({
            id: runtimeSubjectStates.id,
            kind: runtimeSubjectStates.kind,
            text: runtimeSubjectStates.text,
            payload: runtimeSubjectStates.payload,
            envelope: runtimeSubjectStates.envelope,
          })
          .from(runtimeSubjectStates)
          .where(
            and(
              eq(runtimeSubjectStates.id, requested.stateId),
              eq(runtimeSubjectStates.userId, input.userId),
              eq(runtimeSubjectStates.subjectId, input.subjectId),
            ),
          )
          .for("update")
          .limit(1);

        if (!row) {
          throw new Error("Subject state transition target was not found.");
        }

        const current = rowToState(row);
        const currentScope = current.envelope.scope;
        if (
          currentScope.applicability !== "global"
          && currentScope.conversationId !== input.conversationId
        ) {
          throw new Error("Subject state transition crossed conversation scope.");
        }

        const nextEnvelope: PersistentWriteEnvelope = {
          ...current.envelope,
          scope: requested.promoteScopeToGlobal
            ? {
                ...currentScope,
                applicability: "global",
                conversationId: null,
                pathHeadMessageId: null,
              }
            : currentScope,
          status: {
            ...current.envelope.status,
            settlementStatus:
              requested.settlementStatus
              ?? current.envelope.status.settlementStatus,
            pathStatus:
              requested.pathStatus
              ?? current.envelope.status.pathStatus,
            validityStatus:
              requested.validityStatus
              ?? current.envelope.status.validityStatus,
          },
        };

        const next = validateSubjectStateWrite({
          ...current,
          envelope: nextEnvelope,
        });

        const updated = await transaction
          .update(runtimeSubjectStates)
          .set({
            scopeApplicability: next.envelope.scope.applicability,
            scopeConversationId: next.envelope.scope.conversationId ?? null,
            scopePathHeadMessageId:
              next.envelope.scope.pathHeadMessageId ?? null,
            settlementStatus: next.envelope.status.settlementStatus,
            pathStatus: next.envelope.status.pathStatus,
            validityStatus: next.envelope.status.validityStatus,
            envelope: envelopeRecord(next.envelope),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(runtimeSubjectStates.id, requested.stateId),
              eq(runtimeSubjectStates.userId, input.userId),
              eq(runtimeSubjectStates.subjectId, input.subjectId),
            ),
          )
          .returning({ id: runtimeSubjectStates.id });

        if (updated.length !== 1) {
          throw new Error("Subject state transition affected an unexpected number of rows.");
        }

        await transaction.insert(runtimeSubjectStateTransitions).values({
          userId: input.userId,
          subjectId: input.subjectId,
          stateId: requested.stateId,
          reason: requested.reason,
          beforeEnvelope: envelopeRecord(current.envelope),
          afterEnvelope: envelopeRecord(next.envelope),
        });
      }

    });
  }

  async recordBreathRecall(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    contextEpoch: number;
    stateIds: readonly string[];
    recalledAt: string;
    salienceBoost: number;
    sourceMessageId: string;
    lifecyclePolicy?: MemoryLifecyclePolicy;
  }): Promise<void> {
    if (input.stateIds.length === 0) return;
    const recalledAt = new Date(input.recalledAt);
    if (!Number.isFinite(recalledAt.getTime())) {
      throw new Error("Breath recalledAt must be an ISO timestamp.");
    }

    await this.db.transaction(async (transaction) => {
      const activeSource = await transaction.execute<{ id: string }>(sql`
        SELECT conversation.id
        FROM conversation_messages AS message
        INNER JOIN conversations AS conversation
          ON conversation.id = message.conversation_id
         AND conversation.user_id = message.user_id
        WHERE message.id = ${input.sourceMessageId}::uuid
          AND message.user_id = ${input.userId}::uuid
          AND conversation.origin = 'native_live'
          AND conversation.lifecycle_status = 'active'
        FOR SHARE OF conversation
      `);
      if (activeSource.length !== 1) return;

      await applyFinalizedMemoryRecall(transaction, {...input, sourceId: input.sourceMessageId});
    });
  }

  async loadContextManifest(input: {
    userId: string;
    subjectId: string;
    manifestId: string;
  }): Promise<InitialContextManifest | null> {
    const [row] = await this.db
      .select({
        id: runtimeContextManifests.id,
        userId: runtimeContextManifests.userId,
        subjectId: runtimeContextManifests.subjectId,
        conversationId: runtimeContextManifests.conversationId,
        pathHeadMessageId: runtimeContextManifests.pathHeadMessageId,
        snapshotSequence: runtimeContextManifests.snapshotSequence,
        assemblyVersion: runtimeContextManifests.assemblyVersion,
        promptContractVersion: runtimeContextManifests.promptContractVersion,
        lineage: runtimeContextManifests.lineage,
        budget: runtimeContextManifests.budget,
        items: runtimeContextManifests.items,
        assembledAt: runtimeContextManifests.assembledAt,
      })
      .from(runtimeContextManifests)
      .where(
        and(
          eq(runtimeContextManifests.id, input.manifestId),
          eq(runtimeContextManifests.userId, input.userId),
          eq(runtimeContextManifests.subjectId, input.subjectId),
        ),
      )
      .limit(1);

    if (!row) return null;
    const manifest = {
      manifestId: row.id,
      userId: row.userId,
      subjectId: row.subjectId,
      conversationId: row.conversationId,
      pathHeadMessageId: row.pathHeadMessageId,
      snapshotSequence: row.snapshotSequence,
      assemblyVersion: row.assemblyVersion,
      promptContractVersion: row.promptContractVersion,
      createdAt: row.assembledAt.toISOString(),
      lineage: row.lineage,
      budget: row.budget,
      items: row.items,
    } as InitialContextManifest;
    assertContextManifestSafe(manifest);
    return manifest;
  }

  async saveContextManifest(input: {
    manifest: InitialContextManifest;
  }): Promise<void> {
    const manifest = input.manifest;
    await this.db.transaction(async (transaction) => {
      const active = await transaction.execute<{ id: string }>(sql`
        SELECT id
        FROM conversations
        WHERE id = ${manifest.conversationId}::uuid
          AND user_id = ${manifest.userId}::uuid
          AND origin = 'native_live'
          AND lifecycle_status = 'active'
        FOR SHARE
      `);
      if (active.length !== 1) {
        throw new Error("ContextManifestSourceConversationInactive");
      }

      await transaction
        .insert(runtimeContextManifests)
        .values({
          id: manifest.manifestId,
          userId: manifest.userId,
          subjectId: manifest.subjectId,
          conversationId: manifest.conversationId,
          pathHeadMessageId: manifest.pathHeadMessageId,
          snapshotSequence: manifest.snapshotSequence,
          assemblyVersion: manifest.assemblyVersion,
          promptContractVersion: manifest.promptContractVersion,
          lineage:
            manifest.lineage as unknown as Record<string, unknown> | null | undefined,
          budget: manifest.budget as unknown as Record<string, unknown>,
          items: manifest.items as unknown as Record<string, unknown>[],
          assembledAt: new Date(manifest.createdAt),
        })
        .onConflictDoNothing();

      const [row] = await transaction
        .select({
          id: runtimeContextManifests.id,
          userId: runtimeContextManifests.userId,
          subjectId: runtimeContextManifests.subjectId,
          conversationId: runtimeContextManifests.conversationId,
          pathHeadMessageId: runtimeContextManifests.pathHeadMessageId,
          snapshotSequence: runtimeContextManifests.snapshotSequence,
          assemblyVersion: runtimeContextManifests.assemblyVersion,
          promptContractVersion: runtimeContextManifests.promptContractVersion,
          lineage: runtimeContextManifests.lineage,
          budget: runtimeContextManifests.budget,
          items: runtimeContextManifests.items,
          assembledAt: runtimeContextManifests.assembledAt,
        })
        .from(runtimeContextManifests)
        .where(eq(runtimeContextManifests.id, manifest.manifestId))
        .limit(1);

      if (!row) {
        throw new Error("Context manifest idempotent save could not verify row.");
      }

      const actual = {
        manifestId: row.id,
        userId: row.userId,
        subjectId: row.subjectId,
        conversationId: row.conversationId,
        pathHeadMessageId: row.pathHeadMessageId,
        snapshotSequence: row.snapshotSequence,
        assemblyVersion: row.assemblyVersion,
        promptContractVersion: row.promptContractVersion,
        createdAt: row.assembledAt.toISOString(),
        lineage: row.lineage,
        budget: row.budget,
        items: row.items,
      };
      const expected = {
        ...manifest,
        lineage: manifest.lineage ?? null,
      };
      if (!isDeepStrictEqual(actual, expected)) {
        throw new Error(
          "Context manifest idempotent save encountered a conflicting manifest id.",
        );
      }
    });
  }
}


export type FinalizedMemoryRecallInput = {
  userId: string; subjectId: string; conversationId: string; contextEpoch: number;
  stateIds: readonly string[]; recalledAt: string; salienceBoost: number; sourceId: string;
  lifecyclePolicy?: MemoryLifecyclePolicy; globalOnly?: boolean;
};

/** Caller validates its canonical causal proof; mutation and receipt commit in the caller transaction. */
export async function applyFinalizedMemoryRecall(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: FinalizedMemoryRecallInput,
): Promise<void> {
  const recalledAt = new Date(input.recalledAt);
  if (!Number.isFinite(recalledAt.getTime())) throw new Error("Invalid recall timestamp.");
  for (const stateId of [...new Set(input.stateIds)].sort()) {
    const [row] = await transaction
      .select({
        id: runtimeSubjectStates.id,
        kind: runtimeSubjectStates.kind,
        payload: runtimeSubjectStates.payload,
        updatedAt: runtimeSubjectStates.updatedAt,
      })
      .from(runtimeSubjectStates)
      .where(
        and(
          eq(runtimeSubjectStates.id, stateId),
          eq(runtimeSubjectStates.userId, input.userId),
          eq(runtimeSubjectStates.subjectId, input.subjectId),
          ...(input.globalOnly ? [eq(runtimeSubjectStates.scopeApplicability, "global")] : []),
          eq(runtimeSubjectStates.settlementStatus, "settled"),
          eq(runtimeSubjectStates.pathStatus, "current"),
          eq(runtimeSubjectStates.validityStatus, "valid"),
        ),
      )
      .for("update")
      .limit(1);

    if (!row || row.kind !== "memory") continue;

    let update;
    try {
      update = evaluateRecallReinforcement(
        {
          stateId: row.id,
          kind: row.kind,
          payload: row.payload,
          updatedAt: row.updatedAt.toISOString(),
        },
        recalledAt.toISOString(),
        input.salienceBoost,
        input.sourceId,
        input.lifecyclePolicy,
        {
          conversationId: input.conversationId,
          epoch: input.contextEpoch,
        },
      );
    } catch {
      continue;
    }
    if (!update) continue;

    await transaction
      .update(runtimeSubjectStates)
      .set({
        payload: update.nextPayload,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(runtimeSubjectStates.id, stateId),
          eq(runtimeSubjectStates.userId, input.userId),
          eq(runtimeSubjectStates.subjectId, input.subjectId),
          eq(runtimeSubjectStates.validityStatus, "valid"),
        ),
      );
  }
}
