import { and, asc, eq } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { runtimeSubjectStates } from "../../database/schema.js";
import type { PersistentWriteEnvelope } from "./persistent-write-envelope.js";
import { DrizzleSubjectStateRuntimePort } from "./subject-state-runtime-repository.js";
import type { SubjectStateWrite } from "./subject-state-contract.js";
import type {
  CuriosityTopicProjectionRuntimePort,
  CuriosityTopicSeedCandidate,
} from "./curiosity-topic-projection.js";

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleCuriosityTopicProjectionRuntimePort
implements CuriosityTopicProjectionRuntimePort {
  private readonly subjectStates: DrizzleSubjectStateRuntimePort;

  constructor(private readonly db: Database) {
    this.subjectStates = new DrizzleSubjectStateRuntimePort(db);
  }

  async listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<CuriosityTopicSeedCandidate[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new Error(
        "Curiosity topic projection candidate limit must be positive.",
      );
    }

    const rows = await this.db
      .select({
        id: runtimeSubjectStates.id,
        text: runtimeSubjectStates.text,
        envelope: runtimeSubjectStates.envelope,
      })
      .from(runtimeSubjectStates)
      .where(
        and(
          eq(runtimeSubjectStates.userId, input.userId),
          eq(runtimeSubjectStates.subjectId, input.subjectId),
          eq(runtimeSubjectStates.kind, "curiosity"),
          eq(runtimeSubjectStates.scopeApplicability, "global"),
          eq(runtimeSubjectStates.settlementStatus, "settled"),
          eq(runtimeSubjectStates.pathStatus, "current"),
          eq(runtimeSubjectStates.validityStatus, "valid"),
        ),
      )
      .orderBy(
        asc(runtimeSubjectStates.createdAt),
        asc(runtimeSubjectStates.id),
      )
      .limit(input.limit);

    return rows.flatMap((row) => {
      const text = row.text?.trim();
      if (!text) return [];
      const envelope =
        row.envelope as unknown as PersistentWriteEnvelope;
      const causedBy = envelope.provenance.causedBy?.trim();
      if (!causedBy) return [];

      return [{
        stateId: row.id,
        text,
        visibility: envelope.scope.visibility,
        sensitivity: envelope.scope.sensitivity,
        audience: [...envelope.scope.audience],
        causedBy,
      }];
    });
  }

  appendTopics(input: {
    userId: string;
    subjectId: string;
    topics: readonly SubjectStateWrite[];
  }): Promise<void> {
    return this.subjectStates.append({
      userId: input.userId,
      subjectId: input.subjectId,
      states: [...input.topics],
    });
  }
}
