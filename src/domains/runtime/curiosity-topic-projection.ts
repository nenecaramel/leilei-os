import { createHash } from "node:crypto";
import type { SubjectStateWrite } from "./subject-state-contract.js";

export type CuriosityTopicSeedCandidate = {
  stateId: string;
  text: string;
  visibility: SubjectStateWrite["envelope"]["scope"]["visibility"];
  sensitivity: SubjectStateWrite["envelope"]["scope"]["sensitivity"];
  audience: string[];
  causedBy: string;
};

export interface CuriosityTopicProjectionRuntimePort {
  listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<CuriosityTopicSeedCandidate[]>;

  appendTopics(input: {
    userId: string;
    subjectId: string;
    topics: readonly SubjectStateWrite[];
  }): Promise<void>;
}

export type CuriosityTopicProjectionRunResult = {
  scanned: number;
  projected: number;
};

export class CuriosityTopicProjectionService {
  constructor(
    private readonly port: CuriosityTopicProjectionRuntimePort,
  ) {}

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
  }): Promise<CuriosityTopicProjectionRunResult> {
    normalizeIso(input.now, "now");
    const candidates = await this.port.listCandidates({
      userId: input.userId,
      subjectId: input.subjectId,
      limit: input.limit ?? 500,
    });
    const topics = candidates.map((candidate) =>
      curiosityToTopic({
        userId: input.userId,
        subjectId: input.subjectId,
        candidate,
      })
    );

    await this.port.appendTopics({
      userId: input.userId,
      subjectId: input.subjectId,
      topics,
    });

    return {
      scanned: candidates.length,
      projected: topics.length,
    };
  }
}

export function curiosityTopicStateId(curiosityStateId: string): string {
  if (!curiosityStateId.trim()) {
    throw new Error("Curiosity state id must not be blank.");
  }
  const digest = createHash("sha256")
    .update(
      "leileios:curiosity-topic-seed:v1:" + curiosityStateId,
      "utf8",
    )
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

export function curiosityToTopic(input: {
  userId: string;
  subjectId: string;
  candidate: CuriosityTopicSeedCandidate;
}): SubjectStateWrite {
  const text = input.candidate.text.trim();
  if (!text) {
    throw new Error("Curiosity topic seed text must not be blank.");
  }

  return {
    id: curiosityTopicStateId(input.candidate.stateId),
    kind: "topic",
    text,
    payload: {
      topic_seed_v1: {
        source_kind: "curiosity",
        source_state_id: input.candidate.stateId,
      },
    },
    envelope: {
      semanticActor: { kind: "subject", id: input.subjectId },
      producer: { kind: "process", id: "curiosity-topic-projection" },
      committer: { kind: "runtime", id: "leileios-runtime" },
      authority: "derived",
      scope: {
        userId: input.userId,
        subjectId: input.subjectId,
        applicability: "global",
        conversationId: null,
        pathHeadMessageId: null,
        visibility: input.candidate.visibility,
        sensitivity: input.candidate.sensitivity,
        audience: [...input.candidate.audience],
      },
      status: {
        generationStatus: "committed",
        presentationStatus: "presented",
        pathStatus: "current",
        settlementStatus: "settled",
        validityStatus: "valid",
      },
      provenance: {
        sources: [{
          kind: "persistent_state",
          id: input.candidate.stateId,
        }],
        causedBy: input.candidate.causedBy,
        derivedFrom: [input.candidate.stateId],
        decisionId: null,
        processRunId: null,
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "curiosity-topic-v1",
        processVersion: "curiosity-topic-projection-v1",
        model: null,
      },
    },
  };
}

function normalizeIso(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return new Date(parsed).toISOString();
}
