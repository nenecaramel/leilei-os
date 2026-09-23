import { and, eq } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { runtimeSubjectStates } from "../../database/schema.js";
import type {
  PersistentWriteEnvelope,
} from "./persistent-write-envelope.js";
import {
  readTopicEvolution,
} from "./topic-evolution.js";
import {
  topicResurfaceThoughtStateId,
  topicResurfaceToThought,
  type TopicResurfaceThoughtMaterializationPort,
  type TopicResurfaceThoughtMaterializationPortResult,
} from "./topic-resurface-thought-materialization.js";

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleTopicResurfaceThoughtMaterializationPort
implements TopicResurfaceThoughtMaterializationPort {
  constructor(private readonly db: Database) {}

  async materialize(
    input: Parameters<TopicResurfaceThoughtMaterializationPort["materialize"]>[0],
  ): Promise<TopicResurfaceThoughtMaterializationPortResult> {
    const stateId =
      topicResurfaceThoughtStateId(input.sourceTopicStateId);

    return this.db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ id: runtimeSubjectStates.id })
        .from(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.id, stateId),
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            eq(runtimeSubjectStates.kind, "thought"),
          ),
        )
        .limit(1);

      if (existing) {
        return {
          outcome: "already_materialized",
          stateId,
        } as const;
      }

      const [sourceRow] = await transaction
        .select({
          id: runtimeSubjectStates.id,
          text: runtimeSubjectStates.text,
          payload: runtimeSubjectStates.payload,
          envelope: runtimeSubjectStates.envelope,
        })
        .from(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.id, input.sourceTopicStateId),
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            eq(runtimeSubjectStates.kind, "topic"),
            eq(runtimeSubjectStates.scopeApplicability, "global"),
            eq(runtimeSubjectStates.settlementStatus, "settled"),
            eq(runtimeSubjectStates.pathStatus, "current"),
            eq(runtimeSubjectStates.validityStatus, "valid"),
          ),
        )
        .for("update")
        .limit(1);

      if (!sourceRow) return { outcome: "source_ineligible" } as const;

      // The source row lock serializes concurrent materializers for one Topic.
      // Re-check the deterministic target after acquiring that lock so two
      // simultaneous runs converge on one Thought instead of racing the PK.
      const [existingAfterLock] = await transaction
        .select({ id: runtimeSubjectStates.id })
        .from(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.id, stateId),
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            eq(runtimeSubjectStates.kind, "thought"),
          ),
        )
        .limit(1);

      if (existingAfterLock) {
        return {
          outcome: "already_materialized",
          stateId,
        } as const;
      }

      let topic;
      try {
        topic = readTopicEvolution(sourceRow.payload);
      } catch {
        return { outcome: "source_ineligible" } as const;
      }
      if (
        !topic
        || topic.phase !== "dormant"
        || topic.role !== "anchor"
        || topic.threadKey !== input.expectedThreadKey
      ) {
        return { outcome: "source_ineligible" } as const;
      }

      const envelope =
        sourceRow.envelope as unknown as PersistentWriteEnvelope;
      const causedBy = envelope.provenance.causedBy?.trim();
      if (!causedBy) {
        return { outcome: "source_ineligible" } as const;
      }

      const thought = topicResurfaceToThought({
        userId: input.userId,
        subjectId: input.subjectId,
        source: {
          stateId: sourceRow.id,
          threadKey: topic.threadKey,
          visibility: envelope.scope.visibility,
          sensitivity: envelope.scope.sensitivity,
          audience: [...envelope.scope.audience],
          causedBy,
        },
        text: input.text,
        evaluatedAt: input.evaluatedAt,
        config: input.config,
      });

      await transaction.insert(runtimeSubjectStates).values({
        id: thought.id,
        userId: input.userId,
        subjectId: input.subjectId,
        kind: thought.kind,
        text: thought.text ?? null,
        payload: thought.payload ?? null,
        scopeApplicability: thought.envelope.scope.applicability,
        scopeConversationId:
          thought.envelope.scope.conversationId ?? null,
        scopePathHeadMessageId:
          thought.envelope.scope.pathHeadMessageId ?? null,
        settlementStatus:
          thought.envelope.status.settlementStatus,
        pathStatus: thought.envelope.status.pathStatus,
        validityStatus: thought.envelope.status.validityStatus,
        envelope:
          thought.envelope as unknown as Record<string, unknown>,
      });

      return {
        outcome: "materialized",
        stateId: thought.id,
      } as const;
    });
  }
}
