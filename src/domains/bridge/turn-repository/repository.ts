import { DrizzleNativeLiveConversationRepository } from "../../conversation/native-live-conversation-repository.js";
import type {
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../../conversation/native-live-conversation-types.js";
import type {
  NativeLiveBackendTurnPort,
  NativeLiveFinalizeFailurePortResult,
  NativeLiveFinalizeSuccessPortResult,
  NativeLivePreparedTurn,
  NativeLivePreparePortResult,
} from "../native-live-backend-turn-coordinator.js";
import type { NativeLiveNormalizedEvent } from "../../conversation/native-live-conversation-orchestrator.js";
import type { NativeLiveExecutionSelection } from "../native-live-execution-selection.js";
import type {
  NativeLiveRuntimeFailureCode,
  NativeLiveRuntimeMetadata,
  NativeLiveRuntimeMode,
} from "../native-live-runtime-protocol.js";
import type { MemoryLifecyclePolicy } from "../../runtime/memory-lifecycle.js";
import type { NativeLiveRuntimeAttachment } from "../native-live-attachment-service.js";
import type { ReplacementPurgePlan } from "../native-live-replacement-purge.js";
import {
  prepareSend,
  prepareRetry,
  prepareEdit,
  persistMindPreparedPrompt,
  prepareWithRaceRecovery,
  resolveRuntimeParent,
  insertPreparation,
} from "./prepare.js";
import {
  getPreparation,
  readActiveTurn,
  readTurn,
  findByRequest,
  findById,
  loadFinalizedSuccess,
  selection,
} from "./reads.js";
import {
  finalizeSuccess,
  persistFinalizedContextLineage,
} from "./finalize-success.js";
import { finalizeFailure } from "./finalize-failure.js";
import {
  recoverStaleDeliveryUnknownTurn,
  purgeReplacementArtifacts,
} from "./cleanup.js";
import type { TurnRepositoryContext } from "./types.js";
import type {
  Database,
  NativeLiveBackendTurnReadModel,
  Transaction,
  PreparationRow,
  Executor,
} from "./types.js";

export class DrizzleNativeLiveBackendTurnPort
implements NativeLiveBackendTurnPort {
  constructor(
    private readonly db: Database,
    private readonly memoryLifecyclePolicy?: MemoryLifecyclePolicy,
  ) {}

  // Callbacks retain dispatch through this owner; this view stores no second state.
  private get context(): TurnRepositoryContext {
    return {
      db: this.db,
      memoryLifecyclePolicy: this.memoryLifecyclePolicy,
      prepareWithRaceRecovery: (...args: Parameters<typeof prepareWithRaceRecovery>) =>
        this.prepareWithRaceRecovery(...args),
      findByRequest: (...args: Parameters<typeof findByRequest>) =>
        this.findByRequest(...args),
      resolveRuntimeParent: (...args: Parameters<typeof resolveRuntimeParent>) =>
        this.resolveRuntimeParent(...args),
      insertPreparation: (...args: Parameters<typeof insertPreparation>) =>
        this.insertPreparation(...args),
      findById: (...args: Parameters<typeof findById>) =>
        this.findById(...args),
      readTurn: (...args: Parameters<typeof readTurn>) =>
        this.readTurn(...args),
      selection: (...args: Parameters<typeof selection>) =>
        this.selection(...args),
      loadFinalizedSuccess: (...args: Parameters<typeof loadFinalizedSuccess>) =>
        this.loadFinalizedSuccess(...args),
      persistFinalizedContextLineage: (...args: Parameters<typeof persistFinalizedContextLineage>) =>
        this.persistFinalizedContextLineage(...args),
      purgeReplacementArtifacts: (...args: Parameters<typeof purgeReplacementArtifacts>) =>
        this.purgeReplacementArtifacts(...args),
    };
  }

  prepareSend(input: {
    prepareId: string;
    userId: string;
    requestId: string;
    conversationId: string;
    expectedHeadMessageId: string | null;
    text: string;
    attachmentIds: readonly string[];
    workspaceId: string | null;
    executionSelection: NativeLiveExecutionSelection | null;
  }): Promise<NativeLivePreparePortResult> {
    return prepareSend.call(this.context, input);
  }

  prepareRetry(input: {
    prepareId: string;
    userId: string;
    requestId: string;
    conversationId: string;
    targetUserMessageId: string;
    executionSelection: NativeLiveExecutionSelection | null;
  }): Promise<NativeLivePreparePortResult> {
    return prepareRetry.call(this.context, input);
  }

  prepareEdit(input: {
    prepareId: string;
    userId: string;
    requestId: string;
    conversationId: string;
    targetUserMessageId: string;
    text: string;
    attachmentIds: readonly string[] | null;
    executionSelection: NativeLiveExecutionSelection | null;
  }): Promise<NativeLivePreparePortResult> {
    return prepareEdit.call(this.context, input);
  }

  getPreparation(input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLivePreparedTurn | null> {
    return getPreparation.call(this.context, input);
  }

  recoverStaleDeliveryUnknownTurn(input: {
    userId: string;
    prepareId: string;
  }): Promise<boolean> {
    return recoverStaleDeliveryUnknownTurn.call(this.context, input);
  }

  readActiveTurn(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveBackendTurnReadModel | null> {
    return readActiveTurn.call(this.context, input);
  }

  readTurn(input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLiveBackendTurnReadModel | null> {
    return readTurn.call(this.context, input);
  }

  persistMindPreparedPrompt(input: {
    userId: string;
    prepareId: string;
    prompt: string;
  }): Promise<NativeLivePreparedTurn> {
    return persistMindPreparedPrompt.call(this.context, input);
  }

  finalizeSuccess(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    providerSessionId: string;
    workspaceId: string | null;
    effectiveWorkspaceRoot: string | null;
    blocks: Parameters<NativeLiveBackendTurnPort["finalizeSuccess"]>[0]["blocks"];
    outputAttachmentIds: readonly string[];
    normalizedEvents: readonly NativeLiveNormalizedEvent[];
    runtimeMetadata: NativeLiveRuntimeMetadata | null;
    mindFollowUp:
      Parameters<NativeLiveBackendTurnPort["finalizeSuccess"]>[0]["mindFollowUp"];
  }): Promise<NativeLiveFinalizeSuccessPortResult> {
    return finalizeSuccess.call(this.context, input);
  }

  private persistFinalizedContextLineage(
    transaction: Transaction,
    row: PreparationRow,
    assistantMessageId: string,
    mindFollowUp: Parameters<
      NativeLiveBackendTurnPort["finalizeSuccess"]
    >[0]["mindFollowUp"],
  ): Promise<void> {
    return persistFinalizedContextLineage.call(this.context, transaction, row, assistantMessageId, mindFollowUp);
  }

  finalizeFailure(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    errorCode: NativeLiveRuntimeFailureCode | "RUNTIME_PROTOCOL_ERROR";
    runtimeMetadata: NativeLiveRuntimeMetadata | null;
  }): Promise<NativeLiveFinalizeFailurePortResult> {
    return finalizeFailure.call(this.context, input);
  }

  private purgeReplacementArtifacts(
    transaction: Transaction,
    row: PreparationRow,
    plan: ReplacementPurgePlan,
  ): Promise<void> {
    return purgeReplacementArtifacts.call(this.context, transaction, row, plan);
  }

  private prepareWithRaceRecovery(
    userId: string,
    requestId: string,
    requestHash: string,
    work: (transaction: Transaction) => Promise<NativeLivePreparePortResult>,
  ): Promise<NativeLivePreparePortResult> {
    return prepareWithRaceRecovery.call(this.context, userId, requestId, requestHash, work);
  }

  private resolveRuntimeParent(
    executor: Executor,
    conversations: DrizzleNativeLiveConversationRepository,
    userId: string,
    conversationId: string,
    parentMessageId: string | null,
    requestedWorkspaceId: string | null = null,
  ): Promise<
    | {
        ok: true;
        runtimeMode: NativeLiveRuntimeMode;
        parentProviderSessionId: string | null;
        workspaceId: string | null;
        expectedWorkspaceRoot: string | null;
      }
    | {
        ok: false;
        result: NativeLivePreparePortResult;
      }
  > {
    return resolveRuntimeParent.call(this.context, executor, conversations, userId, conversationId, parentMessageId, requestedWorkspaceId);
  }

  private insertPreparation(
    executor: Executor,
    input: {
      prepareId: string;
      userId: string;
      requestId: string;
      conversationId: string;
      operation: "send" | "retry" | "edit";
      requestHash: string;
      canonicalUserMessageId: string;
      replacementTargetUserMessageId: string | null;
      runtimeMode: "new" | "fork";
      parentProviderSessionId: string | null;
      workspaceId: string | null;
      expectedWorkspaceRoot: string | null;
      executionSelection: NativeLiveExecutionSelection | null;
      attachments: NativeLiveRuntimeAttachment[];
      prompt: string;
    },
  ): Promise<NativeLivePreparedTurn> {
    return insertPreparation.call(this.context, executor, input);
  }

  private findByRequest(
    executor: Executor,
    userId: string,
    requestId: string,
  ): Promise<PreparationRow | null> {
    return findByRequest.call(this.context, executor, userId, requestId);
  }

  private findById(
    executor: Executor,
    userId: string,
    prepareId: string,
    lock = false,
  ): Promise<PreparationRow | null> {
    return findById.call(this.context, executor, userId, prepareId, lock);
  }

  private loadFinalizedSuccess(
    transaction: Transaction,
    row: PreparationRow,
  ): Promise<{
    assistantMessage: NativeLiveMessage;
    checkpoint: NativeLiveProviderCheckpoint;
  }> {
    return loadFinalizedSuccess.call(this.context, transaction, row);
  }

  private selection() {
    return selection.call(this.context);
  }
}
