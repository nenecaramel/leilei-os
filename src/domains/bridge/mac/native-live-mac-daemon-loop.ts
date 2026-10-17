import type { NativeLiveMacPersistentExecutor, NativeLiveMacPersistentExecution } from "./native-live-mac-persistent-executor.js";
import { failure as runtimeFailure } from "./native-live-mac-runtime-executor.js";
import type { NativeLiveMacResultOutbox } from "./native-live-mac-result-outbox.js";
import type {
  NativeLiveRuntimeCommand,
  NativeLiveRuntimeExecutionResult,
} from "../protocol/native-live-runtime-protocol.js";
import type {
  BreathSemanticScorer,
} from "../../runtime/breath/breath-semantic-recall.js";
import type {
  NativeLiveSemanticFallbackCode,
  NativeLiveSemanticScoringReservation,
} from "../mind/native-live-semantic-handshake.js";
import type {
  NativeLiveBackgroundModelCommand,
  NativeLiveBackgroundModelExecutionResult,
} from "../background/native-live-background-model-protocol.js";
import type {
  NativeLiveNormalizedEvent,
} from "../../conversation/native-live-conversation-orchestrator.js";
import type {
  NativeLiveMacActiveTurnController,
} from "./native-live-mac-claude-transport.js";
import type {
  NativeLiveManualCompactReservation,
  NativeLiveManualCompactSuccess,
} from "../turn/native-live-manual-compact.js";

export type NativeLiveDaemonLeaseState = "acquired" | "renewed" | "busy";

export type NativeLiveDaemonReservation = {
  reservationId: string;
  command: NativeLiveRuntimeCommand;
};

export type NativeLiveProviderSessionCleanupReservation = {
  reservationId: string;
  providerSessionId: string;
  effectiveWorkingDirectory: string | null;
};

export type NativeLiveBackgroundModelReservation = {
  reservationId: string;
  command: NativeLiveBackgroundModelCommand;
};

export type NativeLiveRuntimeControlReservation = {
  controlId: string;
  kind: "mid_turn_input" | "interrupt";
  payload: Record<string, unknown>;
};

export type NativeLiveDaemonRejectCode =
  | "INVALID_COMMAND"
  | "EXECUTION_START_FAILED";

export type NativeLiveResultSubmissionReceipt = {
  canonicalOutcome: string | null;
  nativeResumeCheckpointId?: string;
};

export type NativeLiveDaemonRunOutcome =
  | { outcome: "idle" }
  | { outcome: "busy" }
  | {
      outcome: "semantic_completed";
      reservationId: string;
    }
  | {
      outcome: "semantic_delivery_unknown";
      reservationId: string;
    }
  | {
      outcome: "completed";
      reservationId: string;
      result: NativeLiveRuntimeExecutionResult;
      eventDeliveryFailures?: number;
      relayErrorCode?: string;
      finalizeCode?: string;
      canonicalOutcome?: string;
    }
  | {
      outcome: "rejected";
      reservationId: string;
      code: NativeLiveDaemonRejectCode;
    }
  | {
      outcome: "delivery_unknown";
      reservationId: string;
      result: NativeLiveRuntimeExecutionResult;
      eventDeliveryFailures?: number;
    }
  | {
      outcome: "external_session_list_completed";
      reservationId: string;
    }
  | {
      outcome: "external_session_list_failed";
      reservationId: string;
    }
  | {
      outcome: "external_session_list_delivery_unknown";
      reservationId: string;
    }
  | {
      outcome: "manual_compact_completed";
      reservationId: string;
    }
  | {
      outcome: "manual_compact_failed";
      reservationId: string;
    }
  | {
      outcome: "manual_compact_delivery_unknown";
      reservationId: string;
    }
  | {
      outcome: "provider_session_cleanup_completed";
      reservationId: string;
    }
  | {
      outcome: "provider_session_cleanup_failed";
      reservationId: string;
    }
  | {
      outcome: "provider_session_cleanup_delivery_unknown";
      reservationId: string;
    }
  | {
      outcome: "background_completed";
      reservationId: string;
      result: NativeLiveBackgroundModelExecutionResult;
    }
  | {
      outcome: "background_delivery_unknown";
      reservationId: string;
      result: NativeLiveBackgroundModelExecutionResult;
    };

export interface NativeLiveMacDaemonRelayClient {
  createAttachmentDownloadSlot?(input: {
    attachmentId: string;
  }): Promise<{
    url: string;
    method: "GET";
    headers: Record<string, string>;
    attachment: {
      attachmentId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      kind: "image" | "file";
    };
  }>;

  reserveExternalSessions?(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<{ reservationId: string } | null>;

  submitExternalSessionsResult?(input: {
    listenerInstanceId: string;
    reservationId: string;
    outcome:
      | {
          status: "success";
          sessions: Array<{
            sessionId: string;
            summary: string | null;
            customTitle: string | null;
            firstPrompt: string | null;
            gitBranch: string | null;
            lastModified: number | null;
            createdAt: number | null;
            workingDirectory: string;
          }>;
        }
      | {
          status: "failure";
          failureCode: string;
        };
  }): Promise<void>;

  reserveManualCompact?(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveManualCompactReservation | null>;

  submitManualCompactResult?(input: {
    listenerInstanceId: string;
    reservationId: string;
    outcome:
      | {
          status: "success";
          result: NativeLiveManualCompactSuccess;
        }
      | {
          status: "failure";
          failureCode: string;
        };
  }): Promise<void>;

  reserveProviderSessionCleanup?(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveProviderSessionCleanupReservation | null>;

  submitProviderSessionCleanupResult?(input: {
    listenerInstanceId: string;
    reservationId: string;
    outcome:
      | { status: "success" }
      | { status: "failure"; failureCode: string };
  }): Promise<void>;

  reserveBackgroundModel?(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveBackgroundModelReservation | null>;

  submitBackgroundModelResult?(input: {
    listenerInstanceId: string;
    reservationId: string;
    result: NativeLiveBackgroundModelExecutionResult;
  }): Promise<void>;

  reserveSemanticScoring?(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveSemanticScoringReservation | null>;

  submitSemanticScores?(input: {
    listenerInstanceId: string;
    reservationId: string;
    scores: Record<string, number>;
  }): Promise<void>;

  submitSemanticFallback?(input: {
    listenerInstanceId: string;
    reservationId: string;
    code: NativeLiveSemanticFallbackCode;
  }): Promise<void>;

  renewLease(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveDaemonLeaseState>;

  reserveNext(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
    persistentSessions?: boolean;
  }): Promise<NativeLiveDaemonReservation | null>;

  checkTaskAdmission?(input: { listenerInstanceId:string;prepareId:string;providerSessionId:string }):Promise<boolean>;
  bindInput?(input: { listenerInstanceId: string; command: NativeLiveRuntimeCommand;
    phase: "queued" | "started"; commandUuid: string }): Promise<{
      userMessageId: string; parentProviderCheckpointId: string | null;
    } | null>;
  checkExecutionAdmission?(input: { listenerInstanceId: string; command: NativeLiveRuntimeCommand }): Promise<boolean>;
  renewExecutionLease?(input: { listenerInstanceId: string; command: NativeLiveRuntimeCommand }): Promise<boolean>;

  markExecutionStarted(input: {
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<void>;

  appendRuntimeEvents?(input: {
    listenerInstanceId: string;
    reservationId: string;
    events: ReadonlyArray<{
      sequence: number;
      event: NativeLiveNormalizedEvent;
    }>;
  }): Promise<void>;

  requestRuntimeInteraction?(input: {
    listenerInstanceId: string;
    reservationId: string;
    kind: "permission" | "question";
    request: Record<string, unknown>;
    signal: AbortSignal | null;
  }): Promise<Record<string, unknown>>;

  waitRuntimeControl?(input: {
    listenerInstanceId: string;
    reservationId: string;
    signal?: AbortSignal | null;
  }): Promise<NativeLiveRuntimeControlReservation | null>;

  completeRuntimeControl?(input: {
    listenerInstanceId: string;
    reservationId: string;
    controlId: string;
    outcome:
      | {
          status: "applied";
          receipt: Record<string, unknown>;
        }
      | {
          status: "failed";
          failureCode: string;
        };
  }): Promise<void>;

  submitResult(input: {
    listenerInstanceId: string;
    reservationId: string;
    result: NativeLiveRuntimeExecutionResult;
  }): Promise<NativeLiveResultSubmissionReceipt | void>;

  markResultDeliveryUnknown(input: {
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<void>;

  rejectReservation(input: {
    listenerInstanceId: string;
    reservationId: string;
    code: NativeLiveDaemonRejectCode;
  }): Promise<void>;
}

export interface NativeLivePreparedCommandExecutor {
  execute(
    command: unknown,
    options?: {
      onNormalizedEvent?: (
        event: NativeLiveNormalizedEvent,
      ) => void | Promise<void>;
      permissionHandler?: (
        request: Record<string, unknown>,
        context: { signal: AbortSignal | null },
      ) => Promise<Record<string, unknown>>;
      questionHandler?: (
        request: Record<string, unknown>,
        context: { signal: AbortSignal | null },
      ) => Promise<Record<string, unknown>>;
      controlPump?: (
        controller: NativeLiveMacActiveTurnController,
        context: { signal: AbortSignal },
      ) => Promise<void>;
    },
  ): Promise<NativeLiveRuntimeExecutionResult>;
}

export interface NativeLiveDaemonIdleOpportunity {
  // Scheduling results are intentionally ignored; completion is still awaited.
  offer(): void | Promise<unknown>;
}

export interface NativeLiveExternalSessionExecutor {
  listExternalSessions(): Promise<Array<{
    sessionId: string;
    summary: string | null;
    customTitle: string | null;
    firstPrompt: string | null;
    gitBranch: string | null;
    lastModified: number | null;
    createdAt: number | null;
    workingDirectory: string;
  }>>;
}

export interface NativeLiveManualCompactExecutor {
  compactSession(
    sessionId: string,
    expectedWorkingDirectory: string | null,
    providerCheckpointId?: string | null,
  ): Promise<{
    providerSessionId: string;
    providerCheckpointId?: string | null;
    contextUsage?: import("../protocol/native-live-runtime-protocol.js").NativeLiveRuntimeContextUsage | null;
    compaction?: {
      boundary?: Record<string, unknown> | null;
      postCompact?: Array<{
        summary?: string | null;
      }>;
    };
  }>;
}

export interface NativeLiveProviderSessionCleanupExecutor {
  deleteSession(
    sessionId: string,
    expectedWorkingDirectory: string | null,
  ): Promise<void>;
}

export interface NativeLiveBackgroundModelExecutor {
  execute(
    command: unknown,
  ): Promise<NativeLiveBackgroundModelExecutionResult>;
}

export class NativeLiveMacDaemonLoop {
  private running = false;

  constructor(
    private readonly listenerInstanceId: string,
    private readonly relay: NativeLiveMacDaemonRelayClient,
    private readonly executor: NativeLivePreparedCommandExecutor,
    private readonly semanticScorer: BreathSemanticScorer | null = null,
    private readonly idleOpportunity:
      NativeLiveDaemonIdleOpportunity | null = null,
    private readonly backgroundModelExecutor:
      NativeLiveBackgroundModelExecutor | null = null,
    private readonly providerSessionCleanupExecutor:
      NativeLiveProviderSessionCleanupExecutor | null = null,
    private readonly manualCompactExecutor:
      NativeLiveManualCompactExecutor | null = null,
    private readonly externalSessionExecutor:
      NativeLiveExternalSessionExecutor | null = null,
    private readonly resultOutbox: NativeLiveMacResultOutbox | null = null,
    private readonly persistentExecutor: (Pick<NativeLiveMacPersistentExecutor, "canRoute" | "execute" | "retire"> & Partial<Pick<NativeLiveMacPersistentExecutor, "assertAccepting" | "retireSession" | "shouldDeferWake">>) | null = null,
  ) {}

  async runOnce(): Promise<NativeLiveDaemonRunOutcome> {
    if (this.running) {
      throw Object.assign(new Error("Native live daemon loop is already running."), {
        code: "NATIVE_LIVE_DAEMON_REENTRANT",
      });
    }

    this.running = true;
    try {
      const pending = (await this.resultOutbox?.list())?.[0];
      if (pending) {
        let receipt: NativeLiveResultSubmissionReceipt | void;
        try {
          receipt = await this.relay.submitResult(pending);
        } catch {
          return { outcome: "delivery_unknown", reservationId: pending.reservationId, result: pending.result };
        }
        await this.resultOutbox!.acknowledge(pending);
        return { outcome: "completed", reservationId: pending.reservationId, result: pending.result,
          ...(receipt?.canonicalOutcome ? { canonicalOutcome: receipt.canonicalOutcome } : {}) };
      }
      const lease = await this.relay.renewLease({
        listenerInstanceId: this.listenerInstanceId,
        dispatchTarget: "claude_code",
      });
      if (lease === "busy") return { outcome: "busy" };

      let semanticReservationId: string | null = null;
      if (
        this.relay.reserveSemanticScoring
        && this.relay.submitSemanticScores
        && this.relay.submitSemanticFallback
      ) {
        const semantic = await this.relay.reserveSemanticScoring({
          listenerInstanceId: this.listenerInstanceId,
          dispatchTarget: "claude_code",
        });
        if (semantic) {
          semanticReservationId = semantic.reservationId;
          try {
            if (!this.semanticScorer) {
              await this.relay.submitSemanticFallback({
                listenerInstanceId: this.listenerInstanceId,
                reservationId: semantic.reservationId,
                code: "E5_PROVIDER_UNAVAILABLE",
              });
            } else {
              const scored = await this.semanticScorer.score({
                query: semantic.query,
                candidates: semantic.candidates,
              });
              await this.relay.submitSemanticScores({
                listenerInstanceId: this.listenerInstanceId,
                reservationId: semantic.reservationId,
                scores: Object.fromEntries(scored),
              });
            }
          } catch (error) {
            if (this.semanticScorer && isSemanticProviderFailure(error)) {
              try {
                await this.relay.submitSemanticFallback({
                  listenerInstanceId: this.listenerInstanceId,
                  reservationId: semantic.reservationId,
                  code: semanticFallbackCode(error),
                });
              } catch {
                return {
                  outcome: "semantic_delivery_unknown",
                  reservationId: semantic.reservationId,
                };
              }
            } else {
              return {
                outcome: "semantic_delivery_unknown",
                reservationId: semantic.reservationId,
              };
            }
          }
        }
      }

      const reservation = await this.relay.reserveNext({
        listenerInstanceId: this.listenerInstanceId,
        dispatchTarget: "claude_code",
        ...(this.persistentExecutor ? { persistentSessions: true } : {}),
      });
      if (!reservation) {
        if (semanticReservationId) {
          return {
            outcome: "semantic_completed",
            reservationId: semanticReservationId,
          };
        }

        if (
          this.externalSessionExecutor
          && this.relay.reserveExternalSessions
          && this.relay.submitExternalSessionsResult
        ) {
          const external =
            await this.relay.reserveExternalSessions({
              listenerInstanceId: this.listenerInstanceId,
              dispatchTarget: "claude_code",
            });
          if (external) {
            let sessions;
            try {
              sessions =
                await this.externalSessionExecutor
                  .listExternalSessions();
            } catch (error) {
              try {
                await this.relay.submitExternalSessionsResult({
                  listenerInstanceId: this.listenerInstanceId,
                  reservationId: external.reservationId,
                  outcome: {
                    status: "failure",
                    failureCode:
                      externalSessionFailureCode(error),
                  },
                });
              } catch {
                return {
                  outcome:
                    "external_session_list_delivery_unknown",
                  reservationId: external.reservationId,
                };
              }
              return {
                outcome: "external_session_list_failed",
                reservationId: external.reservationId,
              };
            }

            try {
              await this.relay.submitExternalSessionsResult({
                listenerInstanceId: this.listenerInstanceId,
                reservationId: external.reservationId,
                outcome: {
                  status: "success",
                  sessions,
                },
              });
            } catch {
              return {
                outcome:
                  "external_session_list_delivery_unknown",
                reservationId: external.reservationId,
              };
            }
            return {
              outcome: "external_session_list_completed",
              reservationId: external.reservationId,
            };
          }
        }

        if (
          this.manualCompactExecutor
          && this.relay.reserveManualCompact
          && this.relay.submitManualCompactResult
        ) {
          const compact =
            await this.relay.reserveManualCompact({
              listenerInstanceId: this.listenerInstanceId,
              dispatchTarget: "claude_code",
            });
          if (compact) {
            let result;
            try {
              await this.persistentExecutor?.retireSession?.(compact.providerSessionId);
              result =
                await this.manualCompactExecutor.compactSession(
                  compact.providerSessionId,
                  compact.effectiveWorkingDirectory,
                  compact.providerCheckpointId ?? null,
                );
            } catch (error) {
              try {
                await this.relay.submitManualCompactResult({
                  listenerInstanceId: this.listenerInstanceId,
                  reservationId: compact.reservationId,
                  outcome: {
                    status: "failure",
                    failureCode:
                      manualCompactFailureCode(error),
                  },
                });
              } catch {
                return {
                  outcome: "manual_compact_delivery_unknown",
                  reservationId: compact.reservationId,
                };
              }
              return {
                outcome: "manual_compact_failed",
                reservationId: compact.reservationId,
              };
            }

            const summary =
              result.compaction?.postCompact
                ?.map((item) => item.summary ?? null)
                .filter(
                  (value): value is string =>
                    typeof value === "string"
                    && value.trim().length > 0,
                )
                .at(-1) ?? null;
            try {
              await this.relay.submitManualCompactResult({
                listenerInstanceId: this.listenerInstanceId,
                reservationId: compact.reservationId,
                outcome: {
                  status: "success",
                  result: {
                    providerSessionId:
                      result.providerSessionId,
                    providerCheckpointId: result.providerCheckpointId ?? null,
                    contextUsage:
                      result.contextUsage ?? null,
                    boundary:
                      result.compaction?.boundary ?? null,
                    summary,
                  },
                },
              });
            } catch {
              return {
                outcome: "manual_compact_delivery_unknown",
                reservationId: compact.reservationId,
              };
            }
            return {
              outcome: "manual_compact_completed",
              reservationId: compact.reservationId,
            };
          }
        }

        if (
          this.providerSessionCleanupExecutor
          && this.relay.reserveProviderSessionCleanup
          && this.relay.submitProviderSessionCleanupResult
        ) {
          const cleanup =
            await this.relay.reserveProviderSessionCleanup({
              listenerInstanceId: this.listenerInstanceId,
              dispatchTarget: "claude_code",
            });
          if (cleanup) {
            try {
              await this.persistentExecutor?.retireSession?.(cleanup.providerSessionId);
              await this.providerSessionCleanupExecutor.deleteSession(
                cleanup.providerSessionId,
                cleanup.effectiveWorkingDirectory,
              );
            } catch {
              try {
                await this.relay.submitProviderSessionCleanupResult({
                  listenerInstanceId: this.listenerInstanceId,
                  reservationId: cleanup.reservationId,
                  outcome: {
                    status: "failure",
                    failureCode: "DELETE_SESSION_FAILED",
                  },
                });
              } catch {
                return {
                  outcome:
                    "provider_session_cleanup_delivery_unknown",
                  reservationId: cleanup.reservationId,
                };
              }
              return {
                outcome: "provider_session_cleanup_failed",
                reservationId: cleanup.reservationId,
              };
            }

            try {
              await this.relay.submitProviderSessionCleanupResult({
                listenerInstanceId: this.listenerInstanceId,
                reservationId: cleanup.reservationId,
                outcome: { status: "success" },
              });
            } catch {
              return {
                outcome:
                  "provider_session_cleanup_delivery_unknown",
                reservationId: cleanup.reservationId,
              };
            }
            return {
              outcome: "provider_session_cleanup_completed",
              reservationId: cleanup.reservationId,
            };
          }
        }

        if (
          this.backgroundModelExecutor
          && this.relay.reserveBackgroundModel
          && this.relay.submitBackgroundModelResult
        ) {
          const background =
            await this.relay.reserveBackgroundModel({
              listenerInstanceId: this.listenerInstanceId,
              dispatchTarget: "claude_code",
            });
          if (background) {
            const result =
              await this.backgroundModelExecutor.execute(
                background.command,
              );
            try {
              await this.relay.submitBackgroundModelResult({
                listenerInstanceId: this.listenerInstanceId,
                reservationId: background.reservationId,
                result,
              });
            } catch {
              return {
                outcome: "background_delivery_unknown",
                reservationId: background.reservationId,
                result,
              };
            }
            return {
              outcome: "background_completed",
              reservationId: background.reservationId,
              result,
            };
          }
        }

        await this.bestEffortIdleOpportunity();
        return { outcome: "idle" };
      }

      if (reservation.command.operation === "wake"
        && !this.persistentExecutor?.canRoute(reservation.command)
        && this.persistentExecutor?.shouldDeferWake?.(reservation.command)) {
        // Foreground work or the bounded writer capacity is temporarily busy.
        // Do not mark this Wake started, submit a model request or close any
        // SDK writer. Keep the same durable reservation pending for retry.
        await this.bestEffortReject(reservation.reservationId, "EXECUTION_START_FAILED");
        return { outcome: "rejected", reservationId: reservation.reservationId, code: "EXECUTION_START_FAILED" };
      }
      try {
        await this.relay.markExecutionStarted({
          listenerInstanceId: this.listenerInstanceId,
          reservationId: reservation.reservationId,
        });
      } catch {
        await this.bestEffortReject(
          reservation.reservationId,
          "EXECUTION_START_FAILED",
        );
        return {
          outcome: "rejected",
          reservationId: reservation.reservationId,
          code: "EXECUTION_START_FAILED",
        };
      }

      let result: NativeLiveRuntimeExecutionResult;
      let eventSequence = 0;
      let eventDeliveryFailures = 0;
      let pendingRuntimeEvents: Array<{
        sequence: number;
        event: NativeLiveNormalizedEvent;
      }> = [];
      let runtimeEventFlush: Promise<void> | null = null;
      const flushRuntimeEvents = async (): Promise<void> => {
        if (runtimeEventFlush) {
          await runtimeEventFlush;
          if (pendingRuntimeEvents.length > 0) {
            await flushRuntimeEvents();
          }
          return;
        }
        if (
          !this.relay.appendRuntimeEvents
          || pendingRuntimeEvents.length === 0
        ) {
          return;
        }
        // Keep one ordered upload in flight. Deltas arriving during network
        // latency join the next batch instead of blocking the SDK callback queue.
        // 32 is the existing server protocol limit; sparse turns still flush at 8.
        const drain = (async () => {
          while (pendingRuntimeEvents.length > 0) {
            const batch = pendingRuntimeEvents.splice(0, 32);
            try {
              await this.relay.appendRuntimeEvents!({
                listenerInstanceId: this.listenerInstanceId,
                reservationId: reservation.reservationId,
                events: batch,
              });
            } catch {
              // The HTTP relay client already bounded-retries this exact,
              // idempotent sequence batch on transient transport / 5xx failures.
              // Once that budget is exhausted, stay fail-soft: the terminal
              // result still carries the canonical fallback event set. Runtime-only
              // observability is intentionally not duplicated into the result body.
              eventDeliveryFailures += batch.length;
            }
          }
        })();
        runtimeEventFlush = drain;
        try {
          await drain;
        } finally {
          runtimeEventFlush = null;
        }
      };
      let persistentRun: NativeLiveMacPersistentExecution | null = null;
      const commit = async (value: NativeLiveRuntimeExecutionResult) => {
        const entry = { listenerInstanceId: this.listenerInstanceId, reservationId: reservation.reservationId, result: value };
        await this.resultOutbox?.save(entry);
        await flushRuntimeEvents();
        const receipt = await this.relay.submitResult(entry);
        await this.resultOutbox?.acknowledge(entry);
        return receipt;
      };
      const execute = async (command: NativeLiveRuntimeCommand, options: Parameters<NativeLivePreparedCommandExecutor["execute"]>[1]) => {
        this.persistentExecutor?.assertAccepting?.(command.conversation_id);
        // Edit/retry replaces the visible branch. Retire its old writer BEFORE
        // asking the new fork to open; the replaced native schedule must never
        // keep running in parallel with a different presentation branch.
        if (command.operation === "edit" || command.operation === "retry") {
          await this.persistentExecutor?.retire(command.conversation_id);
        }
        if (command.operation === "wake") {
          // Wake NEVER reaches the branch/fork/one-shot execution below.
          // A missing or mismatched live writer is a failed Wake, not a
          // reason to close the writer currently holding native schedules.
          if (command.runtime_mode !== "resume" || !this.persistentExecutor?.canRoute(command)) {
            return runtimeFailure(command, "NO_PROVIDER_SESSION");
          }
          persistentRun = await this.persistentExecutor.execute(command, { ...options, commit });
          return persistentRun.result;
        }
        if (this.persistentExecutor?.canRoute(command)) {
          persistentRun = await this.persistentExecutor.execute(command, { ...options, commit });
          return persistentRun.result;
        }
        await this.persistentExecutor?.retire(command.conversation_id);
        return this.executor.execute(command, options);
      };
      try {
        result = await execute(
          reservation.command,
          {
            ...(this.relay.appendRuntimeEvents
              ? {
                  onNormalizedEvent: async (event: NativeLiveNormalizedEvent) => {
                    eventSequence += 1;
                    pendingRuntimeEvents.push({
                      sequence: eventSequence,
                      event,
                    });
                    // Clock boundaries must reach the repository independently even on sparse turns.
                    if ((event.type === "runtime" && event.payload?.kind === "provider_message_start")
                        || event.type === "result" || event.type === "error") {
                      await flushRuntimeEvents();
                    } else if (pendingRuntimeEvents.length >= 8 && !runtimeEventFlush) {
                      void flushRuntimeEvents();
                    }
                  },
                }
              : {}),
            ...(this.relay.requestRuntimeInteraction
              ? {
                  permissionHandler: async (
                    request: Record<string, unknown>,
                    context: { signal: AbortSignal | null },
                  ) =>
                    this.relay.requestRuntimeInteraction!({
                      listenerInstanceId:
                        this.listenerInstanceId,
                      reservationId:
                        reservation.reservationId,
                      kind: "permission",
                      request,
                      signal: context.signal,
                    }),
                  questionHandler: async (
                    request: Record<string, unknown>,
                    context: { signal: AbortSignal | null },
                  ) =>
                    this.relay.requestRuntimeInteraction!({
                      listenerInstanceId:
                        this.listenerInstanceId,
                      reservationId:
                        reservation.reservationId,
                      kind: "question",
                      request,
                      signal: context.signal,
                    }),
                }
              : {}),
            ...(this.relay.waitRuntimeControl
              && this.relay.completeRuntimeControl
              ? {
                  controlPump: (
                    controller: NativeLiveMacActiveTurnController,
                    context: { signal: AbortSignal },
                  ) =>
                    this.runRuntimeControlPump(
                      reservation.reservationId,
                      controller,
                      context.signal,
                    ),
                }
              : {}),
          },
        );
      } catch {
        await flushRuntimeEvents();
        await this.bestEffortReject(reservation.reservationId, "INVALID_COMMAND");
        return {
          outcome: "rejected",
          reservationId: reservation.reservationId,
          code: "INVALID_COMMAND",
        };
      }

      const persistent = persistentRun as NativeLiveMacPersistentExecution | null;
      if (persistent && persistent.delivery !== "pending") {
        if (persistent.delivery === "unknown") await this.bestEffortDeliveryUnknown(reservation.reservationId);
        return { outcome: persistent.delivery === "unknown" ? "delivery_unknown" : "completed",
          reservationId: reservation.reservationId, result,
          ...(persistent.canonicalOutcome ? { canonicalOutcome: persistent.canonicalOutcome } : {}),
          ...(eventDeliveryFailures ? { eventDeliveryFailures } : {}) };
      }
      const pendingResult = {
        listenerInstanceId: this.listenerInstanceId,
        reservationId: reservation.reservationId,
        result,
      };
      await this.resultOutbox?.save(pendingResult);
      await flushRuntimeEvents();
      let submission:
        NativeLiveResultSubmissionReceipt | void;
      try {
        submission = await this.relay.submitResult({
          listenerInstanceId: this.listenerInstanceId,
          reservationId: reservation.reservationId,
          result,
        });
      } catch (error) {
        await this.bestEffortDeliveryUnknown(reservation.reservationId);
        const diagnostics = relayFailureDiagnostics(error);
        return {
          outcome: "delivery_unknown",
          reservationId: reservation.reservationId,
          result,
          ...(eventDeliveryFailures > 0
            ? { eventDeliveryFailures }
            : {}),
          ...(diagnostics.relayErrorCode
            ? { relayErrorCode: diagnostics.relayErrorCode }
            : {}),
          ...(diagnostics.finalizeCode
            ? { finalizeCode: diagnostics.finalizeCode }
            : {}),
        };
      }

      await this.resultOutbox?.acknowledge(pendingResult);
      return {
        outcome: "completed",
        reservationId: reservation.reservationId,
        result,
        ...(eventDeliveryFailures > 0
          ? { eventDeliveryFailures }
          : {}),
        ...(submission?.canonicalOutcome
          ? {
              canonicalOutcome:
                submission.canonicalOutcome,
            }
          : {}),
      };
    } finally {
      this.running = false;
    }
  }

  private async runRuntimeControlPump(
    reservationId: string,
    controller: NativeLiveMacActiveTurnController,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      let control: NativeLiveRuntimeControlReservation | null;
      try {
        control = await this.relay.waitRuntimeControl!({
          listenerInstanceId: this.listenerInstanceId,
          reservationId,
          signal,
        });
      } catch {
        if (signal.aborted) return;
        await delayWithAbort(1_000, signal);
        continue;
      }

      if (!control) {
        continue;
      }

      try {
        let receipt: Record<string, unknown>;
        if (control.kind === "mid_turn_input") {
          const text = control.payload.text;
          if (typeof text !== "string" || text.trim().length === 0) {
            throw Object.assign(
              new Error("Invalid mid-turn control payload."),
              { controlCode: "INVALID_CONTROL_PAYLOAD" },
            );
          }
          receipt = await controller.sendUserMessage(text, {
            uuid: control.controlId,
          });
        } else {
          receipt = await controller.interrupt();
        }

        try {
          await this.relay.completeRuntimeControl!({
            listenerInstanceId: this.listenerInstanceId,
            reservationId,
            controlId: control.controlId,
            outcome: {
              status: "applied",
              receipt,
            },
          });
        } catch {
          // The control was already applied to the provider. Never re-apply
          // after an ambiguous completion callback.
        }

        if (control.kind === "interrupt") return;
      } catch (error) {
        try {
          await this.relay.completeRuntimeControl!({
            listenerInstanceId: this.listenerInstanceId,
            reservationId,
            controlId: control.controlId,
            outcome: {
              status: "failed",
              failureCode:
                runtimeControlFailureCode(error),
            },
          });
        } catch {
          // Failure reporting is idempotent but best-effort. The reserved row
          // prevents a blind re-application of an uncertain provider control.
        }
      }
    }
  }

  private async bestEffortIdleOpportunity(): Promise<void> {
    try {
      await this.idleOpportunity?.offer();
    } catch {
      // Background opportunity failure must never turn an idle poll into
      // foreground Native Live failure.
    }
  }

  private async bestEffortReject(
    reservationId: string,
    code: NativeLiveDaemonRejectCode,
  ): Promise<void> {
    try {
      await this.relay.rejectReservation({
        listenerInstanceId: this.listenerInstanceId,
        reservationId,
        code,
      });
    } catch {
      // The caller only needs the local run outcome. A relay implementation
      // must reconcile ambiguous rejection separately rather than blind-retry.
    }
  }

  private async bestEffortDeliveryUnknown(
    reservationId: string,
  ): Promise<void> {
    try {
      await this.relay.markResultDeliveryUnknown({
        listenerInstanceId: this.listenerInstanceId,
        reservationId,
      });
    } catch {
      // Never blind-retry a result callback whose delivery outcome is unknown.
    }
  }
}

function isSemanticProviderFailure(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (
      (error as { code?: unknown }).code === "PROVIDER_NOT_PREPARED"
      || (error as { code?: unknown }).code === "PROVIDER_LOAD_FAILED"
      || (error as { code?: unknown }).code === "INVALID_EMBEDDING_OUTPUT"
    )
  );
}

function semanticFallbackCode(
  error: unknown,
): NativeLiveSemanticFallbackCode {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "PROVIDER_NOT_PREPARED"
  )
    ? "E5_PROVIDER_UNAVAILABLE"
    : "E5_SCORING_FAILED";
}

function externalSessionFailureCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "runtimeCode" in error
    && typeof (error as { runtimeCode?: unknown }).runtimeCode === "string"
  ) {
    return (error as { runtimeCode: string }).runtimeCode;
  }
  return "SESSION_LIST_FAILED";
}

function manualCompactFailureCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "runtimeCode" in error
    && typeof (error as { runtimeCode?: unknown }).runtimeCode === "string"
  ) {
    return (error as { runtimeCode: string }).runtimeCode;
  }
  return "COMPACT_FAILED";
}

function runtimeControlFailureCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "controlCode" in error
    && typeof (error as { controlCode?: unknown }).controlCode === "string"
  ) {
    return (error as { controlCode: string }).controlCode;
  }
  if (
    typeof error === "object"
    && error !== null
    && "runtimeCode" in error
    && typeof (error as { runtimeCode?: unknown }).runtimeCode === "string"
  ) {
    return (error as { runtimeCode: string }).runtimeCode;
  }
  return "CONTROL_APPLICATION_FAILED";
}

function delayWithAbort(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function relayFailureDiagnostics(error: unknown): {
  relayErrorCode: string | null;
  finalizeCode: string | null;
} {
  if (!error || typeof error !== "object") {
    return { relayErrorCode: null, finalizeCode: null };
  }
  const record = error as {
    relayCode?: unknown;
    finalizeCode?: unknown;
  };
  return {
    relayErrorCode:
      typeof record.relayCode === "string"
        ? record.relayCode
        : null,
    finalizeCode:
      typeof record.finalizeCode === "string"
        ? record.finalizeCode
        : null,
  };
}
