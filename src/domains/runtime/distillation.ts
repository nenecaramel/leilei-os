import { randomUUID } from "node:crypto";
import type {
  NativeLiveConversation,
  NativeLiveMessage,
} from "../conversation/native-live-conversation-types.js";
import { canonicalPathToHead } from "./surface-projector.js";
import {
  validateSubjectStateWrite,
  type SubjectStateWrite,
} from "./subject-state-contract.js";

export type DistillationTranscriptMessage = {
  messageId: string;
  role: "user" | "assistant";
  text: string;
};

export type DistillationWindow = {
  conversationId: string;
  sourceHeadMessageId: string;
  expectedPreviousWatermarkMessageId: string | null;
  resetFromSupersededWatermark: boolean;
  transcript: DistillationTranscriptMessage[];
};

export type DistillationMemoryDraft = {
  text: string;
};

export interface DistillationModel {
  distill(input: {
    conversationId: string;
    sourceHeadMessageId: string;
    transcript: readonly DistillationTranscriptMessage[];
  }): Promise<{ memories: readonly DistillationMemoryDraft[] }>;
}

export interface DistillationRuntimePort {
  getWatermark(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
  }): Promise<string | null>;

  commitSuccess(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    expectedPreviousWatermarkMessageId: string | null;
    nextWatermarkMessageId: string;
    states: readonly SubjectStateWrite[];
  }): Promise<"committed" | "conflict">;
}

export type DistillationConfig = {
  surfaceLimit: number;
  minSourceMessages?: number;
  maxMemoriesPerRun: number;
  ruleVersion: string;
  processVersion: string;
  model: {
    provider: string;
    model: string;
    configVersion?: string | null;
    promptContractVersion?: string | null;
  };
  processId?: string;
  committerId?: string;
  createRunId?: () => string;
  createStateId?: () => string;
};

export type DistillationRunResult =
  | { outcome: "idle" }
  | { outcome: "model_failed"; sourceHeadMessageId: string }
  | { outcome: "conflict"; sourceHeadMessageId: string }
  | {
      outcome: "committed";
      sourceHeadMessageId: string;
      createdStateIds: string[];
      resetFromSupersededWatermark: boolean;
    };

export class DistillationPlanningError extends Error {
  constructor(
    readonly code:
      | "INVALID_SURFACE_LIMIT"
      | "INVALID_BATCH_SIZE"
      | "INVALID_CANONICAL_TURN"
      | "UNSETTLED_SOURCE",
    message: string,
  ) {
    super(message);
    this.name = "DistillationPlanningError";
  }
}

function messageText(message: NativeLiveMessage): string {
  return message.blocks
    .filter((block) => block.kind === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Selects only complete, already-continued user/assistant turns that have
 * fallen outside the retained Surface window on the currently selected path.
 * Sibling branches are never candidates because canonicalPathToHead excludes
 * them before planning starts.
 */
export function planDistillationWindow(input: {
  conversation: NativeLiveConversation;
  surfaceLimit: number;
  minSourceMessages?: number;
  previousWatermarkMessageId: string | null;
}): DistillationWindow | null {
  if (!Number.isInteger(input.surfaceLimit) || input.surfaceLimit < 1) {
    throw new DistillationPlanningError(
      "INVALID_SURFACE_LIMIT",
      "Distillation surfaceLimit must be a positive integer.",
    );
  }
  const minSourceMessages =
    input.minSourceMessages ?? 2;
  if (
    !Number.isInteger(minSourceMessages)
    || minSourceMessages < 2
    || minSourceMessages % 2 !== 0
  ) {
    throw new DistillationPlanningError(
      "INVALID_BATCH_SIZE",
      "Distillation minSourceMessages must be an even integer of at least 2.",
    );
  }

  const path = canonicalPathToHead(input.conversation);
  if (path.length <= input.surfaceLimit) return null;

  const previousIndex = input.previousWatermarkMessageId
    ? path.findIndex((message) => message.id === input.previousWatermarkMessageId)
    : -1;
  const resetFromSupersededWatermark = Boolean(
    input.previousWatermarkMessageId && previousIndex < 0,
  );
  const startIndex = previousIndex >= 0 ? previousIndex + 1 : 0;
  const outsideSurfaceEndExclusive = path.length - input.surfaceLimit;

  let endIndex = -1;
  for (
    let index = outsideSurfaceEndExclusive - 1;
    index >= startIndex;
    index -= 1
  ) {
    const candidate = path[index];
    if (
      candidate?.role === "assistant"
      && path.slice(index + 1).some((message) => message.role === "user")
    ) {
      endIndex = index;
      break;
    }
  }

  if (endIndex < startIndex) return null;

  const source = path.slice(startIndex, endIndex + 1);
  if (
    source.length === 0
    || source[0]?.role !== "user"
    || source[source.length - 1]?.role !== "assistant"
    || source.some((message) => message.status !== "completed")
  ) {
    throw new DistillationPlanningError(
      "INVALID_CANONICAL_TURN",
      "Distillation source must contain complete canonical user/assistant turns.",
    );
  }

  for (let index = 0; index < source.length; index += 1) {
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    if (source[index]?.role !== expectedRole) {
      throw new DistillationPlanningError(
        "INVALID_CANONICAL_TURN",
        "Distillation source must alternate user and assistant messages.",
      );
    }
  }

  if (source.length < minSourceMessages) return null;

  const last = source[source.length - 1]!;
  if (!path.slice(endIndex + 1).some((message) => message.role === "user")) {
    throw new DistillationPlanningError(
      "UNSETTLED_SOURCE",
      "Distillation source requires later user continuation on the selected path.",
    );
  }

  return {
    conversationId: input.conversation.id,
    sourceHeadMessageId: last.id,
    expectedPreviousWatermarkMessageId: input.previousWatermarkMessageId,
    resetFromSupersededWatermark,
    transcript: source.map((message) => ({
      messageId: message.id,
      role: message.role as "user" | "assistant",
      text: messageText(message),
    })),
  };
}

function normalizeDrafts(
  drafts: readonly DistillationMemoryDraft[],
  limit: number,
): DistillationMemoryDraft[] {
  const seen = new Set<string>();
  const result: DistillationMemoryDraft[] = [];

  for (const draft of drafts) {
    const text = draft.text.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push({ text });
    if (result.length >= limit) break;
  }
  return result;
}

export async function commitDistillationDrafts(input: {
  port: DistillationRuntimePort;
  config: DistillationConfig;
  userId: string;
  subjectId: string;
  window: DistillationWindow;
  drafts: readonly DistillationMemoryDraft[];
  processRunId?: string;
}): Promise<DistillationRunResult> {
  if (
    !Number.isInteger(input.config.maxMemoriesPerRun)
    || input.config.maxMemoriesPerRun < 1
  ) {
    throw new Error("Distillation maxMemoriesPerRun must be a positive integer.");
  }

  const processId = input.config.processId ?? "distillation";
  const committerId = input.config.committerId ?? "leileios-runtime";
  const createRunId = input.config.createRunId ?? randomUUID;
  const createStateId = input.config.createStateId ?? randomUUID;
  const processRunId = input.processRunId ?? createRunId();
  const drafts = normalizeDrafts(
    input.drafts,
    input.config.maxMemoriesPerRun,
  );
  const states = drafts.map((draft) =>
    validateSubjectStateWrite({
      id: createStateId(),
      kind: "memory",
      text: draft.text,
      payload: {
        formation: "distillation",
        source_message_count: input.window.transcript.length,
      },
      envelope: {
        semanticActor: { kind: "process", id: processId },
        producer: {
          kind: "model",
          id: `${input.config.model.provider}:${input.config.model.model}`,
        },
        committer: { kind: "runtime", id: committerId },
        authority: "derived",
        scope: {
          userId: input.userId,
          subjectId: input.subjectId,
          applicability: "path",
          conversationId: input.window.conversationId,
          pathHeadMessageId: input.window.sourceHeadMessageId,
          visibility: "subject_private",
          sensitivity: "normal",
          audience: [input.subjectId],
        },
        status: {
          generationStatus: "committed",
          presentationStatus: "presented",
          pathStatus: "current",
          settlementStatus: "settled",
          validityStatus: "valid",
        },
        provenance: {
          sources: input.window.transcript.map((message) => ({
            kind: "message" as const,
            id: message.messageId,
          })),
          causedBy: input.window.sourceHeadMessageId,
          derivedFrom:
            input.window.transcript.map((message) => message.messageId),
          processRunId,
        },
        versions: {
          schemaVersion: 1,
          ruleVersion: input.config.ruleVersion,
          processVersion: input.config.processVersion,
          model: input.config.model,
        },
      },
    }),
  );

  const committed = await input.port.commitSuccess({
    userId: input.userId,
    subjectId: input.subjectId,
    conversationId: input.window.conversationId,
    expectedPreviousWatermarkMessageId:
      input.window.expectedPreviousWatermarkMessageId,
    nextWatermarkMessageId: input.window.sourceHeadMessageId,
    states,
  });

  if (committed === "conflict") {
    return {
      outcome: "conflict",
      sourceHeadMessageId: input.window.sourceHeadMessageId,
    };
  }

  return {
    outcome: "committed",
    sourceHeadMessageId: input.window.sourceHeadMessageId,
    createdStateIds: states.map((state) => state.id),
    resetFromSupersededWatermark:
      input.window.resetFromSupersededWatermark,
  };
}

export class DistillationService {
  constructor(
    private readonly port: DistillationRuntimePort,
    private readonly model: DistillationModel,
    private readonly config: DistillationConfig,
  ) {
    if (
      !Number.isInteger(config.maxMemoriesPerRun)
      || config.maxMemoriesPerRun < 1
    ) {
      throw new Error("Distillation maxMemoriesPerRun must be a positive integer.");
    }
  }

  async runOnce(input: {
    userId: string;
    subjectId: string;
    conversation: NativeLiveConversation;
  }): Promise<DistillationRunResult> {
    const previousWatermarkMessageId = await this.port.getWatermark({
      userId: input.userId,
      subjectId: input.subjectId,
      conversationId: input.conversation.id,
    });
    const window = planDistillationWindow({
      conversation: input.conversation,
      surfaceLimit: this.config.surfaceLimit,
      minSourceMessages: this.config.minSourceMessages,
      previousWatermarkMessageId,
    });
    if (!window) return { outcome: "idle" };

    let generated: { memories: readonly DistillationMemoryDraft[] };
    try {
      generated = await this.model.distill({
        conversationId: input.conversation.id,
        sourceHeadMessageId: window.sourceHeadMessageId,
        transcript: window.transcript,
      });
    } catch {
      return {
        outcome: "model_failed",
        sourceHeadMessageId: window.sourceHeadMessageId,
      };
    }

    return commitDistillationDrafts({
      port: this.port,
      config: this.config,
      userId: input.userId,
      subjectId: input.subjectId,
      window,
      drafts: generated.memories,
    });
  }
}
