import type {
  NativeLiveDaemonLeaseState,
  NativeLiveDaemonRejectCode,
  NativeLiveDaemonReservation,
  NativeLiveMacDaemonRelayClient,
} from "./native-live-mac-daemon-loop.js";
import {
  parseNativeLiveRuntimeCommand,
  type NativeLiveRuntimeExecutionResult,
} from "./native-live-runtime-protocol.js";
import type {
  NativeLiveSemanticFallbackCode,
  NativeLiveSemanticScoringReservation,
} from "./native-live-semantic-handshake.js";
import {
  parseNativeLiveBackgroundModelCommand,
  type NativeLiveBackgroundModelExecutionResult,
} from "./native-live-background-model-protocol.js";

type FetchLike = typeof fetch;

export class NativeLiveMacHttpRelayClient
implements NativeLiveMacDaemonRelayClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    if (!this.baseUrl) throw new Error("Native live relay base URL is required.");
    if (!token.trim()) throw new Error("Native live relay token is required.");
  }

  async reserveSemanticScoring(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveSemanticScoringReservation | null> {
    const data = await this.post("/semantic/reserve", {
      listener_instance_id: input.listenerInstanceId,
      dispatch_target: input.dispatchTarget,
    });
    if (data === null) return null;

    const record = readRecord(data);
    if (
      typeof record.reservationId !== "string"
      || typeof record.query !== "string"
      || !Array.isArray(record.candidates)
    ) {
      throw new Error("Native live semantic reservation is invalid.");
    }

    return {
      reservationId: record.reservationId,
      query: record.query,
      candidates: record.candidates.map((candidate) => {
        const item = readRecord(candidate);
        if (
          typeof item.stateId !== "string"
          || (item.kind !== "memory" && item.kind !== "feel")
          || typeof item.text !== "string"
        ) {
          throw new Error("Native live semantic candidate is invalid.");
        }
        return {
          stateId: item.stateId,
          kind: item.kind,
          text: item.text,
        };
      }),
    };
  }

  async submitSemanticScores(input: {
    listenerInstanceId: string;
    reservationId: string;
    scores: Record<string, number>;
  }): Promise<void> {
    await this.post(
      `/semantic/reservations/${encodeURIComponent(input.reservationId)}/scores`,
      {
        listener_instance_id: input.listenerInstanceId,
        scores: input.scores,
      },
    );
  }

  async submitSemanticFallback(input: {
    listenerInstanceId: string;
    reservationId: string;
    code: NativeLiveSemanticFallbackCode;
  }): Promise<void> {
    await this.post(
      `/semantic/reservations/${encodeURIComponent(input.reservationId)}/fallback`,
      {
        listener_instance_id: input.listenerInstanceId,
        code: input.code,
      },
    );
  }

  async reserveBackgroundModel(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }) {
    const data = await this.post("/background-model/reserve", {
      listener_instance_id: input.listenerInstanceId,
      dispatch_target: input.dispatchTarget,
    });
    if (data === null) return null;
    const record = readRecord(data);
    if (typeof record.reservationId !== "string") {
      throw new Error(
        "Native live background model reservation id is invalid.",
      );
    }
    return {
      reservationId: record.reservationId,
      command: parseNativeLiveBackgroundModelCommand(
        record.command,
      ),
    };
  }

  async submitBackgroundModelResult(input: {
    listenerInstanceId: string;
    reservationId: string;
    result: NativeLiveBackgroundModelExecutionResult;
  }): Promise<void> {
    await this.post(
      `/background-model/reservations/${encodeURIComponent(input.reservationId)}/result`,
      {
        listener_instance_id: input.listenerInstanceId,
        result: input.result,
      },
    );
  }

  async offerTopicResurfaceOpportunity(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<unknown> {
    return this.post(
      "/background-model/topic-resurface/opportunity",
      {
        listener_instance_id: input.listenerInstanceId,
        dispatch_target: input.dispatchTarget,
      },
    );
  }

  async renewLease(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveDaemonLeaseState> {
    const data = await this.post("/lease/renew", {
      listener_instance_id: input.listenerInstanceId,
      dispatch_target: input.dispatchTarget,
    });
    const state = readRecord(data).state;
    if (state !== "acquired" && state !== "renewed" && state !== "busy") {
      throw new Error("Native live relay returned an invalid lease state.");
    }
    return state;
  }

  async reserveNext(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveDaemonReservation | null> {
    const data = await this.post("/reserve", {
      listener_instance_id: input.listenerInstanceId,
      dispatch_target: input.dispatchTarget,
    });
    if (data === null) return null;
    const record = readRecord(data);
    if (typeof record.reservationId !== "string") {
      throw new Error("Native live relay reservation id is invalid.");
    }
    return {
      reservationId: record.reservationId,
      command: parseNativeLiveRuntimeCommand(record.command),
    };
  }

  async markExecutionStarted(input: {
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<void> {
    await this.post(
      `/reservations/${encodeURIComponent(input.reservationId)}/execution-started`,
      { listener_instance_id: input.listenerInstanceId },
    );
  }

  async submitResult(input: {
    listenerInstanceId: string;
    reservationId: string;
    result: NativeLiveRuntimeExecutionResult;
  }): Promise<void> {
    await this.post(
      `/reservations/${encodeURIComponent(input.reservationId)}/result`,
      {
        listener_instance_id: input.listenerInstanceId,
        result: input.result,
      },
    );
  }

  async markResultDeliveryUnknown(input: {
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<void> {
    await this.post(
      `/reservations/${encodeURIComponent(input.reservationId)}/delivery-unknown`,
      { listener_instance_id: input.listenerInstanceId },
    );
  }

  async rejectReservation(input: {
    listenerInstanceId: string;
    reservationId: string;
    code: NativeLiveDaemonRejectCode;
  }): Promise<void> {
    await this.post(
      `/reservations/${encodeURIComponent(input.reservationId)}/reject`,
      {
        listener_instance_id: input.listenerInstanceId,
        code: input.code,
      },
    );
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/internal/native-live-relay${path}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Native live relay returned malformed JSON.");
    }

    const record = readRecord(payload);
    if (!response.ok || record.success !== true) {
      throw new Error("Native live relay request failed.");
    }
    return record.data;
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Native live relay response is invalid.");
  }
  return value as Record<string, unknown>;
}
