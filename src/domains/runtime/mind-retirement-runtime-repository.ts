import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  runtimeMindRetirementReceipts,
  runtimeSubjectStates,
} from "../../database/schema.js";
import {
  hasExternalMindRetirementReferences,
  hasMindRetirementThreadState,
  planMindRetirement,
  selectRetirableThreadMembers,
  type MindRetirementCandidate,
  type MindRetirementCommitInput,
  type MindRetirementRuntimePort,
} from "./mind-retirement.js";
import type {
  MindRetirementKind,
  MindRetirementPolicy,
} from "./mind-retirement-policy.js";

type Database = ReturnType<typeof createDatabase>["db"];

const RETIREMENT_KINDS: MindRetirementKind[] = [
  "drive",
  "thought",
  "curiosity",
  "topic",
];

export class DrizzleMindRetirementRuntimePort
implements MindRetirementRuntimePort {
  constructor(private readonly db: Database) {}

  async listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<MindRetirementCandidate[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new Error("Mind retirement candidate limit must be positive.");
    }

    const rows = await this.db
      .select({
        id: runtimeSubjectStates.id,
        kind: runtimeSubjectStates.kind,
        payload: runtimeSubjectStates.payload,
        updatedAt: runtimeSubjectStates.updatedAt,
      })
      .from(runtimeSubjectStates)
      .where(
        and(
          eq(runtimeSubjectStates.userId, input.userId),
          eq(runtimeSubjectStates.subjectId, input.subjectId),
          inArray(runtimeSubjectStates.kind, RETIREMENT_KINDS),
          eq(runtimeSubjectStates.settlementStatus, "settled"),
          eq(runtimeSubjectStates.pathStatus, "current"),
          eq(runtimeSubjectStates.validityStatus, "valid"),
          sql`(
            (${runtimeSubjectStates.kind} = 'drive'
              AND ${runtimeSubjectStates.payload} -> 'drive_v1' ->> 'role' = 'anchor')
            OR
            (${runtimeSubjectStates.kind} = 'thought'
              AND ${runtimeSubjectStates.payload} -> 'thought_v1' ->> 'role' = 'anchor')
            OR
            (${runtimeSubjectStates.kind} = 'curiosity'
              AND ${runtimeSubjectStates.payload} -> 'curiosity_v1' ->> 'role' = 'anchor')
            OR
            (${runtimeSubjectStates.kind} = 'topic'
              AND ${runtimeSubjectStates.payload} -> 'topic_v1' ->> 'role' = 'anchor')
          )`,
        ),
      )
      .orderBy(
        asc(runtimeSubjectStates.updatedAt),
        asc(runtimeSubjectStates.id),
      )
      .limit(input.limit);

    return rows.map((row) => ({
      stateId: row.id,
      kind: requireRetirementKind(row.kind),
      payload: row.payload,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async retireThread(input: MindRetirementCommitInput): Promise<
    | { outcome: "retired"; deleted: number }
    | { outcome: "conflict"; deleted: 0 }
  > {
    return this.db.transaction(async (transaction) => {
      const rows = await transaction
        .select({
          id: runtimeSubjectStates.id,
          kind: runtimeSubjectStates.kind,
          payload: runtimeSubjectStates.payload,
          envelope: runtimeSubjectStates.envelope,
          scopePathHeadMessageId:
            runtimeSubjectStates.scopePathHeadMessageId,
          settlementStatus: runtimeSubjectStates.settlementStatus,
          updatedAt: runtimeSubjectStates.updatedAt,
        })
        .from(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            eq(runtimeSubjectStates.kind, input.kind),
            eq(runtimeSubjectStates.pathStatus, "current"),
            eq(runtimeSubjectStates.validityStatus, "valid"),
          ),
        )
        .for("update");

      const settledRows = rows.filter(
        (row) => row.settlementStatus === "settled",
      );
      const candidates: MindRetirementCandidate[] = settledRows.map(
        (row) => ({
          stateId: row.id,
          kind: requireRetirementKind(row.kind),
          payload: row.payload,
          updatedAt: row.updatedAt.toISOString(),
        }),
      );

      // Any current settled state of this kind that cannot be interpreted by
      // the current lifecycle contract blocks destructive retirement. This is
      // intentionally conservative for legacy/corrupt payloads.
      if (candidates.some((candidate) =>
        !hasMindRetirementThreadState(candidate)
      )) {
        return { outcome: "conflict" as const, deleted: 0 as const };
      }

      const anchor = candidates.find(
        (candidate) => candidate.stateId === input.anchorStateId,
      );
      if (
        !anchor
        || anchor.updatedAt !== input.expectedUpdatedAt
      ) {
        return { outcome: "conflict" as const, deleted: 0 as const };
      }

      const policy: MindRetirementPolicy = {
        [input.kind]: { retentionHours: input.retentionHours },
      };
      const currentPlan = planMindRetirement(
        anchor,
        input.retiredAt,
        policy,
      );
      if (
        !currentPlan
        || currentPlan.anchorStateId !== input.anchorStateId
        || currentPlan.threadKey !== input.threadKey
        || currentPlan.terminalAt !== input.terminalAt
        || currentPlan.retentionHours !== input.retentionHours
        || currentPlan.expectedUpdatedAt !== input.expectedUpdatedAt
      ) {
        return { outcome: "conflict" as const, deleted: 0 as const };
      }

      const memberIds = selectRetirableThreadMembers(
        candidates,
        currentPlan,
        input.retiredAt,
      );
      if (!memberIds || memberIds.length === 0) {
        return { outcome: "conflict" as const, deleted: 0 as const };
      }
      const memberSet = new Set(memberIds);

      const allCurrentStates = await transaction
        .select({
          id: runtimeSubjectStates.id,
          payload: runtimeSubjectStates.payload,
          envelope: runtimeSubjectStates.envelope,
          scopePathHeadMessageId:
            runtimeSubjectStates.scopePathHeadMessageId,
        })
        .from(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            eq(runtimeSubjectStates.pathStatus, "current"),
            eq(runtimeSubjectStates.validityStatus, "valid"),
          ),
        );

      if (
        hasExternalMindRetirementReferences(
          allCurrentStates,
          memberSet,
        )
      ) {
        return { outcome: "conflict" as const, deleted: 0 as const };
      }

      const deleted = await transaction
        .delete(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            eq(runtimeSubjectStates.kind, input.kind),
            inArray(runtimeSubjectStates.id, memberIds),
            eq(runtimeSubjectStates.pathStatus, "current"),
            eq(runtimeSubjectStates.validityStatus, "valid"),
          ),
        )
        .returning({ id: runtimeSubjectStates.id });

      if (deleted.length !== memberIds.length) {
        throw new Error(
          "Mind retirement thread changed during deletion.",
        );
      }

      await transaction.insert(runtimeMindRetirementReceipts).values({
        userId: input.userId,
        subjectId: input.subjectId,
        kind: input.kind,
        anchorStateId: input.anchorStateId,
        threadKey: input.threadKey,
        stateCount: deleted.length,
        terminalAt: new Date(input.terminalAt),
        retentionHours: input.retentionHours,
        retiredAt: new Date(input.retiredAt),
      });

      return {
        outcome: "retired" as const,
        deleted: deleted.length,
      };
    }, {
      isolationLevel: "serializable",
    });
  }
}

function requireRetirementKind(value: unknown): MindRetirementKind {
  if (
    value !== "drive"
    && value !== "thought"
    && value !== "curiosity"
    && value !== "topic"
  ) {
    throw new Error("Mind retirement kind is invalid.");
  }
  return value;
}
