import type {
  NativeLiveConversation,
  NativeLiveContentBlockInput,
} from "../conversation/native-live-conversation-types.js";
import {
  assembleTurnContext,
  type AssembledTurnContext,
} from "./context-assembler.js";
import type { InitialContextManifest } from "./context-assembly-contract.js";
import {
  materializeMindWrites,
  type MaterializeMindWritesInput,
} from "./mind-write-materializer.js";
import {
  parseMindWriteIntentsFromBlocks,
  type ParsedAssistantBlocks,
} from "./mind-block-parser.js";
import type { MindWriteIntent } from "./mind-intent-parser.js";
import { decideProvisionalSettlement } from "./subject-state-settlement.js";
import type { SubjectStateWrite } from "./subject-state-contract.js";
import type {
  SettlementStatus,
  ValidityStatus,
  PathStatus,
} from "./runtime-status-axes.js";

export type SubjectStateTransition = {
  stateId: string;
  reason:
    | "user_continued_current_path"
    | "path_superseded";
  settlementStatus?: SettlementStatus;
  pathStatus?: PathStatus;
  validityStatus?: ValidityStatus;
  promoteScopeToGlobal?: boolean;
};

export interface SubjectStateRuntimePort {
  list(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
  }): Promise<SubjectStateWrite[]>;

  append(input: {
    userId: string;
    subjectId: string;
    states: SubjectStateWrite[];
  }): Promise<void>;

  transition(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    transitions: SubjectStateTransition[];
  }): Promise<void>;

  saveContextManifest(input: {
    manifest: InitialContextManifest;
  }): Promise<void>;

  recordBreathRecall?(input: {
    userId: string;
    subjectId: string;
    stateIds: readonly string[];
    recalledAt: string;
  }): Promise<void>;
}

export type MindLoopConfig = {
  assemblyVersion: string;
  promptContractVersion: string;
  ruleVersion: string;
  processVersion: string;
  surfaceLimit: number;
  breathLimit: number;
  breathCooldownHours?: number;
  breathSalienceWeight?: number;
  maxContextItems: number;
  maxContextChars: number;
};

/**
 * V1 branch-safe Mind loop.
 *
 * This service deliberately owns only three things:
 * 1. reconcile provisional state against the selected canonical path;
 * 2. assemble and persist bounded context before a model invocation;
 * 3. convert explicit subject-authored Mind tags into provisional state.
 *
 * It does not decide Dream/Drive/Decay policy and does not perform external
 * effects.
 */
export class NativeLiveMindLoopService {
  constructor(
    private readonly port: SubjectStateRuntimePort,
    private readonly config: MindLoopConfig,
  ) {}

  async reconcilePath(input: {
    userId: string;
    subjectId: string;
    conversation: NativeLiveConversation;
  }): Promise<SubjectStateTransition[]> {
    const states = await this.port.list({
      userId: input.userId,
      subjectId: input.subjectId,
      conversationId: input.conversation.id,
    });

    const transitions: SubjectStateTransition[] = [];

    for (const state of states) {
      const decision = decideProvisionalSettlement(state, input.conversation);
      if (decision.action === "settle") {
        transitions.push({
          stateId: state.id,
          reason: decision.reason,
          settlementStatus: "settled",
          pathStatus: "current",
          validityStatus: "valid",
          promoteScopeToGlobal: true,
        });
      } else if (decision.action === "invalidate") {
        transitions.push({
          stateId: state.id,
          reason: decision.reason,
          pathStatus: "superseded",
          validityStatus: "invalidated",
        });
      }
    }

    if (transitions.length > 0) {
      await this.port.transition({
        userId: input.userId,
        subjectId: input.subjectId,
        conversationId: input.conversation.id,
        transitions,
      });
    }

    return transitions;
  }

  async prepareTurn(input: {
    manifestId: string;
    userId: string;
    subjectId: string;
    conversation: NativeLiveConversation;
    userMessageId: string;
    userText: string;
    snapshotSequence: number;
    assembledAt: string;
    surfaceHeadMessageId?: string | null;
  }): Promise<AssembledTurnContext> {
    const states = await this.port.list({
      userId: input.userId,
      subjectId: input.subjectId,
      conversationId: input.conversation.id,
    });

    const assembled = assembleTurnContext({
      manifestId: input.manifestId,
      userId: input.userId,
      subjectId: input.subjectId,
      conversation: input.conversation,
      userMessageId: input.userMessageId,
      userText: input.userText,
      subjectStates: states,
      snapshotSequence: input.snapshotSequence,
      assembledAt: input.assembledAt,
      assemblyVersion: this.config.assemblyVersion,
      promptContractVersion: this.config.promptContractVersion,
      surfaceLimit: this.config.surfaceLimit,
      breathLimit: this.config.breathLimit,
      breathCooldownHours: this.config.breathCooldownHours ?? 0,
      breathSalienceWeight: this.config.breathSalienceWeight ?? 0,
      maxContextItems: this.config.maxContextItems,
      maxContextChars: this.config.maxContextChars,
      surfaceHeadMessageId: input.surfaceHeadMessageId,
    });

    await this.port.saveContextManifest({ manifest: assembled.manifest });

    if (assembled.breathStateIds.length > 0 && this.port.recordBreathRecall) {
      try {
        await this.port.recordBreathRecall({
          userId: input.userId,
          subjectId: input.subjectId,
          stateIds: assembled.breathStateIds,
          recalledAt: input.assembledAt,
        });
      } catch {
        // Recall metadata is non-authoritative. A failed cooldown marker must
        // not block the foreground model invocation.
      }
    }

    return assembled;
  }

  parseAssistantBlocks(
    blocks: readonly NativeLiveContentBlockInput[],
  ): ParsedAssistantBlocks {
    return parseMindWriteIntentsFromBlocks(blocks);
  }

  async recordAssistantIntents(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    assistantMessageId: string;
    intents: readonly MindWriteIntent[];
    createStateId: () => string;
    producer: MaterializeMindWritesInput["producer"];
    committer: MaterializeMindWritesInput["committer"];
    sourceStatus: MaterializeMindWritesInput["sourceStatus"];
    visibility: MaterializeMindWritesInput["visibility"];
    sensitivity: MaterializeMindWritesInput["sensitivity"];
    audience: string[];
    model?: MaterializeMindWritesInput["model"];
  }): Promise<SubjectStateWrite[]> {
    const states = materializeMindWrites({
      userId: input.userId,
      subjectId: input.subjectId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      intents: input.intents,
      createId: input.createStateId,
      producer: input.producer,
      committer: input.committer,
      sourceStatus: input.sourceStatus,
      ruleVersion: this.config.ruleVersion,
      processVersion: this.config.processVersion,
      visibility: input.visibility,
      sensitivity: input.sensitivity,
      audience: input.audience,
      model: input.model,
    });

    if (states.length > 0) {
      await this.port.append({
        userId: input.userId,
        subjectId: input.subjectId,
        states,
      });
    }
    return states;
  }

  async finalizeAssistantBlocks(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    assistantMessageId: string;
    blocks: readonly NativeLiveContentBlockInput[];
    createStateId: () => string;
    producer: MaterializeMindWritesInput["producer"];
    committer: MaterializeMindWritesInput["committer"];
    sourceStatus: MaterializeMindWritesInput["sourceStatus"];
    visibility: MaterializeMindWritesInput["visibility"];
    sensitivity: MaterializeMindWritesInput["sensitivity"];
    audience: string[];
    model?: MaterializeMindWritesInput["model"];
  }): Promise<{
    visibleBlocks: NativeLiveContentBlockInput[];
    states: SubjectStateWrite[];
  }> {
    const parsed = this.parseAssistantBlocks(input.blocks);
    const states = await this.recordAssistantIntents({
      ...input,
      intents: parsed.intents,
    });

    return {
      visibleBlocks: parsed.visibleBlocks,
      states,
    };
  }

}
