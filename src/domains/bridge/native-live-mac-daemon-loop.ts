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
  NativeLiveBackgroundModelCommand,
  NativeLiveBackgroundModelExecutionResult,
} from "./native-live-background-model-protocol.js";
import type {
  NativeLiveNormalizedEvent,
} from "../conversation/native-live-conversation-orchestrator.js";

export type NativeLiveDaemonLeaseState = "acquired" | "renewed" | "busy";

export type NativeLiveDaemonReservation = {
  reservationId: string;
  command: NativeLiveRuntimeCommand;
};

export type NativeLiveBackgroundModelReservation = {
  reservationId: string;
  command: NativeLiveBackgroundModelCommand;
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
      outcome: "completed";
      reservationId: string;
      result: NativeLiveRuntimeExecutionResult;
      eventDeliveryFailures?: number;
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
  }): Promise<NativeLiveDaemonReservation | null>;

  markExecutionStarted(input: {
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<void>;

  appendRuntimeEvent?(input: {
    listenerInstanceId: string;
    reservationId: string;
    sequence: number;
    event: NativeLiveNormalizedEvent;
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
    },
  ): Promise<NativeLiveRuntimeExecutionResult>;
}

export interface NativeLiveDaemonIdleOpportunity {
  offer(): void | Promise<void>;
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
      try {
        result = await this.executor.execute(
          reservation.command,
          this.relay.appendRuntimeEvent
            ? {
                onNormalizedEvent: async (event) => {
                  eventSequence += 1;
                  try {
                    await this.relay.appendRuntimeEvent!({
                      listenerInstanceId:
                        this.listenerInstanceId,
                      reservationId:
                        reservation.reservationId,
                      sequence: eventSequence,
                      event,
                    });
                  } catch {
                    eventDeliveryFailures += 1;
                  }
                },
              }
            : {},
        );
      } catch {
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
      } catch {
        await this.bestEffortDeliveryUnknown(reservation.reservationId);
        return {
          outcome: "delivery_unknown",
          reservationId: reservation.reservationId,
          result,
          ...(eventDeliveryFailures > 0
            ? { eventDeliveryFailures }
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

