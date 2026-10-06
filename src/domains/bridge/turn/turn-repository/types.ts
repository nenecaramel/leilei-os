import type { createDatabase } from "../../../../database/client.js";
import { DrizzleNativeLiveConversationRepository } from "../../../conversation/native-live-conversation-repository.js";
import type {
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../../../conversation/native-live-conversation-types.js";
import type {
  NativeLiveBackendTurnPort,
  NativeLivePreparedTurn,
  NativeLivePreparePortResult,
} from "../native-live-backend-turn-coordinator.js";
import type { NativeLiveExecutionSelection } from "../native-live-execution-selection.js";
import type {
  NativeLiveRuntimeMetadata,
  NativeLiveRuntimeMode,
} from "../../protocol/native-live-runtime-protocol.js";
import type { MemoryLifecyclePolicy } from "../../../runtime/lifecycle/memory-lifecycle.js";
import type { NativeLiveRuntimeAttachment } from "../../attachment/native-live-attachment-service.js";
import type { ReplacementPurgePlan } from "../native-live-replacement-purge.js";
import type { selection } from "./reads.js";

export type Database = ReturnType<typeof createDatabase>["db"];

export type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;

export type Executor = Database | Transaction;

export type NativeLiveBackendTurnReadModel = {
  startedAt?: string;
  preparedUserMessage?: NativeLiveMessage;
  replacementTargetUserMessageId?: string | null;
  prepareId: string;
  requestId: string;
  conversationId: string;
  operation: "send" | "retry" | "edit" | "wake";
  canonicalUserMessageId: string | null;
  wakeContext?: Record<string, unknown> | null;
  expectedWorkingDirectory: string | null;
  executionSelection: NativeLiveExecutionSelection | null;
  canonicalStatus:
    | "prepared"
    | "finalized_success"
    | "finalized_failure";
  dispatchStatus:
    | "staged"
    | "pending"
    | "reserved"
    | "executing"
    | "delivery_unknown"
    | "completed"
    | "rejected";
  assistantMessage: NativeLiveMessage | null;
  runtimeMetadata: NativeLiveRuntimeMetadata | null;
  failureCode: string | null;
  semanticStatus:
    | "pending"
    | "reserved"
    | "completed"
    | "fallback"
    | null;
  semanticFallbackCode: string | null;
};

export type PreparationRow = {
  createdAt: Date;
  id: string;
  userId: string;
  requestId: string;
  conversationId: string;
  operation: "send" | "retry" | "edit" | "wake";
  requestHash: string;
  canonicalUserMessageId: string | null;
  replacementTargetUserMessageId: string | null;
  wakeContext: Record<string, unknown> | null;
  runtimeMode: "new" | "fork";
  parentProviderSessionId: string | null;
  expectedWorkingDirectory: string | null;
  executionSelection: Record<string, unknown> | null;
  attachments: Array<Record<string, unknown>>;
  prompt: string;
  mindPrepared: boolean;
  status: "prepared" | "finalized_success" | "finalized_failure";
  resultHash: string | null;
  providerSessionId: string | null;
  runtimeMetadata: Record<string, unknown> | null;
  assistantMessageId: string | null;
  failureCode: string | null;
};

// A dependency view of the sole repository owner; operations keep their own transactions.
export type TurnRepositoryContext = {
  readonly db: Database;
  readonly memoryLifecyclePolicy?: MemoryLifecyclePolicy;
  prepareWithRaceRecovery(
    userId: string,
    requestId: string,
    requestHash: string,
    work: (transaction: Transaction) => Promise<NativeLivePreparePortResult>,
  ): Promise<NativeLivePreparePortResult>;
  findByRequest(
    executor: Executor,
    userId: string,
    requestId: string,
  ): Promise<PreparationRow | null>;
  resolveRuntimeParent(
    executor: Executor,
    conversations: DrizzleNativeLiveConversationRepository,
    userId: string,
    conversationId: string,
    parentMessageId: string | null,
  ): Promise<
    | {
        ok: true;
        runtimeMode: NativeLiveRuntimeMode;
        parentProviderSessionId: string | null;
        expectedWorkingDirectory: string | null;
      }
    | {
        ok: false;
        result: NativeLivePreparePortResult;
      }
  >;
  insertPreparation(
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
      expectedWorkingDirectory: string | null;
      executionSelection: NativeLiveExecutionSelection | null;
      attachments: NativeLiveRuntimeAttachment[];
      prompt: string;
    },
  ): Promise<NativeLivePreparedTurn>;
  findById(
    executor: Executor,
    userId: string,
    prepareId: string,
    lock?: boolean,
  ): Promise<PreparationRow | null>;
  readTurn(input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLiveBackendTurnReadModel | null>;
  selection(): ReturnType<typeof selection>;
  loadFinalizedSuccess(
    transaction: Transaction,
    row: PreparationRow,
  ): Promise<{
    assistantMessage: NativeLiveMessage;
    checkpoint: NativeLiveProviderCheckpoint;
  }>;
  persistFinalizedContextLineage(
    transaction: Transaction,
    row: PreparationRow,
    assistantMessageId: string,
    mindFollowUp: Parameters<
      NativeLiveBackendTurnPort["finalizeSuccess"]
    >[0]["mindFollowUp"],
  ): Promise<void>;
  purgeReplacementArtifacts(
    transaction: Transaction,
    row: PreparationRow,
    plan: ReplacementPurgePlan,
  ): Promise<void>;
};
