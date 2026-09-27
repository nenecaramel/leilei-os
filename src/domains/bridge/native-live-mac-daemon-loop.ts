import type {
  NativeLiveRuntimeCommand,
  NativeLiveRuntimeExecutionResult,
} from "./native-live-runtime-protocol.js";
import type {
  BreathSemanticScorer,
} from "../runtime/breath-semantic-recall.js";
import type {
  NativeLiveSemanticFallbackCode,
  NativeLiveSemanticScoringReservation,
} from "./native-live-semantic-handshake.js";
import type {
  MindSemanticGroupingFallbackCode,
  MindSemanticGroupingReservation,
} from "../runtime/mind-semantic-grouping.js";
import type {
  NativeLiveBackgroundModelCommand,
  NativeLiveBackgroundModelExecutionResult,
} from "./native-live-background-model-protocol.js";
import type {
  NativeLiveNormalizedEvent,
} from "../conversation/native-live-conversation-orchestrator.js";
import type {
  NativeLiveMacActiveTurnController,
} from "./native-live-mac-claude-transport.js";

export type NativeLiveDaemonLeaseState = "acquired" | "renewed" | "busy";

export type NativeLiveDaemonReservation = {
  reservationId: string;
  command: NativeLiveRuntimeCommand;
};

export type NativeLiveProviderSessionCleanupReservation = {
  reservationId: string;
  providerSessionId: string;
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
      outcome: "mind_semantic_grouping_completed";
      reservationId: string;
    }
  | {
      outcome: "mind_semantic_grouping_delivery_unknown";
      reservationId: string;
    }
  | {
      outcome: "completed";
      reservationId: string;
      result: NativeLiveRuntimeExecutionResult;
      eventDeliveryFailures?: number;
      relayErrorCode?: string;
      finalizeCode?: string;
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

  reserveMindSemanticGrouping?(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<MindSemanticGroupingReservation | null>;

  submitMindSemanticGroupingScores?(input: {
    listenerInstanceId: string;
    reservationId: string;
    scores: Record<string, number>;
  }): Promise<void>;

  submitMindSemanticGroupingFallback?(input: {
    listenerInstanceId: string;
    reservationId: string;
    code: MindSemanticGroupingFallbackCode;
  }): Promise<void>;

  renewLease(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveDaemonLeaseState>;

  reserveNext(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveDaemonReservation | null>;

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
  }): Promise<void>;

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
  offer(): void | Promise<void>;
}

export interface NativeLiveProviderSessionCleanupExecutor {
  deleteSession(sessionId: string): Promise<void>;
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
  ) {}

  async runOnce(): Promise<NativeLiveDaemonRunOutcome> {
    if (this.running) {
      throw Object.assign(new Error("Native live daemon loop is already running."), {
        code: "NATIVE_LIVE_DAEMON_REENTRANT",
      });
    }

    this.running = true;
    try {
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
      });
      if (!reservation) {
        if (semanticReservationId) {
          return {
            outcome: "semantic_completed",
            reservationId: semanticReservationId,
          };
        }

        if (
          this.relay.reserveMindSemanticGrouping
          && this.relay.submitMindSemanticGroupingScores
          && this.relay.submitMindSemanticGroupingFallback
        ) {
          let grouping: MindSemanticGroupingReservation | null = null;
          try {
            grouping = await this.relay.reserveMindSemanticGrouping({
              listenerInstanceId: this.listenerInstanceId,
              dispatchTarget: "claude_code",
            });
          } catch {
            // Semantic grouping is optional background work. A rollout skew
            // or temporary endpoint failure must not suppress other idle work.
          }
          if (grouping) {
            let groupingScored = false;
            try {
              if (!this.semanticScorer) {
                await this.relay.submitMindSemanticGroupingFallback({
                  listenerInstanceId: this.listenerInstanceId,
                  reservationId: grouping.reservationId,
                  code: "E5_PROVIDER_UNAVAILABLE",
                });
              } else {
                const semanticScores = await this.semanticScorer.score({
                  query: grouping.query,
                  candidates: grouping.candidates,
                });
                await this.relay.submitMindSemanticGroupingScores({
                  listenerInstanceId: this.listenerInstanceId,
                  reservationId: grouping.reservationId,
                  scores: Object.fromEntries(semanticScores),
                });
                groupingScored = true;
              }
            } catch (error) {
              if (this.semanticScorer && isSemanticProviderFailure(error)) {
                try {
                  await this.relay.submitMindSemanticGroupingFallback({
                    listenerInstanceId: this.listenerInstanceId,
                    reservationId: grouping.reservationId,
                    code: semanticFallbackCode(error),
                  });
                } catch {
                  return {
                    outcome: "mind_semantic_grouping_delivery_unknown",
                    reservationId: grouping.reservationId,
                  };
                }
              } else {
                return {
                  outcome: "mind_semantic_grouping_delivery_unknown",
                  reservationId: grouping.reservationId,
                };
              }
            }
            if (groupingScored) {
              await this.bestEffortIdleOpportunity();
            }
            return {
              outcome: "mind_semantic_grouping_completed",
              reservationId: grouping.reservationId,
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
              await this.providerSessionCleanupExecutor.deleteSession(
                cleanup.providerSessionId,
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
      const flushRuntimeEvents = async (): Promise<void> => {
        if (
          !this.relay.appendRuntimeEvents
          || pendingRuntimeEvents.length === 0
        ) {
          return;
        }
        const batch = pendingRuntimeEvents;
        pendingRuntimeEvents = [];
        try {
          await this.relay.appendRuntimeEvents({
            listenerInstanceId:
              this.listenerInstanceId,
            reservationId:
              reservation.reservationId,
            events: batch,
          });
        } catch {
          // Runtime events are observability/UI data; the canonical terminal
          // result still carries the complete normalized event stream.
          // Do not blind-retry an ambiguously delivered batch.
          eventDeliveryFailures += batch.length;
        }
      };
      try {
        result = await this.executor.execute(
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
                    if (pendingRuntimeEvents.length >= 8) {
                      await flushRuntimeEvents();
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
        await flushRuntimeEvents();
      } catch {
        await flushRuntimeEvents();
        await this.bestEffortReject(reservation.reservationId, "INVALID_COMMAND");
        return {
          outcome: "rejected",
          reservationId: reservation.reservationId,
          code: "INVALID_COMMAND",
        };
      }

      try {
        await this.relay.submitResult({
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

      return {
        outcome: "completed",
        reservationId: reservation.reservationId,
        result,
        ...(eventDeliveryFailures > 0
          ? { eventDeliveryFailures }
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
          receipt = controller.sendUserMessage(text);
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
