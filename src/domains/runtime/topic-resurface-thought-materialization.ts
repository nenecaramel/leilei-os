import { createHash } from "node:crypto";
import type {
  SubjectStateWrite,
} from "./subject-state-contract.js";
import type {
  TopicResurfaceRetentionGateService,
  TopicResurfaceRetentionResult,
} from "./topic-resurface-retention-gate.js";

export type TopicResurfaceThoughtMaterializationModel =
  NonNullable<SubjectStateWrite["envelope"]["versions"]["model"]>;

export type TopicResurfaceThoughtMaterializationConfig = {
  ruleVersion: string;
  processVersion: string;
  deliberationPromptContractVersion: string;
  retentionPromptContractVersion: string;
  model: TopicResurfaceThoughtMaterializationModel;
  producerId?: string;
  committerId?: string;
};

export type TopicResurfaceThoughtSource = {
  stateId: string;
  threadKey: string;
  visibility: SubjectStateWrite["envelope"]["scope"]["visibility"];
  sensitivity: SubjectStateWrite["envelope"]["scope"]["sensitivity"];
  audience: string[];
  causedBy: string;
};

export type TopicResurfaceThoughtMaterializationPortResult =
  | { outcome: "materialized"; stateId: string }
  | { outcome: "already_materialized"; stateId: string }
  | { outcome: "source_ineligible" };

export interface TopicResurfaceThoughtMaterializationPort {
  materialize(input: {
    userId: string;
    subjectId: string;
    sourceTopicStateId: string;
    expectedThreadKey: string;
    text: string;
    evaluatedAt: string;
    config: TopicResurfaceThoughtMaterializationConfig;
  }): Promise<TopicResurfaceThoughtMaterializationPortResult>;
}

export type TopicResurfaceThoughtMaterializationResult =
  | Exclude<TopicResurfaceRetentionResult, { outcome: "thought_seed_candidate" }>
  | TopicResurfaceThoughtMaterializationPortResult
  | {
      outcome: "materialization_failed";
      sourceTopicStateId: string;
    };

type RetentionRunner = Pick<TopicResurfaceRetentionGateService, "runOnce">;

export class TopicResurfaceThoughtMaterializationService {
  constructor(
    private readonly retention: RetentionRunner,
    private readonly port: TopicResurfaceThoughtMaterializationPort,
    private readonly config: TopicResurfaceThoughtMaterializationConfig,
  ) {
    if (!config.ruleVersion.trim() || !config.processVersion.trim()) {
      throw new Error(
        "Topic resurface Thought materialization versions must not be blank.",
      );
    }
    if (
      !config.deliberationPromptContractVersion.trim()
      || !config.retentionPromptContractVersion.trim()
    ) {
      throw new Error(
        "Topic resurface Thought materialization prompt versions must not be blank.",
      );
    }
    if (
      !config.model.provider.trim()
      || !config.model.model.trim()
    ) {
      throw new Error(
        "Topic resurface Thought materialization requires model provenance.",
      );
    }
  }

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    candidateLimit: number;
  }): Promise<TopicResurfaceThoughtMaterializationResult> {
    const retained = await this.retention.runOnce(input);
    if (retained.outcome !== "thought_seed_candidate") {
      return retained;
    }

    try {
      return await this.port.materialize({
        userId: input.userId,
        subjectId: input.subjectId,
        sourceTopicStateId: retained.candidate.stateId,
        expectedThreadKey: retained.candidate.threadKey,
        text: retained.text,
        evaluatedAt: retained.evaluatedAt,
        config: this.config,
      });
    } catch {
      return {
        outcome: "materialization_failed",
        sourceTopicStateId: retained.candidate.stateId,
      };
    }
  }
}

export function topicResurfaceThoughtStateId(
  topicStateId: string,
): string {
  if (!topicStateId.trim()) {
    throw new Error("Topic state id must not be blank.");
  }
  const digest = createHash("sha256")
    .update(
      "leileios:topic-resurface-thought:v1:" + topicStateId,
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

export function topicResurfaceToThought(input: {
  userId: string;
  subjectId: string;
  source: TopicResurfaceThoughtSource;
  text: string;
  evaluatedAt: string;
  config: TopicResurfaceThoughtMaterializationConfig;
}): SubjectStateWrite {
  const text = input.text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (!text) {
    throw new Error(
      "Topic resurface Thought text must not be blank.",
    );
  }
  const evaluatedAt = normalizeIso(input.evaluatedAt, "evaluatedAt");

  return {
    id: topicResurfaceThoughtStateId(input.source.stateId),
    kind: "thought",
    text,
    payload: {
      thought_seed_v1: {
        source_kind: "topic_resurface",
        source_state_id: input.source.stateId,
        source_thread_key: input.source.threadKey,
        evaluated_at: evaluatedAt,
        deliberation_prompt_contract_version:
          input.config.deliberationPromptContractVersion,
        retention_prompt_contract_version:
          input.config.retentionPromptContractVersion,
      },
    },
    envelope: {
      semanticActor: { kind: "subject", id: input.subjectId },
      producer: {
        kind: "process",
        id: input.config.producerId
          ?? "topic-resurface-thought-materialization",
      },
      committer: {
        kind: "runtime",
        id: input.config.committerId ?? "leileios-runtime",
      },
      authority: "derived",
      scope: {
        userId: input.userId,
        subjectId: input.subjectId,
        applicability: "global",
        conversationId: null,
        pathHeadMessageId: null,
        visibility: input.source.visibility,
        sensitivity: input.source.sensitivity,
        audience: [...input.source.audience],
      },
      status: {
        generationStatus: "committed",
        presentationStatus: "not_presented",
        pathStatus: "current",
        settlementStatus: "settled",
        validityStatus: "valid",
      },
      provenance: {
        sources: [{
          kind: "persistent_state",
          id: input.source.stateId,
        }],
        causedBy: input.source.causedBy,
        derivedFrom: [input.source.stateId],
        decisionId: null,
        processRunId: null,
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: input.config.ruleVersion,
        processVersion: input.config.processVersion,
        model: input.config.model,
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
