import type {
  NativeLiveConversation,
  NativeLiveContentBlockInput,
} from "../conversation/native-live-conversation-types.js";
import {
  assembleTurnContext,
  assembledTurnContextFromManifest,
  type AssembledTurnContext,
} from "./context-assembler.js";
import type { InitialContextManifest } from "./context-assembly-contract.js";
import {
  normalizeContextLineageState,
  type ContextLineageState,
} from "./context-lineage.js";
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
import {
  semanticCandidatesFromStates,
  type BreathSemanticCandidate,
  type BreathSemanticScorer,
} from "./breath-semantic-recall.js";
import {
  breathLexicalScore,
  filterBreathEligibleStates,
} from "./breath-recall.js";
import { canonicalPathToHead } from "./surface-projector.js";
import { expandCausalStateReferences } from "./persistent-reference-scan.js";
import { readThoughtLifecycle, writeThoughtActive } from "./thought.js";
import {
  readSubjectStateLifecycle,
  type MemoryLifecyclePolicy,
} from "./memory-lifecycle.js";

export type SubjectStateTransition = {
  stateId: string;
  stateKind: SubjectStateWrite["kind"];
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
    sourceConversationId?: string;
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

  loadContextManifest?(input: {
    userId: string;
    subjectId: string;
    manifestId: string;
  }): Promise<InitialContextManifest | null>;

  recordBreathRecall?(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    contextEpoch: number;
    stateIds: readonly string[];
    recalledAt: string;
    salienceBoost: number;
    sourceMessageId: string;
    lifecyclePolicy?: MemoryLifecyclePolicy;
  }): Promise<void>;
}

export type MindLoopConfig = {
  assemblyVersion: string;
  promptContractVersion: string;
  contextTimeZone?: string;
  ruleVersion: string;
  processVersion: string;
  breathLimit: number;
  breathCooldownHours?: number;
  breathSalienceWeight?: number;
  breathRecallSalienceBoost?: number;
  memoryLifecyclePolicy?: MemoryLifecyclePolicy;
  breathSemanticWeight?: number;
  breathSemanticMinScore?: number;
  breathMinimumScore?: number;
  breathSemanticMedianMargin?: number;
  breathRecentRecallPenalty?: boolean;
  breathDiversityMaxTokenOverlap?: number;
  breathSemanticCandidateLimit?: number;
  breathSemanticCandidateMaxChars?: number;
  thoughtLimit?: number;
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
 * It does not decide Decay policy and does not perform external effects.
 */
export class NativeLiveMindLoopService {
  constructor(
    private readonly port: SubjectStateRuntimePort,
    private readonly config: MindLoopConfig,
    private readonly semanticScorer: BreathSemanticScorer | null = null,
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
          stateKind: state.kind,
          reason: decision.reason,
          settlementStatus: "settled",
          pathStatus: "current",
          validityStatus: "valid",
          promoteScopeToGlobal: true,
        });
      } else if (decision.action === "invalidate") {
        transitions.push({
          stateId: state.id,
          stateKind: state.kind,
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
    userMessageCreatedAt?: string;
    snapshotSequence: number;
    assembledAt: string;
    surfaceHeadMessageId?: string | null;
    semanticScores?: ReadonlyMap<string, number>;
    semanticCandidates?: readonly BreathSemanticCandidate[];
    excludedReferenceIds?: ReadonlySet<string>;
    contextLineage?: ContextLineageState | null;
  }): Promise<AssembledTurnContext> {
    if (this.port.loadContextManifest) {
      const persisted = await this.port.loadContextManifest({
        userId: input.userId,
        subjectId: input.subjectId,
        manifestId: input.manifestId,
      });
      if (persisted) {
        const expectedHead =
          input.surfaceHeadMessageId === undefined
            ? input.conversation.currentHeadMessageId
            : input.surfaceHeadMessageId;
        const persistedUser = persisted.items.find(
          (item) => item.type === "user_message",
        );
        if (
          persisted.conversationId !== input.conversation.id
          || persisted.pathHeadMessageId !== expectedHead
          || persisted.snapshotSequence !== input.snapshotSequence
          || persisted.assemblyVersion !== this.config.assemblyVersion
          || persisted.promptContractVersion
            !== this.config.promptContractVersion
          || persistedUser?.sourceId !== input.userMessageId
          || persistedUser?.text !== input.userText
        ) {
          throw new Error(
            "Persisted Context Manifest conflicts with the requested turn snapshot.",
          );
        }
        return assembledTurnContextFromManifest(persisted);
      }
    }

    const listedStates = await this.port.list({
      userId: input.userId,
      subjectId: input.subjectId,
      conversationId: input.conversation.id,
    });
    const states = excludeCausalStates(
      listedStates,
      input.excludedReferenceIds,
    );
    const contextLineage = normalizeContextLineageState(
      input.contextLineage,
    );
    const seenStateIds = new Set(contextLineage.seenStateIds);

    const configuredSemanticWeight =
      this.config.breathSemanticWeight ?? 0;
    let effectiveSemanticWeight = 0;
    let semanticScores: ReadonlyMap<string, number> | undefined;
    const semanticPlan = input.semanticCandidates
      ? {
          query: input.userText,
          candidates: [...input.semanticCandidates],
        }
      : this.semanticPlanFromStates({
          ...input,
          states,
          excludedStateIds: seenStateIds,
          contextEpoch: contextLineage.epoch,
        });

    if (
      semanticPlan
      && input.semanticScores
      && this.semanticSnapshotStillCurrent({
        userId: input.userId,
        subjectId: input.subjectId,
        conversation: input.conversation,
        userText: input.userText,
        assembledAt: input.assembledAt,
        surfaceHeadMessageId: input.surfaceHeadMessageId,
        states,
        candidates: semanticPlan.candidates,
        excludedStateIds: seenStateIds,
        contextEpoch: contextLineage.epoch,
      })
      && hasCompleteSemanticScores(
        input.semanticScores,
        semanticPlan.candidates,
      )
    ) {
      semanticScores = input.semanticScores;
      effectiveSemanticWeight = configuredSemanticWeight;
    } else if (
      semanticPlan
      && this.semanticScorer
      && configuredSemanticWeight > 0
    ) {
      try {
        const scored = await this.semanticScorer.score({
          query: semanticPlan.query,
          candidates: semanticPlan.candidates,
        });
        if (hasCompleteSemanticScores(scored, semanticPlan.candidates)) {
          semanticScores = scored;
          effectiveSemanticWeight = configuredSemanticWeight;
        }
      } catch {
        // Semantic recall is optional and non-authoritative. A provider
        // failure must restore pure lexical scoring rather than attenuating
        // lexical hits with a missing semantic channel.
      }
    }

    const assembled = assembleTurnContext({
      manifestId: input.manifestId,
      userId: input.userId,
      subjectId: input.subjectId,
      conversation: input.conversation,
      userMessageId: input.userMessageId,
      userText: input.userText,
      userMessageCreatedAt: input.userMessageCreatedAt,
      contextTimeZone: this.config.contextTimeZone,
      subjectStates: states,
      snapshotSequence: input.snapshotSequence,
      assembledAt: input.assembledAt,
      assemblyVersion: this.config.assemblyVersion,
      promptContractVersion: this.config.promptContractVersion,
      breathLimit: this.config.breathLimit,
      breathCooldownHours: this.config.breathCooldownHours ?? 0,
      breathSalienceWeight: this.config.breathSalienceWeight ?? 0,
      breathSemanticWeight: effectiveSemanticWeight,
      breathSemanticMinScore: this.config.breathSemanticMinScore ?? 0,
      breathSemanticScores: semanticScores,
      breathMinimumScore: this.config.breathMinimumScore ?? 0,
      breathSemanticMedianMargin:
        this.config.breathSemanticMedianMargin ?? 0,
      breathRecentRecallPenalty:
        this.config.breathRecentRecallPenalty ?? false,
      breathDiversityMaxTokenOverlap:
        this.config.breathDiversityMaxTokenOverlap ?? 1,
      thoughtLimit: this.config.thoughtLimit ?? 0,
      maxContextItems: this.config.maxContextItems,
      maxContextChars: this.config.maxContextChars,
      surfaceHeadMessageId: input.surfaceHeadMessageId,
      contextLineage,
    });

    await this.port.saveContextManifest({ manifest: assembled.manifest });

    return assembled;
  }

  async recordFinalizedBreathRecall(input: {
    userId: string;
    subjectId: string;
    manifestId: string;
  }): Promise<string[]> {
    if (!this.port.loadContextManifest || !this.port.recordBreathRecall) {
      return [];
    }
    const manifest = await this.port.loadContextManifest({
      userId: input.userId,
      subjectId: input.subjectId,
      manifestId: input.manifestId,
    });
    if (!manifest) return [];

    const userItems = manifest.items.filter(
      (item) => item.type === "user_message",
    );
    if (
      userItems.length !== 1
      || !userItems[0]?.sourceId
    ) {
      throw new Error(
        "Finalized Breath recall requires one canonical user source.",
      );
    }

    const stateIds = manifest.items
      .filter((item) => item.selection.reason.startsWith("breath_"))
      .map((item) => item.sourceId);
    if (stateIds.length === 0) return [];

    await this.port.recordBreathRecall({
      userId: input.userId,
      subjectId: input.subjectId,
      conversationId: manifest.conversationId,
      contextEpoch: manifest.lineage?.epoch ?? 0,
      stateIds,
      recalledAt: manifest.createdAt,
      salienceBoost: this.config.breathRecallSalienceBoost ?? 0,
      sourceMessageId: userItems[0].sourceId,
      ...(this.config.memoryLifecyclePolicy
        ? { lifecyclePolicy: this.config.memoryLifecyclePolicy }
        : {}),
    });
    return stateIds;
  }

  async planSemanticRecall(input: {
    userId: string;
    subjectId: string;
    conversation: NativeLiveConversation;
    userText: string;
    assembledAt: string;
    surfaceHeadMessageId?: string | null;
    excludedReferenceIds?: ReadonlySet<string>;
    contextLineage?: ContextLineageState | null;
  }): Promise<{
    query: string;
    candidates: BreathSemanticCandidate[];
  } | null> {
    if ((this.config.breathSemanticWeight ?? 0) <= 0) return null;

    const listedStates = await this.port.list({
      userId: input.userId,
      subjectId: input.subjectId,
      conversationId: input.conversation.id,
    });
    const states = excludeCausalStates(
      listedStates,
      input.excludedReferenceIds,
    );
    const contextLineage = normalizeContextLineageState(
      input.contextLineage,
    );

    return this.semanticPlanFromStates({
      ...input,
      states,
      excludedStateIds: new Set(contextLineage.seenStateIds),
      contextEpoch: contextLineage.epoch,
    });
  }

  private semanticSnapshotStillCurrent(input: {
    userId: string;
    subjectId: string;
    conversation: NativeLiveConversation;
    userText: string;
    assembledAt: string;
    surfaceHeadMessageId?: string | null;
    states: readonly SubjectStateWrite[];
    candidates: readonly BreathSemanticCandidate[];
    excludedStateIds?: ReadonlySet<string>;
    contextEpoch?: number;
  }): boolean {
    const current = this.semanticCandidatesFromStates({
      userId: input.userId,
      subjectId: input.subjectId,
      conversation: input.conversation,
      userText: input.userText,
      assembledAt: input.assembledAt,
      surfaceHeadMessageId: input.surfaceHeadMessageId,
      states: input.states,
      excludedStateIds: input.excludedStateIds,
      contextEpoch: input.contextEpoch,
      applyLimit: true,
    });
    if (current.length !== input.candidates.length) return false;

    return input.candidates.every((candidate, index) => {
      const actual = current[index];
      return (
        actual?.stateId === candidate.stateId
        && actual.kind === candidate.kind
        && actual.text === candidate.text
      );
    });
  }

  private semanticPlanFromStates(input: {
    userId: string;
    subjectId: string;
    conversation: NativeLiveConversation;
    userText: string;
    assembledAt: string;
    surfaceHeadMessageId?: string | null;
    states: readonly SubjectStateWrite[];
    excludedStateIds?: ReadonlySet<string>;
    contextEpoch?: number;
  }): {
    query: string;
    candidates: BreathSemanticCandidate[];
  } | null {
    if ((this.config.breathSemanticWeight ?? 0) <= 0) return null;

    const candidates = this.semanticCandidatesFromStates({
      ...input,
      applyLimit: true,
    });

    if (candidates.length === 0) return null;
    return {
      query: input.userText,
      candidates,
    };
  }

  private semanticCandidatesFromStates(input: {
    userId: string;
    subjectId: string;
    conversation: NativeLiveConversation;
    userText?: string;
    assembledAt: string;
    surfaceHeadMessageId?: string | null;
    states: readonly SubjectStateWrite[];
    excludedStateIds?: ReadonlySet<string>;
    contextEpoch?: number;
    applyLimit: boolean;
  }): BreathSemanticCandidate[] {
    const surfaceHeadMessageId =
      input.surfaceHeadMessageId === undefined
        ? input.conversation.currentHeadMessageId
        : input.surfaceHeadMessageId;
    const currentPathMessageIds = new Set(
      canonicalPathToHead(
        input.conversation,
        surfaceHeadMessageId,
      ).map((message) => message.id),
    );
    const candidateLimit =
      this.config.breathSemanticCandidateLimit ?? 64;
    if (!Number.isInteger(candidateLimit) || candidateLimit < 1) {
      throw new Error(
        "Breath semantic candidate limit must be a positive integer.",
      );
    }

    const candidateMaxChars =
      this.config.breathSemanticCandidateMaxChars ?? 2_000;
    if (
      !Number.isInteger(candidateMaxChars)
      || candidateMaxChars < 1
    ) {
      throw new Error(
        "Breath semantic candidate max chars must be a positive integer.",
      );
    }

    const eligibleStates = filterBreathEligibleStates(
      input.states,
      {
        userId: input.userId,
        subjectId: input.subjectId,
        conversationId: input.conversation.id,
        currentPathMessageIds,
        excludedStateIds: input.excludedStateIds,
        contextEpoch: input.contextEpoch,
        now: input.assembledAt,
        cooldownHours: this.config.breathCooldownHours ?? 0,
      },
    );
    const stateById = new Map(
      eligibleStates.map((state) => [state.id, state] as const),
    );
    const originalOrder = new Map(
      input.states.map((state, index) => [state.id, index] as const),
    );

    const ranked = semanticCandidatesFromStates(eligibleStates)
      .map((candidate) => ({
        ...candidate,
        lexicalScore: input.userText
          ? breathLexicalScore(input.userText, candidate.text)
          : 0,
        salience:
          readSubjectStateLifecycle(
            stateById.get(candidate.stateId)?.payload,
          )?.salience ?? 1,
        originalIndex: originalOrder.get(candidate.stateId) ?? -1,
        text: candidate.text.slice(0, candidateMaxChars),
      }));

    const priorityCompare = (
      left: (typeof ranked)[number],
      right: (typeof ranked)[number],
    ) =>
      right.lexicalScore - left.lexicalScore
      || right.salience - left.salience
      || right.originalIndex - left.originalIndex
      || left.stateId.localeCompare(right.stateId);

    const priority = [...ranked].sort(priorityCompare);
    if (!input.applyLimit || priority.length <= candidateLimit) {
      return priority.map((candidate) => ({
        stateId: candidate.stateId,
        kind: candidate.kind,
        text: candidate.text,
      }));
    }

    // Keep E5 cost bounded while preventing lexical preselection from owning
    // the entire semantic candidate pool. Half the budget is reserved for
    // lexical evidence; the rest mixes lifecycle/recency with an even spread
    // across the remaining history so older paraphrases still get a chance.
    const selected: typeof ranked = [];
    const selectedIds = new Set<string>();
    const add = (candidate: (typeof ranked)[number] | undefined) => {
      if (!candidate || selectedIds.has(candidate.stateId)) return;
      selectedIds.add(candidate.stateId);
      selected.push(candidate);
    };

    const lexicalBudget = Math.ceil(candidateLimit / 2);
    for (const candidate of priority) {
      if (candidate.lexicalScore <= 0 || selected.length >= lexicalBudget) {
        break;
      }
      add(candidate);
    }

    let remainingSlots = candidateLimit - selected.length;
    const lifecycleBudget = Math.floor(remainingSlots / 2);
    const lifecycle = priority
      .filter((candidate) => !selectedIds.has(candidate.stateId))
      .sort((left, right) =>
        right.salience - left.salience
        || right.originalIndex - left.originalIndex
        || left.stateId.localeCompare(right.stateId)
      );
    for (const candidate of lifecycle.slice(0, lifecycleBudget)) {
      add(candidate);
    }

    remainingSlots = candidateLimit - selected.length;
    const coverage = ranked
      .filter((candidate) => !selectedIds.has(candidate.stateId))
      .sort((left, right) =>
        left.originalIndex - right.originalIndex
        || left.stateId.localeCompare(right.stateId)
      );
    if (remainingSlots > 0 && coverage.length > 0) {
      const take = Math.min(remainingSlots, coverage.length);
      for (let index = 0; index < take; index += 1) {
        const coverageIndex = Math.min(
          coverage.length - 1,
          Math.floor(((index + 0.5) * coverage.length) / take),
        );
        add(coverage[coverageIndex]);
      }
    }

    if (selected.length < candidateLimit) {
      for (const candidate of priority) {
        add(candidate);
        if (selected.length >= candidateLimit) break;
      }
    }

    return selected
      .sort(priorityCompare)
      .map((candidate) => ({
        stateId: candidate.stateId,
        kind: candidate.kind,
        text: candidate.text,
      }));
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
    sourceOccurredAt: string;
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
      sourceOccurredAt: input.sourceOccurredAt,
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
        sourceConversationId: input.conversationId,
      });
    }
    return states;
  }

  async finalizeAssistantBlocks(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    assistantMessageId: string;
    sourceOccurredAt: string;
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

function hasCompleteSemanticScores(
  scores: ReadonlyMap<string, number>,
  candidates: readonly BreathSemanticCandidate[],
): boolean {
  return candidates.every((candidate) => {
    const score = scores.get(candidate.stateId);
    return (
      typeof score === "number"
      && Number.isFinite(score)
      && score >= 0
      && score <= 1
    );
  });
}


/**
 * Context for a Retry/Edit must match what the replaced turn saw. States that
 * only exist because of the replaced messages are removed, and a thought that
 * one of those messages dropped is treated as still active. (The stored drop is
 * undone for real when the replacement finalizes; this keeps the model from
 * seeing the world after the very turn it is redoing.)
 */
function excludeCausalStates(
  states: readonly SubjectStateWrite[],
  excludedReferenceIds: ReadonlySet<string> | undefined,
): SubjectStateWrite[] {
  if (!excludedReferenceIds || excludedReferenceIds.size === 0) {
    return [...states];
  }
  // A thought's own payload names the message that dropped it. That is not
  // a reason to hide the thought, so only its envelope is scanned; a thought
  // written by a replaced turn is still caught through its provenance.
  const excludedStateIds = expandCausalStateReferences({
    states: states.map((state) =>
      state.kind === "thought" ? { ...state, payload: null } : state
    ),
    rootIds: excludedReferenceIds,
  });
  return states
    .filter((state) => !excludedStateIds.has(state.id))
    .map((state) => {
      if (state.kind !== "thought") return state;
      const lifecycle = readThoughtLifecycle(state.payload);
      return lifecycle?.status === "dropped"
        && lifecycle.reason === "subject"
        && lifecycle.droppedByMessageId !== null
        && excludedReferenceIds.has(lifecycle.droppedByMessageId)
        ? { ...state, payload: writeThoughtActive(state.payload) }
        : state;
    });
}
