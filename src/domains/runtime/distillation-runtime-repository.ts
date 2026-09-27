import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  runtimeDistillationWatermarks,
  runtimeSubjectStates,
} from "../../database/schema.js";
import type {
  DistillationRuntimePort,
} from "./distillation.js";
import type { PersistentWriteEnvelope } from "./persistent-write-envelope.js";
import {
  validateSubjectStateWrite,
  type SubjectStateWrite,
} from "./subject-state-contract.js";

type Database = ReturnType<typeof createDatabase>["db"];

function envelopeRecord(
  envelope: PersistentWriteEnvelope,
): Record<string, unknown> {
  return envelope as unknown as Record<string, unknown>;
}

function validateDistilledState(
  state: SubjectStateWrite,
  input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    nextWatermarkMessageId: string;
  },
): SubjectStateWrite {
  const validated = validateSubjectStateWrite(state);
  const scope = validated.envelope.scope;

  if (
    validated.kind !== "memory"
    || validated.envelope.authority !== "derived"
    || scope.userId !== input.userId
    || scope.subjectId !== input.subjectId
    || scope.applicability !== "path"
    || scope.conversationId !== input.conversationId
    || scope.pathHeadMessageId !== input.nextWatermarkMessageId
    || validated.envelope.status.settlementStatus !== "settled"
    || validated.envelope.status.validityStatus !== "valid"
  ) {
    throw new Error(
      "Distillation commit received a state outside the V1 derived-memory contract.",
    );
  }

  return validated;
}

export class DrizzleDistillationRuntimePort implements DistillationRuntimePort {
  constructor(
    private readonly db: Database,
    private readonly processVersion: string,
  ) {
    if (!processVersion.trim()) {
      throw new Error("Distillation processVersion must not be blank.");
    }
  }

  async getWatermark(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
  }): Promise<string | null> {
    const [row] = await this.db
      .select({
        lastSourceMessageId:
          runtimeDistillationWatermarks.lastSourceMessageId,
      })
      .from(runtimeDistillationWatermarks)
      .where(
        and(
          eq(runtimeDistillationWatermarks.userId, input.userId),
          eq(runtimeDistillationWatermarks.subjectId, input.subjectId),
          eq(
            runtimeDistillationWatermarks.conversationId,
            input.conversationId,
          ),
        ),
      )
      .limit(1);

    return row?.lastSourceMessageId ?? null;
  }

  async commitSuccess(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    expectedPreviousWatermarkMessageId: string | null;
    nextWatermarkMessageId: string;
    states: readonly SubjectStateWrite[];
  }): Promise<"committed" | "conflict"> {
    const states = input.states.map((state) =>
      validateDistilledState(state, input),
    );

    return this.db.transaction(async (transaction) => {
      const active = await transaction.execute<{ id: string }>(sql`
        SELECT id
        FROM conversations
        WHERE id = ${input.conversationId}::uuid
          AND user_id = ${input.userId}::uuid
          AND origin = 'native_live'
          AND lifecycle_status = 'active'
        FOR SHARE
      `);
      if (active.length !== 1) return "conflict" as const;

      const [watermark] = await transaction
        .select({
          lastSourceMessageId:
            runtimeDistillationWatermarks.lastSourceMessageId,
        })
        .from(runtimeDistillationWatermarks)
        .where(
          and(
            eq(runtimeDistillationWatermarks.userId, input.userId),
            eq(runtimeDistillationWatermarks.subjectId, input.subjectId),
            eq(
              runtimeDistillationWatermarks.conversationId,
              input.conversationId,
            ),
          ),
        )
        .for("update")
        .limit(1);

      const actualPrevious = watermark?.lastSourceMessageId ?? null;
      if (actualPrevious !== input.expectedPreviousWatermarkMessageId) {
        return "conflict" as const;
      }

      if (states.length > 0) {
        await transaction.insert(runtimeSubjectStates).values(
          states.map((state) => ({
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
            envelope: envelopeRecord(state.envelope),
          })),
        );
      }

      if (watermark) {
        await transaction
          .update(runtimeDistillationWatermarks)
          .set({
            lastSourceMessageId: input.nextWatermarkMessageId,
            processVersion: this.processVersion,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(runtimeDistillationWatermarks.userId, input.userId),
              eq(runtimeDistillationWatermarks.subjectId, input.subjectId),
              eq(
                runtimeDistillationWatermarks.conversationId,
                input.conversationId,
              ),
            ),
          );
      } else {
        await transaction.insert(runtimeDistillationWatermarks).values({
          userId: input.userId,
          subjectId: input.subjectId,
          conversationId: input.conversationId,
          lastSourceMessageId: input.nextWatermarkMessageId,
          processVersion: this.processVersion,
        });
      }

      return "committed" as const;
    });
  }
}
