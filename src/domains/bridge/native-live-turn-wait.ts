import type {
  DrizzleNativeLiveBackendTurnPort,
  NativeLiveBackendTurnReadModel,
} from "./native-live-backend-turn-repository.js";
import type {
  NativeLiveWorkWakeBroker,
} from "./native-live-work-wake.js";

type TurnReader = Pick<
  DrizzleNativeLiveBackendTurnPort,
  "readTurn"
> & Partial<Pick<
  DrizzleNativeLiveBackendTurnPort,
  "recoverStaleDeliveryUnknownTurn"
>>;

export type NativeLiveTurnWaitResult =
  | {
      outcome: "terminal";
      turn: NativeLiveBackendTurnReadModel;
    }
  | {
      outcome: "timeout";
    };

export class NativeLiveTurnWaitService {
  constructor(
    private readonly turnReader: TurnReader,
    private readonly wakeBroker: Pick<
      NativeLiveWorkWakeBroker,
      "start" | "turnVersion" | "waitForTurnChange"
    > & {
      release?: () => Promise<void>;
    },
  ) {}

  async wait(input: {
    userId: string;
    prepareId: string;
    timeoutMs: number;
    signal?: AbortSignal | null;
  }): Promise<NativeLiveTurnWaitResult | null> {
    const read = async () => {
      await this.turnReader.recoverStaleDeliveryUnknownTurn?.({
        userId: input.userId,
        prepareId: input.prepareId,
      });
      return this.turnReader.readTurn({
        userId: input.userId,
        prepareId: input.prepareId,
      });
    };

    const immediate = await read();
    if (!immediate) return null;
    if (isTerminal(immediate)) {
      return {
        outcome: "terminal",
        turn: immediate,
      };
    }

    await this.wakeBroker.start();
    try {
      const version = this.wakeBroker.turnVersion(
        input.userId,
        input.prepareId,
      );

      const raced = await read();
      if (!raced) return null;
      if (isTerminal(raced)) {
        return {
          outcome: "terminal",
          turn: raced,
        };
      }

      const wake = await this.wakeBroker.waitForTurnChange({
        userId: input.userId,
        prepareId: input.prepareId,
        afterVersion: version,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });
      if (wake.outcome !== "ready") {
        return { outcome: "timeout" };
      }

      const terminal = await read();
      if (!terminal) return null;
      return isTerminal(terminal)
        ? {
            outcome: "terminal",
            turn: terminal,
          }
        : { outcome: "timeout" };
    } finally {
      await this.wakeBroker.release?.();
    }
  }
}

function isTerminal(
  turn: NativeLiveBackendTurnReadModel,
): boolean {
  return (
    turn.canonicalStatus === "finalized_success"
    || turn.canonicalStatus === "finalized_failure"
    || turn.dispatchStatus === "rejected"
  );
}
