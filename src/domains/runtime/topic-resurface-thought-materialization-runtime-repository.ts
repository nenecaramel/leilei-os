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
    return this.db.transaction(async (transaction) => {
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

      const evidenceSourceId =
        topic.reinforcementSources[topic.reinforcementSources.length - 1]?.trim();
      if (!evidenceSourceId) {
        return { outcome: "source_ineligible" } as const;
      }
      const stateId = topicResurfaceThoughtStateId(
        sourceRow.id,
        evidenceSourceId,
      );

      // Locking the source Topic serializes materialization for one evidence
      // generation. Re-check the deterministic target while holding that lock
      // so concurrent runs converge on exactly one derived Thought.
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

      const envelope =
        sourceRow.envelope as unknown as PersistentWriteEnvelope;

      const thought = topicResurfaceToThought({
        userId: input.userId,
        subjectId: input.subjectId,
        source: {
          stateId: sourceRow.id,
          threadKey: topic.threadKey,
          visibility: envelope.scope.visibility,
          sensitivity: envelope.scope.sensitivity,
          audience: [...envelope.scope.audience],
          evidenceSourceId,
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
