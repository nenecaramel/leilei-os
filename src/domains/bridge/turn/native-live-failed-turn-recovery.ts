import { and, asc, eq } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  conversationMessages,
  conversations,
  nativeLiveRuntimeEvents,
  nativeLiveRuntimeInteractions,
  nativeLiveTurnPreparations,
} from "../../../database/schema.js";
import {
  canonicalizeNativeLiveEvents,
  type NativeLiveNormalizedEvent,
} from "../../conversation/native-live-conversation-orchestrator.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../../conversation/native-live-conversation-repository.js";
import {
  withCanonicalQuestionActivity,
} from "../../conversation/native-live-question-activity.js";
import type {
  NativeLiveProviderSessionStoreService,
} from "../provider-session/native-live-provider-session-store.js";
import {
  hashJson,
  RESULT_HASH_VERSION,
} from "./turn-repository/records.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;


export class NativeLiveFailedTurnRecoveryError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "NOT_RECOVERABLE"
      | "SESSION_NOT_COMPLETE"
      | "CHECKPOINT_NOT_FOUND"
      | "STALE_HEAD"
      | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveFailedTurnRecoveryError";
  }
}

export type NativeLiveFailedTurnRecoveryInspection = {
  prepareId: string;
  conversationId: string;
  userMessageId: string;
  providerSessionId: string;
  expectedWorkingDirectory: string | null;
  failureCode: string;
  eventCount: number;
  recoverable: boolean;
};

export class NativeLiveFailedTurnRecoveryService {
  constructor(
    private readonly db: Database,
    private readonly sessionStore: Pick<
      NativeLiveProviderSessionStoreService,
      "getStatus" | "load"
    >,
  ) {}

  async inspect(input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLiveFailedTurnRecoveryInspection> {
    const snapshot = await this.readSnapshot(
      this.db,
      input.userId,
      input.prepareId,
      false,
    );
    return {
      prepareId: snapshot.prepareId,
      conversationId: snapshot.conversationId,
      userMessageId: snapshot.userMessageId,
      providerSessionId: snapshot.providerSessionId,
      expectedWorkingDirectory: snapshot.expectedWorkingDirectory,
      failureCode: snapshot.failureCode,
      eventCount: snapshot.events.length,
      recoverable: snapshot.recoverable,
    };
  }

  async recover(input: {
    userId: string;
    prepareId: string;
  }): Promise<{
    assistantMessageId: string;
    providerSessionId: string;
    providerCheckpointId: string;
    conversationId: string;
  }> {
    const initial = await this.readSnapshot(
      this.db,
      input.userId,
      input.prepareId,
      false,
    );
    if (!initial.recoverable) {
      throw new NativeLiveFailedTurnRecoveryError(
        "NOT_RECOVERABLE",
        "Failed turn does not contain a recoverable successful runtime result.",
      );
    }

    const status = await this.sessionStore.getStatus({
      userId: input.userId,
      sessionId: initial.providerSessionId,
    });
    if (status !== "complete") {
      throw new NativeLiveFailedTurnRecoveryError(
        "SESSION_NOT_COMPLETE",
        "Provider transcript is not durably complete.",
      );
    }

    const transcript = await this.sessionStore.load({
      userId: input.userId,
      key: { sessionId: initial.providerSessionId },
    });
    const providerCheckpointId =
      completedCheckpointId(transcript ?? [], initial.finalText);
    if (!providerCheckpointId) {
      throw new NativeLiveFailedTurnRecoveryError(
        "CHECKPOINT_NOT_FOUND",
        "Recovered provider transcript does not contain the completed assistant checkpoint.",
      );
    }

    return this.db.transaction(
      async (transaction) => {
        const snapshot = await this.readSnapshot(
          transaction as Transaction,
          input.userId,
          input.prepareId,
          true,
        );
        if (
          snapshot.providerSessionId !== initial.providerSessionId
          || snapshot.finalText !== initial.finalText
        ) {
          throw new NativeLiveFailedTurnRecoveryError(
            "CONFLICT",
            "Failed turn changed while recovery was being prepared.",
          );
        }

        const [conversation] = await transaction
          .select({
            currentHeadMessageId: conversations.currentHeadMessageId,
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.userId, input.userId),
              eq(conversations.id, snapshot.conversationId),
              eq(conversations.origin, "native_live"),
              eq(conversations.lifecycleStatus, "active"),
            ),
          )
          .for("update")
          .limit(1);
        if (!conversation) {
          throw new NativeLiveFailedTurnRecoveryError(
            "NOT_FOUND",
            "Conversation was not found.",
          );
        }

        const [preparedUser] = await transaction
          .select({
            id: conversationMessages.id,
            parentMessageId: conversationMessages.parentMessageId,
            role: conversationMessages.role,
          })
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.userId, input.userId),
              eq(conversationMessages.conversationId, snapshot.conversationId),
              eq(conversationMessages.id, snapshot.userMessageId),
            ),
          )
          .limit(1);
        if (
          !preparedUser
          || preparedUser.role !== "user"
          || preparedUser.parentMessageId !== conversation.currentHeadMessageId
        ) {
          throw new NativeLiveFailedTurnRecoveryError(
            "STALE_HEAD",
            "Prepared user message no longer branches from the current head.",
          );
        }

        const [existingAssistant] = await transaction
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.userId, input.userId),
              eq(conversationMessages.conversationId, snapshot.conversationId),
              eq(conversationMessages.parentMessageId, snapshot.userMessageId),
              eq(conversationMessages.role, "assistant"),
            ),
          )
          .limit(1);
        if (existingAssistant) {
          throw new NativeLiveFailedTurnRecoveryError(
            "CONFLICT",
            "Failed turn already has an assistant child.",
          );
        }

        const canonical = canonicalizeNativeLiveEvents(snapshot.events);
        if (canonical.error || canonical.blocks.length === 0) {
          throw new NativeLiveFailedTurnRecoveryError(
            "NOT_RECOVERABLE",
            "Failed turn events cannot be projected into a successful assistant message.",
          );
        }

        const questionInteractions = canonical.blocks.some(
          (block) =>
            block.kind === "tool_use"
            && block.payload?.tool_name === "AskUserQuestion",
        )
          ? await transaction
              .select({
                kind: nativeLiveRuntimeInteractions.kind,
                status: nativeLiveRuntimeInteractions.status,
                request: nativeLiveRuntimeInteractions.request,
                response: nativeLiveRuntimeInteractions.response,
              })
              .from(nativeLiveRuntimeInteractions)
              .where(
                and(
                  eq(nativeLiveRuntimeInteractions.userId, input.userId),
                  eq(nativeLiveRuntimeInteractions.prepareId, snapshot.prepareId),
                  eq(nativeLiveRuntimeInteractions.kind, "question"),
                ),
              )
          : [];
        const blocks = withCanonicalQuestionActivity(
          canonical.blocks,
          questionInteractions,
        );

        const repository =
          new DrizzleNativeLiveConversationRepository(
            transaction as Transaction,
          );
        const assistantMessage = await repository.appendAssistantMessage({
          userId: input.userId,
          conversationId: snapshot.conversationId,
          parentMessageId: snapshot.userMessageId,
        });
        for (const [ordinal, block] of blocks.entries()) {
          await repository.appendContentBlock({
            userId: input.userId,
            conversationId: snapshot.conversationId,
            messageId: assistantMessage.id,
            ordinal,
            block,
          });
        }

        const runtimeMetadata = {
          provider_checkpoint_version: 1,
          recovered_failed_turn: true,
          recovered_prepare_id: snapshot.prepareId,
        };
        await repository.bindProviderCheckpoint({
          userId: input.userId,
          conversationId: snapshot.conversationId,
          canonicalMessageId: assistantMessage.id,
          checkpoint: {
            provider: "claude_code",
            providerSessionId: snapshot.providerSessionId,
            effectiveWorkingDirectory:
              snapshot.expectedWorkingDirectory,
            providerCheckpointId,
            runtimeMetadata,
          },
        });
        await repository.setCurrentHead({
          userId: input.userId,
          conversationId: snapshot.conversationId,
          messageId: assistantMessage.id,
        });

        const recoveredAt = new Date();
        const resultHash = hashJson(RESULT_HASH_VERSION, {
          status: "success",
          providerSessionId: snapshot.providerSessionId,
          effectiveWorkingDirectory: snapshot.expectedWorkingDirectory,
          providerCheckpointId,
          normalizedEvents: snapshot.events,
          outputAttachmentIds: [],
          runtimeMetadata,
        });
        const updated = await transaction
          .update(nativeLiveTurnPreparations)
          .set({
            status: "finalized_success",
            resultHash,
            providerSessionId: snapshot.providerSessionId,
            runtimeMetadata,
            assistantMessageId: assistantMessage.id,
            failureCode: null,
            finalizedAt: recoveredAt,
            updatedAt: recoveredAt,
          })
          .where(
            and(
              eq(nativeLiveTurnPreparations.userId, input.userId),
              eq(nativeLiveTurnPreparations.id, snapshot.prepareId),
              eq(nativeLiveTurnPreparations.status, "finalized_failure"),
              eq(nativeLiveTurnPreparations.failureCode, "RUNTIME_UNAVAILABLE"),
            ),
          )
          .returning({ id: nativeLiveTurnPreparations.id });
        if (updated.length !== 1) {
          throw new NativeLiveFailedTurnRecoveryError(
            "CONFLICT",
            "Failed turn status changed before recovery commit.",
          );
        }

        return {
          assistantMessageId: assistantMessage.id,
          providerSessionId: snapshot.providerSessionId,
          providerCheckpointId,
          conversationId: snapshot.conversationId,
        };
      },
      { isolationLevel: "serializable" },
    );
  }

  private async readSnapshot(
    executor: Database | Transaction,
    userId: string,
    prepareId: string,
    lock: boolean,
  ): Promise<{
    prepareId: string;
    conversationId: string;
    userMessageId: string;
    expectedWorkingDirectory: string | null;
    failureCode: string;
    providerSessionId: string;
    finalText: string;
    events: NativeLiveNormalizedEvent[];
    recoverable: boolean;
  }> {
    const selection = {
      id: nativeLiveTurnPreparations.id,
      conversationId: nativeLiveTurnPreparations.conversationId,
      canonicalUserMessageId:
        nativeLiveTurnPreparations.canonicalUserMessageId,
      expectedWorkingDirectory:
        nativeLiveTurnPreparations.expectedWorkingDirectory,
      status: nativeLiveTurnPreparations.status,
      operation: nativeLiveTurnPreparations.operation,
      failureCode: nativeLiveTurnPreparations.failureCode,
    };
    const rows = lock
      ? await executor
          .select(selection)
          .from(nativeLiveTurnPreparations)
          .where(
            and(
              eq(nativeLiveTurnPreparations.userId, userId),
              eq(nativeLiveTurnPreparations.id, prepareId),
            ),
          )
          .for("update")
          .limit(1)
      : await executor
          .select(selection)
          .from(nativeLiveTurnPreparations)
          .where(
            and(
              eq(nativeLiveTurnPreparations.userId, userId),
              eq(nativeLiveTurnPreparations.id, prepareId),
            ),
          )
          .limit(1);
    const row = rows[0];
    if (!row || !row.canonicalUserMessageId) {
      throw new NativeLiveFailedTurnRecoveryError(
        "NOT_FOUND",
        "Failed turn was not found.",
      );
    }
    if (
      row.status !== "finalized_failure"
      || row.operation !== "send"
      || row.failureCode !== "RUNTIME_UNAVAILABLE"
    ) {
      throw new NativeLiveFailedTurnRecoveryError(
        "NOT_RECOVERABLE",
        "Only failed foreground send turns with RUNTIME_UNAVAILABLE are recoverable.",
      );
    }

    const eventRows = await executor
      .select({
        eventType: nativeLiveRuntimeEvents.eventType,
        providerSessionId:
          nativeLiveRuntimeEvents.providerSessionId,
        payload: nativeLiveRuntimeEvents.payload,
      })
      .from(nativeLiveRuntimeEvents)
      .where(
        and(
          eq(nativeLiveRuntimeEvents.userId, userId),
          eq(nativeLiveRuntimeEvents.prepareId, row.id),
        ),
      )
      .orderBy(asc(nativeLiveRuntimeEvents.sequence));
    const events: NativeLiveNormalizedEvent[] = eventRows.map((event) => ({
      type: event.eventType,
      ...(event.providerSessionId
        ? { provider_session_id: event.providerSessionId }
        : {}),
      ...(event.payload ? { payload: event.payload } : {}),
    }));
    const resultEvents = eventRows.filter(
      (event) => event.eventType === "result",
    );
    const terminalResult = resultEvents.at(-1);
    const providerSessionId =
      terminalResult?.providerSessionId?.trim() ?? "";
    const finalText =
      typeof terminalResult?.payload?.final_text === "string"
        ? terminalResult.payload.final_text.trim()
        : "";
    const hasError = eventRows.some(
      (event) =>
        event.eventType === "error"
        || (
          event.eventType === "result"
          && event.payload?.status === "error"
        ),
    );

    return {
      prepareId: row.id,
      conversationId: row.conversationId,
      userMessageId: row.canonicalUserMessageId,
      expectedWorkingDirectory: row.expectedWorkingDirectory,
      failureCode: row.failureCode,
      providerSessionId,
      finalText,
      events,
      recoverable:
        providerSessionId.length > 0
        && resultEvents.length >= 1
        && finalText.length > 0
        && !hasError
        && !events.some((event) => event.type === "attachment"),
    };
  }
}

function completedCheckpointId(
  entries: Array<Record<string, unknown> & { type: string }>,
  finalText: string,
): string | null {
  const chain = entries.filter(
    (entry) =>
      entry
      && entry.isSidechain !== true
      && ["user", "assistant", "system", "attachment"].includes(entry.type)
      && typeof entry.uuid === "string"
      && Object.hasOwn(entry, "parentUuid"),
  );
  const last = chain.at(-1);
  if (!last || typeof last.uuid !== "string" || !last.uuid.trim()) {
    return null;
  }

  const matchingAssistant = [...chain].reverse().find((entry) => {
    if (entry.type !== "assistant") return false;
    const message =
      entry.message
      && typeof entry.message === "object"
      && !Array.isArray(entry.message)
        ? entry.message as Record<string, unknown>
        : null;
    const content = Array.isArray(message?.content)
      ? message.content
      : [];
    const text = content
      .map((block) => {
        if (!block || typeof block !== "object" || Array.isArray(block)) {
          return "";
        }
        const record = block as Record<string, unknown>;
        return record.type === "text" && typeof record.text === "string"
          ? record.text
          : "";
      })
      .join("")
      .trim();
    return text === finalText;
  });
  return matchingAssistant ? last.uuid : null;
}
