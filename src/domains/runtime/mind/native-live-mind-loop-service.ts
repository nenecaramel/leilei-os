import type {
  NativeLiveConversation,
  NativeLiveContentBlockInput,
} from "../../conversation/native-live-conversation-types.js";
import {
  assembleTurnContext,
  assembledTurnContextFromManifest,
  type AssembledTurnContext,
} from "../context/context-assembler.js";
import type { InitialContextManifest } from "../context/context-assembly-contract.js";
import {
  normalizeContextLineageState,
  type ContextLineageState,
} from "../context/context-lineage.js";
import {
  materializeMindWrites,
  type MaterializeMindWritesInput,
} from "./mind-write-materializer.js";
import {
  parseMindWriteIntentsFromBlocks,
  type ParsedAssistantBlocks,
} from "./mind-block-parser.js";
import type { MindWriteIntent } from "./mind-intent-parser.js";
import { decideProvisionalSettlement } from "../subject-state/subject-state-settlement.js";
import type { SubjectStateWrite } from "../subject-state/subject-state-contract.js";
import type {
  SettlementStatus,
  ValidityStatus,
  PathStatus,
} from "../subject-state/runtime-status-axes.js";
import {
  semanticCandidatesFromStates,
  type BreathSemanticCandidate,
  type BreathSemanticScorer,
} from "../breath/breath-semantic-recall.js";
import {
  breathLexicalScore,
  filterBreathEligibleStates,
} from "../breath/breath-recall.js";
import { canonicalPathToHead } from "../shared/surface-projector.js";
import { mindSnapshotVersion, snapshotMemories } from "./mind-snapshot-version.js";
import { expandCausalStateReferences } from "../lifecycle/persistent-reference-scan.js";
import {
  readSubjectStateLifecycle,
  type MemoryLifecyclePolicy,
} from "../lifecycle/memory-lifecycle.js";

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
    globalOnly?: boolean;
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
    userInputMode?: "voice";
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
          || (persistedUser?.payload?.input_mode === "voice") !== (input.userInputMode === "voice")
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
    const assembled = await this.assembleRecallContext(input, states);

    await this.port.saveContextManifest({ manifest: assembled.manifest });

    return assembled;
  }

  /** Pure assembly: no manifest persistence or recall accounting. */
  async readOnlyRecall(input: Parameters<NativeLiveMindLoopService["prepareTurn"]>[0] & {
    semanticSnapshotVersion?: string;
    snapshotScores?: ReadonlyMap<string, number>;
  }): Promise<{
    assembled: AssembledTurnContext;
    semanticCandidates: BreathSemanticCandidate[];
    semanticMode: "snapshot_v1" | "legacy";
  }> {
    // Snapshot once; both the plan and rendering share the same eligibility view.
    const states = await this.port.list({
      userId: input.userId, subjectId: input.subjectId,
      conversationId: input.conversation.id, globalOnly: true,
    });
    const globalStates = states.filter(state => state.envelope.scope.applicability === "global");
    // Only the *same* server-sourced, current snapshot may rank memories.
    // Never let a local score grant access to an invalid/hidden/deleted row.
    const validIds = new Set(snapshotMemories(globalStates).map(memory => memory.stateId));
    const scores = input.snapshotScores;
    const verified = input.semanticSnapshotVersion !== undefined
      && /^[a-f0-9]{64}$/.test(input.semanticSnapshotVersion)
      && scores !== undefined && scores.size <= 48
      && mindSnapshotVersion(globalStates) === input.semanticSnapshotVersion
      && [...scores].every(([id, score]) => validIds.has(id)
        && Number.isFinite(score) && score >= 0 && score <= 1);
    if (verified) {
      const selectedStates = globalStates.filter(state => scores!.has(state.id) && validIds.has(state.id));
      return {
        assembled: await this.assembleRecallContext(input, selectedStates, scores!),
        semanticCandidates: [],
        semanticMode: "snapshot_v1",
      };
    }
    const lineage = normalizeContextLineageState(input.contextLineage);
    const plan = this.semanticPlanFromStates({
      ...input, states: globalStates,
      excludedStateIds: new Set(lineage.seenStateIds), contextEpoch: lineage.epoch,
    });
    return {
      assembled: await this.assembleRecallContext(input, globalStates),
      semanticCandidates: plan?.candidates ?? [],
      semanticMode: "legacy",
    };
  }

  private async assembleRecallContext(
    input: Parameters<NativeLiveMindLoopService["prepareTurn"]>[0],
    states: readonly SubjectStateWrite[],
    verifiedScores?: ReadonlyMap<string, number>,
  ): Promise<AssembledTurnContext> {
    const contextLineage = normalizeContextLineageState(
      input.contextLineage,
    );
    const seenStateIds = new Set(contextLineage.seenStateIds);

    const configuredSemanticWeight =
      verifiedScores !== undefined ? 1 : (this.config.breathSemanticWeight ?? 0);
    let effectiveSemanticWeight = verifiedScores !== undefined ? 1 : 0;
    let semanticScores: ReadonlyMap<string, number> | undefined = verifiedScores;
    const currentSemanticPlan = this.semanticPlanFromStates({
      ...input,
      states,
      excludedStateIds: seenStateIds,
      contextEpoch: contextLineage.epoch,
    });
    const suppliedSemanticPlan = input.semanticCandidates
      ? {
          query: input.userText,
          candidates: [...input.semanticCandidates],
        }
      : null;
    const suppliedSemanticPlanIsCurrent = Boolean(
      suppliedSemanticPlan
      && this.semanticSnapshotStillCurrent({
        userId: input.userId,
        subjectId: input.subjectId,
        conversation: input.conversation,
        userText: input.userText,
        assembledAt: input.assembledAt,
        surfaceHeadMessageId: input.surfaceHeadMessageId,
        states,
        candidates: suppliedSemanticPlan.candidates,
        excludedStateIds: seenStateIds,
        contextEpoch: contextLineage.epoch,
      }),
    );

    if (
      verifiedScores === undefined
      && suppliedSemanticPlan
      && suppliedSemanticPlanIsCurrent
      && input.semanticScores
      && hasCompleteSemanticScores(
        input.semanticScores,
        suppliedSemanticPlan.candidates,
      )
    ) {
      semanticScores = input.semanticScores;
      effectiveSemanticWeight = configuredSemanticWeight;
    } else if (
      verifiedScores === undefined
      && currentSemanticPlan
      && this.semanticScorer
      && configuredSemanticWeight > 0
    ) {
      try {
        const scored = await this.semanticScorer.score({
          query: currentSemanticPlan.query,
          candidates: currentSemanticPlan.candidates,
        });
        if (
          hasCompleteSemanticScores(
            scored,
            currentSemanticPlan.candidates,
          )
        ) {
          semanticScores = scored;
          effectiveSemanticWeight = configuredSemanticWeight;
        }
      } catch {
        // Semantic recall is optional and non-authoritative. A provider
        // failure must restore pure lexical scoring rather than attenuating
        // lexical hits with a missing semantic channel.
      }
    }

    return assembleTurnContext({
      manifestId: input.manifestId,
      userId: input.userId,
      subjectId: input.subjectId,
      conversation: input.conversation,
      userMessageId: input.userMessageId,
      userText: input.userText,
      userMessageCreatedAt: input.userMessageCreatedAt,
      userInputMode: input.userInputMode,
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
      breathSemanticMinScore: verifiedScores !== undefined ? 0.68 : (this.config.breathSemanticMinScore ?? 0),
      breathSemanticScores: semanticScores,
      breathMinimumScore: verifiedScores !== undefined ? 0.01 : (this.config.breathMinimumScore ?? 0),
      breathSemanticMedianMargin:
        verifiedScores !== undefined ? 0 : (this.config.breathSemanticMedianMargin ?? 0),
      breathRecentRecallPenalty:
        this.config.breathRecentRecallPenalty ?? false,
      breathDiversityMaxTokenOverlap:
        this.config.breathDiversityMaxTokenOverlap ?? 1,
      maxContextItems: this.config.maxContextItems,
      maxContextChars: this.config.maxContextChars,
      surfaceHeadMessageId: input.surfaceHeadMessageId,
      contextLineage,
    });
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
 * only exist because of the replaced messages are removed.
 */
function excludeCausalStates(
  states: readonly SubjectStateWrite[],
  excludedReferenceIds: ReadonlySet<string> | undefined,
): SubjectStateWrite[] {
  if (!excludedReferenceIds || excludedReferenceIds.size === 0) {
    return [...states];
  }
  const excludedStateIds = expandCausalStateReferences({states, rootIds: excludedReferenceIds});
  return states
    .filter((state) => !excludedStateIds.has(state.id));
}
