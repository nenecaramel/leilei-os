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

export type NativeLiveDaemonLeaseState = "acquired" | "renewed" | "busy";

export type NativeLiveDaemonReservation = {
  reservationId: string;
  command: NativeLiveRuntimeCommand;
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
    };

export interface NativeLiveMacDaemonRelayClient {
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
  execute(command: unknown): Promise<NativeLiveRuntimeExecutionResult>;
}

export class NativeLiveMacDaemonLoop {
  private running = false;

  constructor(
    private readonly listenerInstanceId: string,
    private readonly relay: NativeLiveMacDaemonRelayClient,
    private readonly executor: NativeLivePreparedCommandExecutor,
    private readonly semanticScorer: BreathSemanticScorer | null = null,
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
        return semanticReservationId
          ? {
              outcome: "semantic_completed",
              reservationId: semanticReservationId,
            }
          : { outcome: "idle" };
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
      try {
        result = await this.executor.execute(reservation.command);
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
        };
      }

      return {
        outcome: "completed",
        reservationId: reservation.reservationId,
        result,
      };
    } finally {
      this.running = false;
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
\nfunction isSemanticProviderFailure(error: unknown): boolean {
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

