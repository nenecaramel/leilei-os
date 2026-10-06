import { and, asc, eq } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  nativeLiveRuntimeEvents,
  nativeLiveRuntimeInteractions,
  nativeLiveTurnPreparations,
} from "../../../database/schema.js";
import {
  canonicalizeNativeLiveEvents,
  type NativeLiveNormalizedEvent,
} from "../../conversation/native-live-conversation-orchestrator.js";
import {
  withCanonicalQuestionActivity,
} from "../../conversation/native-live-question-activity.js";
import type {
  NativeLiveProviderSessionStoreService,
} from "../provider-session/native-live-provider-session-store.js";
import type {
  DrizzleNativeLiveBackendTurnPort,
} from "./native-live-backend-turn-repository.js";

type Database = ReturnType<typeof createDatabase>["db"];

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
  operation: "edit";
  providerSessionId: string;
  expectedWorkingDirectory: string | null;
  failureCode: "RUNTIME_UNAVAILABLE";
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
    private readonly turnPort: Pick<
      DrizzleNativeLiveBackendTurnPort,
      "getPreparation" | "recoverFinalizedFailureSuccess"
    >,
  ) {}

  async inspect(input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLiveFailedTurnRecoveryInspection> {
    const snapshot = await this.readSnapshot(
      input.userId,
      input.prepareId,
    );
    return {
      prepareId: snapshot.prepareId,
      conversationId: snapshot.conversationId,
      userMessageId: snapshot.userMessageId,
      operation: "edit",
      providerSessionId: snapshot.providerSessionId,
      expectedWorkingDirectory: snapshot.expectedWorkingDirectory,
      failureCode: "RUNTIME_UNAVAILABLE",
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
    const snapshot = await this.readSnapshot(
      input.userId,
      input.prepareId,
    );
    if (!snapshot.recoverable) {
      throw new NativeLiveFailedTurnRecoveryError(
        "NOT_RECOVERABLE",
        "Failed edit does not contain one recoverable successful runtime result.",
      );
    }

    const status = await this.sessionStore.getStatus({
      userId: input.userId,
      sessionId: snapshot.providerSessionId,
    });
    if (status !== "complete") {
      throw new NativeLiveFailedTurnRecoveryError(
        "SESSION_NOT_COMPLETE",
        "Provider transcript is not durably complete.",
      );
    }

    const transcript = await this.sessionStore.load({
      userId: input.userId,
      key: { sessionId: snapshot.providerSessionId },
    });
    const providerCheckpointId =
      completedCheckpointId(transcript ?? [], snapshot.finalText);
    if (!providerCheckpointId) {
      throw new NativeLiveFailedTurnRecoveryError(
        "CHECKPOINT_NOT_FOUND",
        "Recovered provider transcript does not contain the completed assistant checkpoint.",
      );
    }

    const canonical = canonicalizeNativeLiveEvents(snapshot.events);
    if (canonical.error || canonical.blocks.length === 0) {
      throw new NativeLiveFailedTurnRecoveryError(
        "NOT_RECOVERABLE",
        "Failed edit events cannot be projected into a successful assistant message.",
      );
    }

    const questionInteractions = canonical.blocks.some(
      (block) =>
        block.kind === "tool_use"
        && block.payload?.tool_name === "AskUserQuestion",
    )
      ? await this.db
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
              eq(
                nativeLiveRuntimeInteractions.prepareId,
                snapshot.prepareId,
              ),
              eq(nativeLiveRuntimeInteractions.kind, "question"),
            ),
          )
      : [];
    const blocks = withCanonicalQuestionActivity(
      canonical.blocks,
      questionInteractions,
    );

    const preparation = await this.turnPort.getPreparation({
      userId: input.userId,
      prepareId: input.prepareId,
    });
    if (
      !preparation
      || preparation.operation !== "edit"
      || preparation.canonicalUserMessageId !== snapshot.userMessageId
      || preparation.conversationId !== snapshot.conversationId
    ) {
      throw new NativeLiveFailedTurnRecoveryError(
        "CONFLICT",
        "Failed edit preparation changed before recovery.",
      );
    }

    const result =
      await this.turnPort.recoverFinalizedFailureSuccess({
        userId: input.userId,
        preparation,
        providerSessionId: snapshot.providerSessionId,
        effectiveWorkingDirectory:
          snapshot.expectedWorkingDirectory,
        providerCheckpointId,
        blocks,
        normalizedEvents: snapshot.events,
        runtimeMetadata: {
          recovered_failed_turn: true,
          recovered_prepare_id: snapshot.prepareId,
        },
      });

    if (!result.ok) {
      throw new NativeLiveFailedTurnRecoveryError(
        result.code === "FINALIZE_CONFLICT"
          ? "STALE_HEAD"
          : "CONFLICT",
        result.code === "FINALIZE_CONFLICT"
          ? "Conversation advanced or the edited branch is no longer recoverable."
          : "Canonical failed edit recovery could not be committed.",
      );
    }
    if (result.outcome === "wake_discarded" || !result.record) {
      throw new NativeLiveFailedTurnRecoveryError(
        "CONFLICT",
        "Failed edit recovery returned an invalid canonical outcome.",
      );
    }

    return {
      assistantMessageId: result.record.assistantMessage.id,
      providerSessionId: snapshot.providerSessionId,
      providerCheckpointId,
      conversationId: snapshot.conversationId,
    };
  }

  private async readSnapshot(
    userId: string,
    prepareId: string,
  ): Promise<{
    prepareId: string;
    conversationId: string;
    userMessageId: string;
    expectedWorkingDirectory: string | null;
    providerSessionId: string;
    finalText: string;
    events: NativeLiveNormalizedEvent[];
    recoverable: boolean;
  }> {
    const [row] = await this.db
      .select({
        id: nativeLiveTurnPreparations.id,
        conversationId: nativeLiveTurnPreparations.conversationId,
        canonicalUserMessageId:
          nativeLiveTurnPreparations.canonicalUserMessageId,
        expectedWorkingDirectory:
          nativeLiveTurnPreparations.expectedWorkingDirectory,
        status: nativeLiveTurnPreparations.status,
        operation: nativeLiveTurnPreparations.operation,
        failureCode: nativeLiveTurnPreparations.failureCode,
      })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, userId),
          eq(nativeLiveTurnPreparations.id, prepareId),
        ),
      )
      .limit(1);

    if (!row || !row.canonicalUserMessageId) {
      throw new NativeLiveFailedTurnRecoveryError(
        "NOT_FOUND",
        "Failed turn was not found.",
      );
    }
    if (
      row.status !== "finalized_failure"
      || row.operation !== "edit"
      || row.failureCode !== "RUNTIME_UNAVAILABLE"
    ) {
      throw new NativeLiveFailedTurnRecoveryError(
        "NOT_RECOVERABLE",
        "Only failed edit turns with RUNTIME_UNAVAILABLE are recoverable by this tool.",
      );
    }

    const eventRows = await this.db
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
    const terminalSuccess =
      terminalResult?.payload?.status === "success";
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
      providerSessionId,
      finalText,
      events,
      recoverable:
        providerSessionId.length > 0
        && terminalSuccess
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
