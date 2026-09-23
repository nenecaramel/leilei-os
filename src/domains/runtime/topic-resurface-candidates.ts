import {
  readTopicEvolution,
  type TopicEvolutionState,
} from "./topic-evolution.js";

export type TopicResurfaceCandidateRow = {
  stateId: string;
  text: string;
  payload: Record<string, unknown> | null;
};

export type TopicResurfaceCandidate = {
  stateId: string;
  text: string;
  threadKey: string;
  reinforcementCount: number;
  lastReinforcedAt: string;
  dormantAt: string;
};

export interface TopicResurfaceCandidatePort {
  listDormantAnchors(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<TopicResurfaceCandidateRow[]>;
}

export type TopicResurfaceCandidateResult = {
  candidates: TopicResurfaceCandidate[];
};

export class TopicResurfaceCandidateService {
  constructor(
    private readonly port: TopicResurfaceCandidatePort,
  ) {}

  async list(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<TopicResurfaceCandidateResult> {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new Error(
        "Topic resurface candidate limit must be a positive integer.",
      );
    }

    const rows = await this.port.listDormantAnchors(input);
    const candidates = rows.flatMap((row) => {
      const text = row.text.normalize("NFC").trim();
      if (!text) return [];

      const evolution = safeReadTopicEvolution(row.payload);
      if (
        !evolution
        || evolution.phase !== "dormant"
        || evolution.role !== "anchor"
        || evolution.dormantAt === null
      ) {
        return [];
      }

      return [{
        stateId: row.stateId,
        text,
        threadKey: evolution.threadKey,
        reinforcementCount: evolution.reinforcementCount,
        lastReinforcedAt: evolution.lastReinforcedAt,
        dormantAt: evolution.dormantAt,
      }];
    });

    return { candidates };
  }
}

function safeReadTopicEvolution(
  payload: Record<string, unknown> | null | undefined,
): TopicEvolutionState | null {
  try {
    return readTopicEvolution(payload);
  } catch {
    return null;
  }
}
