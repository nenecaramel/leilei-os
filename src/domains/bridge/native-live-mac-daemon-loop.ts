import type {
  NativeLiveRuntimeCommand,
  NativeLiveRuntimeExecutionResult,
} from "./native-live-runtime-protocol.js";

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

      const reservation = await this.relay.reserveNext({
        listenerInstanceId: this.listenerInstanceId,
        dispatchTarget: "claude_code",
      });
      if (!reservation) return { outcome: "idle" };

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
