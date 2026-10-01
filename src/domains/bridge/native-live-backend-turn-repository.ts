import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { enforceThoughtCapacity } from "../runtime/thought-runtime-repository.js";
import type { createDatabase } from "../../database/client.js";
import {
  conversationMessages,
  conversationProviderSessionCheckpoints,
  nativeLiveBackgroundModelJobs,
  nativeLiveProviderSessionCleanups,
  nativeLiveMindFollowUps,
  nativeLiveSemanticScoringRequests,
  nativeLiveTurnPreparations,
  workspaceConversations,
  workspaces,
  runtimeSubjectStates,
  runtimeContextManifests,
  runtimeContextLineageStates,
} from "../../database/schema.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../conversation/native-live-conversation-repository.js";
import type {
  NativeLiveConversation,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../conversation/native-live-conversation-types.js";
import type {
  NativeLiveBackendTurnPort,
  NativeLiveFinalizeFailurePortResult,
  NativeLiveFinalizeSuccessPortResult,
  NativeLivePreparedTurn,
  NativeLivePreparePortResult,
} from "./native-live-backend-turn-coordinator.js";
import type {
  NativeLiveNormalizedEvent,
} from "../conversation/native-live-conversation-orchestrator.js";
import {
  parseNativeLiveExecutionSelection,
  type NativeLiveExecutionSelection,
} from "./native-live-execution-selection.js";
import type {
  NativeLiveRuntimeFailureCode,
  NativeLiveRuntimeMetadata,
  NativeLiveRuntimeMode,
} from "./native-live-runtime-protocol.js";
import type { MemoryLifecyclePolicy } from "../runtime/memory-lifecycle.js";
import {
  DrizzleNativeLiveAttachmentBinding,
  type NativeLiveRuntimeAttachment,
} from "./native-live-attachment-service.js";
import {
  normalizeContextLineageState,
  parseContextLineageManifest,
} from "../runtime/context-lineage.js";
import { nativeLiveMindFollowUpStateId } from "./native-live-mind-state-id.js";
import {
  planCausalSubjectStatePurge,
  planExclusiveProviderSessionCleanup,
  planReplacementMessagePurge,
  planSubjectStateRepairs,
  workflowReferencesAnyId,
  type ReplacementPurgePlan,
} from "./native-live-replacement-purge.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;
type Executor = Database | Transaction;

export type NativeLiveBackendTurnReadModel = {
  prepareId: string;
  requestId: string;
  conversationId: string;
  operation: "send" | "retry" | "edit";
  canonicalUserMessageId: string;
  workspaceId: string | null;
  expectedWorkspaceRoot: string | null;
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

type PreparationRow = {
  id: string;
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

const REQUEST_HASH_VERSION = "leileios:native-live-turn-request:v1";
const RESULT_HASH_VERSION = "leileios:native-live-turn-result:v1";

function hashJson(version: string, value: unknown): string {
  return createHash("sha256")
    .update(`${version}\n${JSON.stringify(value)}`, "utf8")
    .digest("hex");
}

function mapPreparation(row: PreparationRow): NativeLivePreparedTurn {
  return {
    prepareId: row.id,
    requestId: row.requestId,
    userId: row.userId,
    conversationId: row.conversationId,
    operation: row.operation,
    canonicalUserMessageId: row.canonicalUserMessageId,
    replacementTargetUserMessageId: row.replacementTargetUserMessageId,
    runtimeMode: row.runtimeMode,
    parentProviderSessionId: row.parentProviderSessionId,
    workspaceId: row.workspaceId,
    expectedWorkspaceRoot: row.expectedWorkspaceRoot,
    executionSelection: row.executionSelection === null
      ? null
      : parseNativeLiveExecutionSelection(row.executionSelection),
    attachments: parseStoredAttachments(row.attachments),
    prompt: row.prompt,
    mindPrepared: row.mindPrepared,
  };
}

function readUserText(message: NativeLiveMessage): string | null {
  const text = message.blocks
    .filter((block) => block.kind === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function parseStoredAttachments(
  value: Array<Record<string, unknown>>,
): NativeLiveRuntimeAttachment[] {
  return value.map((item) => {
    const attachmentId = item.attachment_id;
    const filename = item.filename;
    const mimeType = item.mime_type;
    const sizeBytes = item.size_bytes;
    const sha256 = item.sha256;
    const kind = item.kind;
    if (
      typeof attachmentId !== "string"
      || typeof filename !== "string"
      || typeof mimeType !== "string"
      || typeof sizeBytes !== "number"
      || !Number.isSafeInteger(sizeBytes)
      || sizeBytes <= 0
      || typeof sha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(sha256)
      || (kind !== "image" && kind !== "file")
    ) {
      throw new Error(
        "Stored Native Live attachment descriptor is invalid.",
      );
    }
    return {
      attachment_id: attachmentId,
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      sha256,
      kind,
    };
  });
}

function requestConflictOrReplay(
  row: PreparationRow,
  requestHash: string,
): NativeLivePreparePortResult {
  if (row.requestHash !== requestHash) {
    return { ok: false, code: "REQUEST_CONFLICT" };
  }
  return {
    ok: true,
    outcome: "replayed",
    preparation: mapPreparation(row),
  };
}

export class DrizzleNativeLiveBackendTurnPort
implements NativeLiveBackendTurnPort {
  constructor(
    private readonly db: Database,
    private readonly memoryLifecyclePolicy?: MemoryLifecyclePolicy,
  ) {}

  async prepareSend(input: {
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
    const requestHash = hashJson(REQUEST_HASH_VERSION, {
      operation: "send",
      conversationId: input.conversationId,
      expectedHeadMessageId: input.expectedHeadMessageId,
      text: input.text,
      ...(input.attachmentIds.length > 0
        ? { attachmentIds: input.attachmentIds }
        : {}),
      ...(input.workspaceId
        ? { workspaceId: input.workspaceId }
        : {}),
      ...(input.executionSelection
        ? { executionSelection: input.executionSelection }
        : {}),
    });

    return this.prepareWithRaceRecovery(
      input.userId,
      input.requestId,
      requestHash,
      async (transaction) => {
        const existing = await this.findByRequest(
          transaction as Transaction,
          input.userId,
          input.requestId,
        );
        if (existing) return requestConflictOrReplay(existing, requestHash);

        const conversations =
          new DrizzleNativeLiveConversationRepository(
              transaction as Transaction,
            );
        const conversation = await conversations.getConversation({
          userId: input.userId,
          conversationId: input.conversationId,
        });
        if (
          !conversation
          || conversation.lifecycleStatus !== "active"
        ) {
          return { ok: false as const, code: "CONVERSATION_NOT_FOUND" as const };
        }
        if (
          conversation.currentHeadMessageId
          !== input.expectedHeadMessageId
        ) {
          return {
            ok: false as const,
            code: "STALE_HEAD" as const,
            currentHeadMessageId: conversation.currentHeadMessageId,
          };
        }

        const runtimeParent = await this.resolveRuntimeParent(
          transaction as Transaction,
          conversations,
          input.userId,
          input.conversationId,
          conversation.currentHeadMessageId,
          input.workspaceId,
        );
        if (!runtimeParent.ok) return runtimeParent.result;

        const userMessage = await conversations.appendUserMessage({
          userId: input.userId,
          conversationId: input.conversationId,
          parentMessageId: conversation.currentHeadMessageId,
        });
        if (input.text.length > 0) {
          await conversations.appendContentBlock({
            userId: input.userId,
            conversationId: input.conversationId,
            messageId: userMessage.id,
            ordinal: 0,
            block: {
              kind: "text",
              rawType: "text",
              text: input.text,
            },
          });
        }
        const attachmentBinding =
          new DrizzleNativeLiveAttachmentBinding(
            transaction as Transaction,
          );
        const attachments =
          await attachmentBinding.bindReadyToMessage({
            userId: input.userId,
            messageId: userMessage.id,
            attachmentIds: input.attachmentIds,
            startOrdinal:
              input.text.length > 0 ? 1 : 0,
          });

        const preparation = await this.insertPreparation(transaction, {
          prepareId: input.prepareId,
          userId: input.userId,
          requestId: input.requestId,
          conversationId: input.conversationId,
          operation: "send",
          requestHash,
          canonicalUserMessageId: userMessage.id,
          replacementTargetUserMessageId: null,
          runtimeMode: runtimeParent.runtimeMode,
          parentProviderSessionId: runtimeParent.parentProviderSessionId,
          workspaceId: runtimeParent.workspaceId,
          expectedWorkspaceRoot: runtimeParent.expectedWorkspaceRoot,
          executionSelection: input.executionSelection,
          attachments,
          prompt:
            input.text.length > 0
              ? input.text
              : "The user sent the attached file(s).",
        });

        return {
          ok: true as const,
          outcome: "created" as const,
          preparation,
        };
      },
    );
  }

  async prepareRetry(input: {
    prepareId: string;
    userId: string;
    requestId: string;
    conversationId: string;
    targetUserMessageId: string;
    executionSelection: NativeLiveExecutionSelection | null;
  }): Promise<NativeLivePreparePortResult> {
    const requestHash = hashJson(REQUEST_HASH_VERSION, {
      operation: "retry",
      conversationId: input.conversationId,
      targetUserMessageId: input.targetUserMessageId,
      ...(input.executionSelection
        ? { executionSelection: input.executionSelection }
        : {}),
    });

    return this.prepareWithRaceRecovery(
      input.userId,
      input.requestId,
      requestHash,
      async (transaction) => {
        const existing = await this.findByRequest(
          transaction as Transaction,
          input.userId,
          input.requestId,
        );
        if (existing) return requestConflictOrReplay(existing, requestHash);

        const conversations =
          new DrizzleNativeLiveConversationRepository(
              transaction as Transaction,
            );
        const conversation = await conversations.getConversation({
          userId: input.userId,
          conversationId: input.conversationId,
        });
        if (
          !conversation
          || conversation.lifecycleStatus !== "active"
        ) {
          return { ok: false as const, code: "CONVERSATION_NOT_FOUND" as const };
        }

        const target = conversation.messages.find(
          (message) =>
            message.id === input.targetUserMessageId
            && message.role === "user",
        );
        const attachmentBinding =
          new DrizzleNativeLiveAttachmentBinding(
            transaction as Transaction,
          );
        const attachments = target
          ? await attachmentBinding.readForMessage({
              userId: input.userId,
              messageId: target.id,
            })
          : [];
        const prompt = target
          ? (
              readUserText(target)
              ?? (
                attachments.length > 0
                  ? "The user sent the attached file(s)."
                  : null
              )
            )
          : null;
        const purgePlan = target
          ? planReplacementMessagePurge({
              operation: "retry",
              conversation,
              targetUserMessageId: target.id,
            })
          : null;
        if (!target || !prompt || !purgePlan) {
          return { ok: false as const, code: "BRANCH_POINT_INVALID" as const };
        }

        const runtimeParent = await this.resolveRuntimeParent(
          transaction as Transaction,
          conversations,
          input.userId,
          input.conversationId,
          target.parentMessageId,
        );
        if (!runtimeParent.ok) return runtimeParent.result;

        const preparation = await this.insertPreparation(transaction, {
          prepareId: input.prepareId,
          userId: input.userId,
          requestId: input.requestId,
          conversationId: input.conversationId,
          operation: "retry",
          requestHash,
          canonicalUserMessageId: target.id,
          replacementTargetUserMessageId: target.id,
          runtimeMode: runtimeParent.runtimeMode,
          parentProviderSessionId: runtimeParent.parentProviderSessionId,
          workspaceId: runtimeParent.workspaceId,
          expectedWorkspaceRoot: runtimeParent.expectedWorkspaceRoot,
          executionSelection: input.executionSelection,
          attachments,
          prompt,
        });

        return {
          ok: true as const,
          outcome: "created" as const,
          preparation,
        };
      },
    );
  }

  async prepareEdit(input: {
    prepareId: string;
    userId: string;
    requestId: string;
    conversationId: string;
    targetUserMessageId: string;
    text: string;
    attachmentIds: readonly string[] | null;
    executionSelection: NativeLiveExecutionSelection | null;
  }): Promise<NativeLivePreparePortResult> {
    const requestHash = hashJson(REQUEST_HASH_VERSION, {
      operation: "edit",
      conversationId: input.conversationId,
      targetUserMessageId: input.targetUserMessageId,
      text: input.text,
      ...(input.attachmentIds !== null
        ? { attachmentIds: input.attachmentIds }
        : {}),
      ...(input.executionSelection
        ? { executionSelection: input.executionSelection }
        : {}),
    });

    return this.prepareWithRaceRecovery(
      input.userId,
      input.requestId,
      requestHash,
      async (transaction) => {
        const existing = await this.findByRequest(
          transaction as Transaction,
          input.userId,
          input.requestId,
        );
        if (existing) return requestConflictOrReplay(existing, requestHash);

        const conversations =
          new DrizzleNativeLiveConversationRepository(
              transaction as Transaction,
            );
        const conversation = await conversations.getConversation({
          userId: input.userId,
          conversationId: input.conversationId,
        });
        if (
          !conversation
          || conversation.lifecycleStatus !== "active"
        ) {
          return { ok: false as const, code: "CONVERSATION_NOT_FOUND" as const };
        }

        const target = conversation.messages.find(
          (message) =>
            message.id === input.targetUserMessageId
            && message.role === "user",
        );
        const purgePlan = target
          ? planReplacementMessagePurge({
              operation: "edit",
              conversation,
              targetUserMessageId: target.id,
            })
          : null;
        if (!target || !purgePlan) {
          return { ok: false as const, code: "BRANCH_POINT_INVALID" as const };
        }

        const runtimeParent = await this.resolveRuntimeParent(
          transaction as Transaction,
          conversations,
          input.userId,
          input.conversationId,
          target.parentMessageId,
        );
        if (!runtimeParent.ok) return runtimeParent.result;

        const attachmentBinding =
          new DrizzleNativeLiveAttachmentBinding(
            transaction as Transaction,
          );
        const originalAttachments =
          await attachmentBinding.readForMessage({
            userId: input.userId,
            messageId: target.id,
          });
        const selectedAttachmentIds =
          input.attachmentIds
          ?? originalAttachments.map(
            (attachment) => attachment.attachment_id,
          );
        if (
          input.text.length === 0
          && selectedAttachmentIds.length === 0
        ) {
          return {
            ok: false as const,
            code: "BRANCH_POINT_INVALID" as const,
          };
        }

        const editedUser = await conversations.appendUserMessage({
          userId: input.userId,
          conversationId: input.conversationId,
          parentMessageId: target.parentMessageId,
        });
        if (input.text.length > 0) {
          await conversations.appendContentBlock({
            userId: input.userId,
            conversationId: input.conversationId,
            messageId: editedUser.id,
            ordinal: 0,
            block: {
              kind: "text",
              rawType: "text",
              text: input.text,
            },
          });
        }
        const attachments =
          await attachmentBinding.bindReadyToMessage({
            userId: input.userId,
            messageId: editedUser.id,
            attachmentIds: selectedAttachmentIds,
            allowPreviouslyBound: true,
            startOrdinal:
              input.text.length > 0 ? 1 : 0,
          });

        const preparation = await this.insertPreparation(transaction, {
          prepareId: input.prepareId,
          userId: input.userId,
          requestId: input.requestId,
          conversationId: input.conversationId,
          operation: "edit",
          requestHash,
          canonicalUserMessageId: editedUser.id,
          replacementTargetUserMessageId: target.id,
          runtimeMode: runtimeParent.runtimeMode,
          parentProviderSessionId: runtimeParent.parentProviderSessionId,
          workspaceId: runtimeParent.workspaceId,
          expectedWorkspaceRoot: runtimeParent.expectedWorkspaceRoot,
          executionSelection: input.executionSelection,
          attachments,
          prompt:
            input.text.length > 0
              ? input.text
              : "The user sent the attached file(s).",
        });

        return {
          ok: true as const,
          outcome: "created" as const,
          preparation,
        };
      },
    );
  }

  async getPreparation(input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLivePreparedTurn | null> {
    const row = await this.findById(this.db, input.userId, input.prepareId);
    return row ? mapPreparation(row) : null;
  }

  async recoverStaleDeliveryUnknownTurn(input: {
    userId: string;
    prepareId: string;
  }): Promise<boolean> {
    const updated = await this.db
      .update(nativeLiveTurnPreparations)
      .set({
        dispatchStatus: "rejected",
        reservedBy: null,
        reservedAt: null,
        reservationExpiresAt: null,
        executionStartedAt: null,
        dispatchErrorCode: "RESULT_DELIVERY_UNKNOWN",
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.prepareId),
          eq(nativeLiveTurnPreparations.status, "prepared"),
          eq(
            nativeLiveTurnPreparations.dispatchStatus,
            "delivery_unknown",
          ),
          sql`${nativeLiveTurnPreparations.deliveryUnknownAt}
            IS NOT NULL
            AND ${nativeLiveTurnPreparations.deliveryUnknownAt}
              <= now() - interval '30 seconds'`,
        ),
      )
      .returning({ id: nativeLiveTurnPreparations.id });

    return updated.length === 1;
  }

  async readActiveTurn(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveBackendTurnReadModel | null> {
    const [active] = await this.db
      .select({ id: nativeLiveTurnPreparations.id })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(
            nativeLiveTurnPreparations.conversationId,
            input.conversationId,
          ),
          eq(nativeLiveTurnPreparations.status, "prepared"),
          inArray(nativeLiveTurnPreparations.dispatchStatus, [
            "staged",
            "pending",
            "reserved",
            "executing",
            "delivery_unknown",
          ]),
        ),
      )
      .orderBy(
        sql`${nativeLiveTurnPreparations.createdAt} DESC`,
        sql`${nativeLiveTurnPreparations.id} DESC`,
      )
      .limit(1);

    if (!active) return null;
    return this.readTurn({
      userId: input.userId,
      prepareId: active.id,
    });
  }

  async readTurn(input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLiveBackendTurnReadModel | null> {
    const [row] = await this.db
      .select({
        id: nativeLiveTurnPreparations.id,
        requestId: nativeLiveTurnPreparations.requestId,
        conversationId: nativeLiveTurnPreparations.conversationId,
        operation: nativeLiveTurnPreparations.operation,
        canonicalUserMessageId:
          nativeLiveTurnPreparations.canonicalUserMessageId,
        workspaceId: nativeLiveTurnPreparations.workspaceId,
        expectedWorkspaceRoot:
          nativeLiveTurnPreparations.expectedWorkspaceRoot,
        executionSelection:
          nativeLiveTurnPreparations.executionSelection,
        canonicalStatus: nativeLiveTurnPreparations.status,
        dispatchStatus: nativeLiveTurnPreparations.dispatchStatus,
        assistantMessageId: nativeLiveTurnPreparations.assistantMessageId,
        runtimeMetadata: nativeLiveTurnPreparations.runtimeMetadata,
        failureCode: nativeLiveTurnPreparations.failureCode,
      })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.prepareId),
        ),
      )
      .limit(1);

    if (!row) return null;

    const [semantic] = await this.db
      .select({
        status: nativeLiveSemanticScoringRequests.status,
        fallbackCode: nativeLiveSemanticScoringRequests.fallbackCode,
      })
      .from(nativeLiveSemanticScoringRequests)
      .where(
        and(
          eq(nativeLiveSemanticScoringRequests.userId, input.userId),
          eq(nativeLiveSemanticScoringRequests.prepareId, input.prepareId),
        ),
      )
      .limit(1);

    let assistantMessage: NativeLiveMessage | null = null;
    if (row.assistantMessageId) {
      const conversations =
        new DrizzleNativeLiveConversationRepository(this.db);
      const conversation = await conversations.getConversation({
        userId: input.userId,
        conversationId: row.conversationId,
      });
      assistantMessage =
        conversation?.messages.find(
          (message) => message.id === row.assistantMessageId,
        ) ?? null;
      if (!assistantMessage) {
        throw new Error("Finalized assistant message was not found.");
      }
    }

    return {
      prepareId: row.id,
      requestId: row.requestId,
      conversationId: row.conversationId,
      operation: row.operation,
      canonicalUserMessageId: row.canonicalUserMessageId,
      workspaceId: row.workspaceId,
      expectedWorkspaceRoot: row.expectedWorkspaceRoot,
      executionSelection:
        row.executionSelection === null
          ? null
          : parseNativeLiveExecutionSelection(
              row.executionSelection,
            ),
      canonicalStatus: row.canonicalStatus,
      dispatchStatus: row.dispatchStatus,
      assistantMessage,
      runtimeMetadata:
        row.runtimeMetadata as NativeLiveRuntimeMetadata | null,
      failureCode: row.failureCode,
      semanticStatus: semantic?.status ?? null,
      semanticFallbackCode: semantic?.fallbackCode ?? null,
    };
  }

  async persistMindPreparedPrompt(input: {
    userId: string;
    prepareId: string;
    prompt: string;
  }): Promise<NativeLivePreparedTurn> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error("Mind-prepared runtime prompt must be nonblank.");
    }

    return this.db.transaction(
      async (transaction) => {
        const row = await this.findById(
          transaction as Transaction,
          input.userId,
          input.prepareId,
          true,
        );
        if (!row) {
          throw new Error("Native live turn preparation was not found.");
        }
        if (row.mindPrepared) return mapPreparation(row);
        if (row.status !== "prepared") {
          throw new Error("Finalized turn preparation cannot change its prompt.");
        }

        const [updated] = await transaction
          .update(nativeLiveTurnPreparations)
          .set({
            prompt,
            mindPrepared: true,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(nativeLiveTurnPreparations.id, input.prepareId),
              eq(nativeLiveTurnPreparations.userId, input.userId),
              eq(nativeLiveTurnPreparations.status, "prepared"),
              eq(nativeLiveTurnPreparations.mindPrepared, false),
            ),
          )
          .returning(this.selection());

        if (updated) return mapPreparation(updated);

        const raced = await this.findById(
          transaction as Transaction,
          input.userId,
          input.prepareId,
          true,
        );
        if (!raced) {
          throw new Error("Native live turn preparation disappeared.");
        }
        return mapPreparation(raced);
      },
      { isolationLevel: "serializable" },
    );
  }

  async finalizeSuccess(input: {
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
    const resultHash = hashJson(RESULT_HASH_VERSION, {
      status: "success",
      providerSessionId: input.providerSessionId,
      workspaceId: input.workspaceId,
      effectiveWorkspaceRoot: input.effectiveWorkspaceRoot,
      normalizedEvents: input.normalizedEvents,
      outputAttachmentIds: input.outputAttachmentIds,
      ...(input.runtimeMetadata
        ? { runtimeMetadata: input.runtimeMetadata }
        : {}),
    });

    try {
      return await this.db.transaction(
        async (transaction) => {
          const row = await this.findById(
            transaction as Transaction,
            input.userId,
            input.preparation.prepareId,
            true,
          );
          if (!row) {
            return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
          }

          if (row.status === "finalized_success") {
            if (row.resultHash !== resultHash) {
              return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
            }
            const record = await this.loadFinalizedSuccess(
              transaction as Transaction,
              row,
            );
            return {
              ok: true as const,
              outcome: "idempotent" as const,
              record,
            };
          }
          if (row.status !== "prepared") {
            return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
          }

          const conversations =
            new DrizzleNativeLiveConversationRepository(
              transaction as Transaction,
            );

          let replacementPurgePlan: ReplacementPurgePlan | null = null;
          if (row.operation !== "send") {
            const conversation = await conversations.getConversation({
              userId: input.userId,
              conversationId: row.conversationId,
            });
            if (!conversation) {
              throw new Error(
                "Replacement finalization conversation was not found.",
              );
            }
            replacementPurgePlan = planReplacementMessagePurge({
              operation: row.operation,
              conversation,
              targetUserMessageId:
                row.replacementTargetUserMessageId
                ?? (
                  row.operation === "retry"
                    ? row.canonicalUserMessageId
                    : null
                ),
            });
            if (!replacementPurgePlan) {
              throw new Error(
                "Replacement finalization target is no longer on the current path.",
              );
            }
          }

          const assistantMessage = await conversations.appendAssistantMessage({
            userId: input.userId,
            conversationId: row.conversationId,
            parentMessageId: row.canonicalUserMessageId,
          });

          const blocks = [];
          for (const [ordinal, block] of input.blocks.entries()) {
            blocks.push(
              await conversations.appendContentBlock({
                userId: input.userId,
                conversationId: row.conversationId,
                messageId: assistantMessage.id,
                ordinal,
                block,
              }),
            );
          }

          if (input.outputAttachmentIds.length > 0) {
            const attachmentBinding =
              new DrizzleNativeLiveAttachmentBinding(
                transaction as Transaction,
                8,
              );
            await attachmentBinding.bindReadyToMessage({
              userId: input.userId,
              messageId: assistantMessage.id,
              attachmentIds: input.outputAttachmentIds,
              startOrdinal: blocks.length,
            });
          }

          const checkpoint = await conversations.bindProviderCheckpoint({
            userId: input.userId,
            conversationId: row.conversationId,
            canonicalMessageId: assistantMessage.id,
            checkpoint: {
              provider: "claude_code",
              providerSessionId: input.providerSessionId,
              workspaceId: input.workspaceId,
              effectiveWorkspaceRoot: input.effectiveWorkspaceRoot,
              runtimeMetadata:
                input.runtimeMetadata as Record<string, unknown> | null,
            },
          });

          await conversations.setCurrentHead({
            userId: input.userId,
            conversationId: row.conversationId,
            messageId: assistantMessage.id,
          });

          await this.persistFinalizedContextLineage(
            transaction as Transaction,
            row,
            assistantMessage.id,
            input.mindFollowUp,
          );

          if (
            row.runtimeMode === "fork"
            && row.parentProviderSessionId
          ) {
            await transaction.execute(sql`
              UPDATE native_live_conversation_provider_bootstraps
              SET consumed_at = now()
              WHERE user_id = ${input.userId}::uuid
                AND conversation_id = ${row.conversationId}::uuid
                AND source_provider_session_id =
                  ${row.parentProviderSessionId}
                AND consumed_at IS NULL
            `);
          }

          const finalizedAt = new Date();
          const updated = await transaction
            .update(nativeLiveTurnPreparations)
            .set({
              status: "finalized_success",
              resultHash,
              providerSessionId: input.providerSessionId,
              runtimeMetadata:
                input.runtimeMetadata as Record<string, unknown> | null,
              assistantMessageId: assistantMessage.id,
              failureCode: null,
              finalizedAt,
              updatedAt: finalizedAt,
            })
            .where(
              and(
                eq(nativeLiveTurnPreparations.id, row.id),
                eq(nativeLiveTurnPreparations.userId, input.userId),
                eq(nativeLiveTurnPreparations.status, "prepared"),
              ),
            )
            .returning({ id: nativeLiveTurnPreparations.id });

          if (updated.length !== 1) {
            throw new Error("Native live turn finalization lost its preparation lock.");
          }

          if (
            replacementPurgePlan
            && replacementPurgePlan.rootMessageIds.length > 0
          ) {
            await this.purgeReplacementArtifacts(
              transaction as Transaction,
              row,
              replacementPurgePlan,
            );
          }

          if (input.mindFollowUp) {
            await transaction.insert(nativeLiveMindFollowUps).values({
              prepareId: row.id,
              userId: input.userId,
              conversationId: row.conversationId,
              assistantMessageId: assistantMessage.id,
              operation: row.operation,
              intents: input.mindFollowUp.intents.map((intent) => ({
                kind: intent.kind,
                text: intent.text,
                sourceStart: intent.sourceStart,
                sourceEnd: intent.sourceEnd,
                raw: intent.raw,
              })),
              actions: input.mindFollowUp.actions.map((action) => ({
                ...action,
              })),
              receipts: [],
              status: "pending",
              retryCount: 0,
            });
          }

          return {
            ok: true as const,
            outcome: "completed" as const,
            record: {
              assistantMessage: { ...assistantMessage, blocks },
              checkpoint,
            },
          };
        },
        { isolationLevel: "serializable" },
      );
    } catch {
      return { ok: false, code: "CANONICAL_WRITE_FAILURE" };
    }
  }

  private async persistFinalizedContextLineage(
    transaction: Transaction,
    row: PreparationRow,
    assistantMessageId: string,
    mindFollowUp: Parameters<
      NativeLiveBackendTurnPort["finalizeSuccess"]
    >[0]["mindFollowUp"],
  ): Promise<void> {
    const [userMessage] = await transaction
      .select({
        parentMessageId: conversationMessages.parentMessageId,
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, row.canonicalUserMessageId),
          eq(conversationMessages.userId, row.userId),
          eq(conversationMessages.conversationId, row.conversationId),
        ),
      )
      .limit(1);
    if (!userMessage) {
      throw new Error(
        "Context lineage source user message was not found.",
      );
    }

    let parentLineage = normalizeContextLineageState(null);
    if (userMessage.parentMessageId) {
      const [parentRow] = await transaction
        .select({
          epoch: runtimeContextLineageStates.epoch,
          seenStateIds: runtimeContextLineageStates.seenStateIds,
          thoughtRevision: runtimeContextLineageStates.thoughtRevision,
          thoughtFingerprint: runtimeContextLineageStates.thoughtFingerprint,
        })
        .from(runtimeContextLineageStates)
        .where(
          and(
            eq(runtimeContextLineageStates.userId, row.userId),
            eq(
              runtimeContextLineageStates.conversationId,
              row.conversationId,
            ),
            eq(
              runtimeContextLineageStates.canonicalMessageId,
              userMessage.parentMessageId,
            ),
          ),
        )
        .limit(1);
      parentLineage = normalizeContextLineageState(
        parentRow
          ? {
              epoch: parentRow.epoch,
              seenStateIds: parentRow.seenStateIds,
              thoughtRevision: parentRow.thoughtRevision,
              thoughtFingerprint: parentRow.thoughtFingerprint,
            }
          : null,
      );
    }

    const [manifestRow] = await transaction
      .select({
        lineage: runtimeContextManifests.lineage,
        items: runtimeContextManifests.items,
      })
      .from(runtimeContextManifests)
      .where(
        and(
          eq(runtimeContextManifests.id, row.id),
          eq(runtimeContextManifests.userId, row.userId),
          eq(
            runtimeContextManifests.conversationId,
            row.conversationId,
          ),
        ),
      )
      .limit(1);

    const manifestLineage =
      parseContextLineageManifest(manifestRow?.lineage ?? null);
    if (
      manifestLineage
      && manifestLineage.epoch !== parentLineage.epoch
    ) {
      throw new Error(
        "Prepared context lineage no longer matches its parent checkpoint.",
      );
    }

    const injectedStateIds = (manifestRow?.items ?? []).flatMap(
      (item) => {
        if (
          !item
          || typeof item !== "object"
          || Array.isArray(item)
        ) {
          throw new Error("Persisted Context Manifest item is invalid.");
        }
        const record = item as Record<string, unknown>;
        const selection = record.selection;
        if (
          (record.type !== "memory" && record.type !== "feel")
          || typeof record.sourceId !== "string"
          || !selection
          || typeof selection !== "object"
          || Array.isArray(selection)
          || !String(
            (selection as Record<string, unknown>).reason ?? "",
          ).startsWith("breath_")
        ) {
          return [];
        }
        return [record.sourceId];
      },
    );

    const selfWrittenStateIds = (mindFollowUp?.intents ?? []).flatMap(
      (intent, index) =>
        intent.kind === "memory" || intent.kind === "feel"
          ? [nativeLiveMindFollowUpStateId(row.id, index)]
          : [],
    );

    const seenStateIds = [
      ...new Set([
        ...parentLineage.seenStateIds,
        ...injectedStateIds,
        ...selfWrittenStateIds,
      ]),
    ];

    await transaction.insert(runtimeContextLineageStates).values({
      canonicalMessageId: assistantMessageId,
      userId: row.userId,
      conversationId: row.conversationId,
      epoch: manifestLineage?.epoch ?? parentLineage.epoch,
      seenStateIds,
      thoughtRevision:
        manifestLineage?.thoughtRevision
        ?? parentLineage.thoughtRevision,
      thoughtFingerprint:
        manifestLineage?.thoughtFingerprint
        ?? parentLineage.thoughtFingerprint,
    });
  }

  async finalizeFailure(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    errorCode: NativeLiveRuntimeFailureCode | "RUNTIME_PROTOCOL_ERROR";
  }): Promise<NativeLiveFinalizeFailurePortResult> {
    const resultHash = hashJson(RESULT_HASH_VERSION, {
      status: "failure",
      errorCode: input.errorCode,
    });

    try {
      return await this.db.transaction(
        async (transaction) => {
          const row = await this.findById(
            transaction as Transaction,
            input.userId,
            input.preparation.prepareId,
            true,
          );
          if (!row) {
            return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
          }
          if (row.status === "finalized_failure") {
            if (
              row.resultHash === resultHash
              && row.failureCode === input.errorCode
            ) {
              return { ok: true as const, outcome: "idempotent" as const };
            }
            return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
          }
          if (row.status !== "prepared") {
            return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
          }

          const finalizedAt = new Date();
          const updated = await transaction
            .update(nativeLiveTurnPreparations)
            .set({
              status: "finalized_failure",
              resultHash,
              providerSessionId: null,
              assistantMessageId: null,
              failureCode: input.errorCode,
              finalizedAt,
              updatedAt: finalizedAt,
            })
            .where(
              and(
                eq(nativeLiveTurnPreparations.id, row.id),
                eq(nativeLiveTurnPreparations.userId, input.userId),
                eq(nativeLiveTurnPreparations.status, "prepared"),
              ),
            )
            .returning({ id: nativeLiveTurnPreparations.id });

          if (updated.length !== 1) {
            return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
          }
          return { ok: true as const, outcome: "recorded" as const };
        },
        { isolationLevel: "serializable" },
      );
    } catch {
      return { ok: false, code: "FINALIZE_CONFLICT" };
    }
  }

  private async purgeReplacementArtifacts(
    transaction: Transaction,
    row: PreparationRow,
    plan: ReplacementPurgePlan,
  ): Promise<void> {
    const purgeMessageIds = new Set(plan.messageIds);
    if (purgeMessageIds.size === 0) return;

    const checkpoints = await transaction
      .select({
        canonicalMessageId:
          conversationProviderSessionCheckpoints.canonicalMessageId,
        provider:
          conversationProviderSessionCheckpoints.provider,
        providerSessionId:
          conversationProviderSessionCheckpoints.providerSessionId,
        workspaceId:
          conversationProviderSessionCheckpoints.workspaceId,
        effectiveWorkspaceRoot:
          conversationProviderSessionCheckpoints.effectiveWorkspaceRoot,
      })
      .from(conversationProviderSessionCheckpoints)
      .where(
        and(
          eq(
            conversationProviderSessionCheckpoints.userId,
            row.userId,
          ),
          eq(
            conversationProviderSessionCheckpoints.conversationId,
            row.conversationId,
          ),
        ),
      );

    const providerSessionIds =
      planExclusiveProviderSessionCleanup({
        purgeMessageIds,
        checkpoints,
      });
    if (providerSessionIds.length > 0) {
      await transaction
        .insert(nativeLiveProviderSessionCleanups)
        .values(
          providerSessionIds.map((providerSessionId) => {
            const sessionCheckpoints = checkpoints.filter(
              (checkpoint) =>
                checkpoint.providerSessionId === providerSessionId,
            );
            const bindings = new Map(
              sessionCheckpoints.map((checkpoint) => [
                JSON.stringify([
                  checkpoint.workspaceId,
                  checkpoint.effectiveWorkspaceRoot,
                ]),
                checkpoint,
              ]),
            );
            if (bindings.size > 1) {
              throw new Error(
                "Provider session is bound to multiple workspace roots.",
              );
            }
            const binding = bindings.values().next().value;
            return {
              userId: row.userId,
              provider: "claude_code" as const,
              providerSessionId,
              workspaceId: binding?.workspaceId ?? null,
              effectiveWorkspaceRoot:
                binding?.effectiveWorkspaceRoot ?? null,
              status: "pending" as const,
            };
          }),
        )
        .onConflictDoNothing();
    }

    const states = await transaction
      .select({
        id: runtimeSubjectStates.id,
        subjectId: runtimeSubjectStates.subjectId,
        kind: runtimeSubjectStates.kind,
        payload: runtimeSubjectStates.payload,
        envelope: runtimeSubjectStates.envelope,
        scopeConversationId: runtimeSubjectStates.scopeConversationId,
        scopePathHeadMessageId:
          runtimeSubjectStates.scopePathHeadMessageId,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, row.userId));

    const purgeStateIds = planCausalSubjectStatePurge({
      purgeMessageIds,
      states,
    });
    const purgeStateIdSet = new Set(purgeStateIds);
    const stateRepairs = planSubjectStateRepairs({
      states,
      purgeMessageIds,
      purgeStateIds: purgeStateIdSet,
      memoryLifecyclePolicy: this.memoryLifecyclePolicy,
      repairedAt: new Date().toISOString(),
    });
    const causalIds = new Set<string>([
      ...purgeMessageIds,
      ...purgeStateIds,
    ]);

    const backgroundJobs = await transaction
      .select({
        id: nativeLiveBackgroundModelJobs.id,
        workflowKind: nativeLiveBackgroundModelJobs.workflowKind,
        workflowPayload: nativeLiveBackgroundModelJobs.workflowPayload,
      })
      .from(nativeLiveBackgroundModelJobs)
      .where(eq(nativeLiveBackgroundModelJobs.userId, row.userId));

    const purgeBackgroundJobIds = backgroundJobs
      .filter((job) =>
        workflowReferencesAnyId(
          job.workflowPayload,
          causalIds,
        )
      )
      .map((job) => job.id);

    if (purgeBackgroundJobIds.length > 0) {
      await transaction
        .delete(nativeLiveBackgroundModelJobs)
        .where(
          and(
            eq(nativeLiveBackgroundModelJobs.userId, row.userId),
            inArray(
              nativeLiveBackgroundModelJobs.id,
              purgeBackgroundJobIds,
            ),
          ),
        );
    }

    if (purgeStateIds.length > 0) {
      await transaction
        .delete(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.userId, row.userId),
            inArray(runtimeSubjectStates.id, purgeStateIds),
          ),
        );
    }

    for (const repair of stateRepairs) {
      await transaction
        .update(runtimeSubjectStates)
        .set({
          payload: repair.nextPayload,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(runtimeSubjectStates.userId, row.userId),
            eq(runtimeSubjectStates.id, repair.stateId),
          ),
        );
    }
    // A revived thought can push the active set past its limit.
    const revivedIds = new Set(
      stateRepairs
        .filter((repair) => repair.revivedThought)
        .map((repair) => repair.stateId),
    );
    const revivedSubjectIds = new Set(
      states
        .filter((state) => revivedIds.has(state.id))
        .map((state) => state.subjectId),
    );
    for (const subjectId of revivedSubjectIds) {
      await enforceThoughtCapacity(transaction, {
        userId: row.userId,
        subjectId,
        droppedAt: new Date().toISOString(),
      });
    }

    await transaction
      .delete(conversationMessages)
      .where(
        and(
          eq(conversationMessages.userId, row.userId),
          eq(conversationMessages.conversationId, row.conversationId),
          inArray(conversationMessages.id, plan.rootMessageIds),
        ),
      );
  }

  private async prepareWithRaceRecovery(
    userId: string,
    requestId: string,
    requestHash: string,
    work: (transaction: Transaction) => Promise<NativeLivePreparePortResult>,
  ): Promise<NativeLivePreparePortResult> {
    const existing = await this.findByRequest(this.db, userId, requestId);
    if (existing) return requestConflictOrReplay(existing, requestHash);

    try {
      return await this.db.transaction(
        async (transaction) => work(transaction as Transaction),
        { isolationLevel: "serializable" },
      );
    } catch (error) {
      const raced = await this.findByRequest(this.db, userId, requestId);
      if (raced) return requestConflictOrReplay(raced, requestHash);
      throw error;
    }
  }

  private async resolveRuntimeParent(
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
    if (!parentMessageId) {
      const bootstrapRows = await executor.execute<{
        source_provider_session_id: string;
        workspace_id: string | null;
        effective_workspace_root: string;
      }>(sql`
        SELECT
          source_provider_session_id,
          workspace_id,
          effective_workspace_root
        FROM native_live_conversation_provider_bootstraps
        WHERE user_id = ${userId}::uuid
          AND conversation_id = ${conversationId}::uuid
          AND provider = 'claude_code'
          AND consumed_at IS NULL
        LIMIT 1
      `);
      const bootstrap = bootstrapRows[0];
      if (bootstrap) {
        if (
          requestedWorkspaceId !== null
          && requestedWorkspaceId !== bootstrap.workspace_id
        ) {
          return {
            ok: false,
            result: {
              ok: false,
              code: "WORKSPACE_BINDING_CONFLICT",
            },
          };
        }
        return {
          ok: true,
          runtimeMode: "fork",
          parentProviderSessionId:
            bootstrap.source_provider_session_id,
          workspaceId: bootstrap.workspace_id,
          expectedWorkspaceRoot:
            bootstrap.effective_workspace_root,
        };
      }

      if (requestedWorkspaceId) {
        const [workspace] = await executor
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(
            and(
              eq(workspaces.userId, userId),
              eq(workspaces.id, requestedWorkspaceId),
            ),
          )
          .limit(1);
        if (!workspace) {
          return {
            ok: false,
            result: {
              ok: false,
              code: "WORKSPACE_NOT_FOUND",
            },
          };
        }
        await executor
          .insert(workspaceConversations)
          .values({
            userId,
            workspaceId: requestedWorkspaceId,
            conversationId,
          })
          .onConflictDoNothing();
        return {
          ok: true,
          runtimeMode: "new",
          parentProviderSessionId: null,
          workspaceId: requestedWorkspaceId,
          expectedWorkspaceRoot: null,
        };
      }

      const workspaceRows = await executor
        .select({ workspaceId: workspaceConversations.workspaceId })
        .from(workspaceConversations)
        .where(
          and(
            eq(workspaceConversations.userId, userId),
            eq(workspaceConversations.conversationId, conversationId),
          ),
        )
        .limit(2);
      if (workspaceRows.length > 1) {
        return {
          ok: false,
          result: {
            ok: false,
            code: "WORKSPACE_BINDING_AMBIGUOUS",
          },
        };
      }
      return {
        ok: true,
        runtimeMode: "new",
        parentProviderSessionId: null,
        workspaceId: workspaceRows[0]?.workspaceId ?? null,
        expectedWorkspaceRoot: null,
      };
    }

    const checkpoint = await conversations.getProviderCheckpointForHead({
      userId,
      conversationId,
      canonicalMessageId: parentMessageId,
    });
    if (!checkpoint) {
      return {
        ok: false,
        result: { ok: false, code: "CHECKPOINT_NOT_FOUND" },
      };
    }
    if (
      requestedWorkspaceId !== null
      && requestedWorkspaceId !== checkpoint.workspaceId
    ) {
      return {
        ok: false,
        result: {
          ok: false,
          code: "WORKSPACE_BINDING_CONFLICT",
        },
      };
    }

    return {
      ok: true,
      runtimeMode: "fork",
      parentProviderSessionId: checkpoint.providerSessionId,
      workspaceId: checkpoint.workspaceId,
      expectedWorkspaceRoot: checkpoint.effectiveWorkspaceRoot,
    };
  }

  private async insertPreparation(
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
    const [row] = await executor
      .insert(nativeLiveTurnPreparations)
      .values({
        id: input.prepareId,
        userId: input.userId,
        requestId: input.requestId,
        conversationId: input.conversationId,
        operation: input.operation,
        requestHash: input.requestHash,
        canonicalUserMessageId: input.canonicalUserMessageId,
        replacementTargetUserMessageId: input.replacementTargetUserMessageId,
        runtimeMode: input.runtimeMode,
        parentProviderSessionId: input.parentProviderSessionId,
        workspaceId: input.workspaceId,
        expectedWorkspaceRoot: input.expectedWorkspaceRoot,
        executionSelection: input.executionSelection,
        attachments: input.attachments,
        prompt: input.prompt,
        mindPrepared: false,
        status: "prepared",
      })
      .returning(this.selection());

    if (!row) throw new Error("Native live turn preparation insert failed.");
    return mapPreparation(row);
  }

  private async findByRequest(
    executor: Executor,
    userId: string,
    requestId: string,
  ): Promise<PreparationRow | null> {
    const [row] = await executor
      .select(this.selection())
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, userId),
          eq(nativeLiveTurnPreparations.requestId, requestId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async findById(
    executor: Executor,
    userId: string,
    prepareId: string,
    lock = false,
  ): Promise<PreparationRow | null> {
    const query = executor
      .select(this.selection())
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, userId),
          eq(nativeLiveTurnPreparations.id, prepareId),
        ),
      );

    const rows = lock
      ? await query.for("update").limit(1)
      : await query.limit(1);
    return rows[0] ?? null;
  }

  private async loadFinalizedSuccess(
    transaction: Transaction,
    row: PreparationRow,
  ): Promise<{
    assistantMessage: NativeLiveMessage;
    checkpoint: NativeLiveProviderCheckpoint;
  }> {
    if (!row.assistantMessageId) {
      throw new Error("Finalized preparation is missing its assistant message.");
    }

    const conversations =
      new DrizzleNativeLiveConversationRepository(
              transaction as Transaction,
            );
    const conversation = await conversations.getConversation({
      userId: row.userId,
      conversationId: row.conversationId,
    });
    const assistantMessage = conversation?.messages.find(
      (message) => message.id === row.assistantMessageId,
    );
    if (!assistantMessage) {
      throw new Error("Finalized assistant message was not found.");
    }

    const checkpoint = await conversations.getProviderCheckpointForHead({
      userId: row.userId,
      conversationId: row.conversationId,
      canonicalMessageId: row.assistantMessageId,
    });
    if (!checkpoint) {
      throw new Error("Finalized provider checkpoint was not found.");
    }

    return { assistantMessage, checkpoint };
  }

  private selection() {
    return {
      id: nativeLiveTurnPreparations.id,
      userId: nativeLiveTurnPreparations.userId,
      requestId: nativeLiveTurnPreparations.requestId,
      conversationId: nativeLiveTurnPreparations.conversationId,
      operation: nativeLiveTurnPreparations.operation,
      requestHash: nativeLiveTurnPreparations.requestHash,
      canonicalUserMessageId:
        nativeLiveTurnPreparations.canonicalUserMessageId,
      replacementTargetUserMessageId:
        nativeLiveTurnPreparations.replacementTargetUserMessageId,
      runtimeMode: nativeLiveTurnPreparations.runtimeMode,
      parentProviderSessionId:
        nativeLiveTurnPreparations.parentProviderSessionId,
      workspaceId: nativeLiveTurnPreparations.workspaceId,
      expectedWorkspaceRoot:
        nativeLiveTurnPreparations.expectedWorkspaceRoot,
      executionSelection: nativeLiveTurnPreparations.executionSelection,
      attachments: nativeLiveTurnPreparations.attachments,
      prompt: nativeLiveTurnPreparations.prompt,
      mindPrepared: nativeLiveTurnPreparations.mindPrepared,
      status: nativeLiveTurnPreparations.status,
      resultHash: nativeLiveTurnPreparations.resultHash,
      providerSessionId: nativeLiveTurnPreparations.providerSessionId,
      runtimeMetadata: nativeLiveTurnPreparations.runtimeMetadata,
      assistantMessageId: nativeLiveTurnPreparations.assistantMessageId,
      failureCode: nativeLiveTurnPreparations.failureCode,
    };
  }
}
