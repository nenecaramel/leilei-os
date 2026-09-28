import { randomUUID } from "node:crypto";
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
import type {
  MindSemanticGroupingFallbackCode,
  MindSemanticGroupingReservation,
} from "../runtime/mind-semantic-grouping.js";

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

  async reserveMindSemanticGrouping(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<MindSemanticGroupingReservation | null> {
    const data = await this.post("/mind-semantic-grouping/reserve", {
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
      throw new Error("Mind semantic grouping reservation is invalid.");
    }
    return {
      reservationId: record.reservationId,
      query: record.query,
      candidates: record.candidates.map((candidate) => {
        const item = readRecord(candidate);
        if (
          typeof item.stateId !== "string"
          || (
            item.kind !== "drive"
            && item.kind !== "thought"
            && item.kind !== "curiosity"
            && item.kind !== "topic"
          )
          || typeof item.text !== "string"
        ) {
          throw new Error("Mind semantic grouping candidate is invalid.");
        }
        return {
          stateId: item.stateId,
          kind: item.kind,
          text: item.text,
        };
      }),
    };
  }

  async submitMindSemanticGroupingScores(input: {
    listenerInstanceId: string;
    reservationId: string;
    scores: Record<string, number>;
  }): Promise<void> {
    await this.post(
      `/mind-semantic-grouping/reservations/${encodeURIComponent(input.reservationId)}/scores`,
      {
        listener_instance_id: input.listenerInstanceId,
        scores: input.scores,
      },
    );
  }

  async submitMindSemanticGroupingFallback(input: {
    listenerInstanceId: string;
    reservationId: string;
    code: MindSemanticGroupingFallbackCode;
  }): Promise<void> {
    await this.post(
      `/mind-semantic-grouping/reservations/${encodeURIComponent(input.reservationId)}/fallback`,
      {
        listener_instance_id: input.listenerInstanceId,
        code: input.code,
      },
    );
  }

  async reserveProviderSessionCleanup(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }) {
    const data = await this.post(
      "/provider-session-cleanup/reserve",
      {
        listener_instance_id: input.listenerInstanceId,
        dispatch_target: input.dispatchTarget,
      },
    );
    if (data === null) return null;
    const record = readRecord(data);
    if (
      typeof record.reservationId !== "string"
      || typeof record.providerSessionId !== "string"
      || !record.providerSessionId.trim()
      || !(
        record.workspaceId === undefined
        || record.workspaceId === null
        || typeof record.workspaceId === "string"
      )
      || !(
        record.effectiveWorkspaceRoot === undefined
        || record.effectiveWorkspaceRoot === null
        || (
          typeof record.effectiveWorkspaceRoot === "string"
          && record.effectiveWorkspaceRoot.trim()
        )
      )
    ) {
      throw new Error(
        "Native live provider session cleanup reservation is invalid.",
      );
    }
    return {
      reservationId: record.reservationId,
      providerSessionId: record.providerSessionId,
      workspaceId:
        typeof record.workspaceId === "string"
          ? record.workspaceId
          : null,
      effectiveWorkspaceRoot:
        typeof record.effectiveWorkspaceRoot === "string"
          ? record.effectiveWorkspaceRoot
          : null,
    };
  }

  async submitProviderSessionCleanupResult(input: {
    listenerInstanceId: string;
    reservationId: string;
    outcome:
      | { status: "success" }
      | { status: "failure"; failureCode: string };
  }): Promise<void> {
    await this.post(
      `/provider-session-cleanup/reservations/${encodeURIComponent(input.reservationId)}/result`,
      input.outcome.status === "success"
        ? {
            listener_instance_id: input.listenerInstanceId,
            status: "success",
          }
        : {
            listener_instance_id: input.listenerInstanceId,
            status: "failure",
            failure_code: input.outcome.failureCode,
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

  async offerCompanionBackgroundOpportunity(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
    reason: "startup" | "dirty" | "due";
  }): Promise<unknown> {
    return this.post(
      "/background/opportunity",
      {
        listener_instance_id: input.listenerInstanceId,
        dispatch_target: input.dispatchTarget,
        reason: input.reason,
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

  async waitForWork(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
    signal?: AbortSignal | null;
  }): Promise<"ready" | "timeout" | "busy"> {
    const data = await this.post(
      "/work/wait",
      {
        listener_instance_id: input.listenerInstanceId,
        dispatch_target: input.dispatchTarget,
      },
      input.signal ?? null,
    );
    const outcome = readRecord(data).outcome;
    if (
      outcome !== "ready"
      && outcome !== "timeout"
      && outcome !== "busy"
    ) {
      throw new Error("Native live work wait returned an invalid outcome.");
    }
    return outcome;
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

  async appendRuntimeEvents(input: {
    listenerInstanceId: string;
    reservationId: string;
    events: ReadonlyArray<{
      sequence: number;
      event: import("../conversation/native-live-conversation-orchestrator.js").NativeLiveNormalizedEvent;
    }>;
  }): Promise<void> {
    await this.post(
      `/reservations/${encodeURIComponent(input.reservationId)}/events/batch`,
      {
        listener_instance_id: input.listenerInstanceId,
        events: input.events,
      },
    );
  }

  async requestRuntimeInteraction(input: {
    listenerInstanceId: string;
    reservationId: string;
    kind: "permission" | "question";
    request: Record<string, unknown>;
    signal: AbortSignal | null;
  }): Promise<Record<string, unknown>> {
    const interactionId = randomUUID();
    try {
      await this.post(
        `/reservations/${encodeURIComponent(input.reservationId)}/interactions`,
        {
          listener_instance_id: input.listenerInstanceId,
          interaction_id: interactionId,
          kind: input.kind,
          request: input.request,
        },
        input.signal,
      );

      while (true) {
        if (input.signal?.aborted) {
          throw abortedInteractionError();
        }
        const data = await this.post(
          `/reservations/${encodeURIComponent(input.reservationId)}/interactions/${encodeURIComponent(interactionId)}/wait`,
          {
            listener_instance_id: input.listenerInstanceId,
          },
          input.signal,
        );
        const result = readRecord(data);
        if (result.outcome === "timeout") {
          continue;
        }
        if (result.outcome !== "terminal") {
          throw new Error(
            "Native live runtime interaction wait returned an invalid outcome.",
          );
        }
        const interaction = readRecord(result.interaction);
        if (interaction.status === "resolved") {
          return readRecord(interaction.response);
        }
        if (interaction.status === "cancelled") {
          throw abortedInteractionError();
        }
        throw new Error(
          "Native live runtime interaction terminal state is invalid.",
        );
      }
    } catch (error) {
      if (input.signal?.aborted || isAbortedInteraction(error)) {
        try {
          await this.post(
            `/reservations/${encodeURIComponent(input.reservationId)}/interactions/${encodeURIComponent(interactionId)}/cancel`,
            {
              listener_instance_id: input.listenerInstanceId,
            },
          );
        } catch {
          // Cancellation cleanup is best-effort; the preparation lifecycle
          // still bounds orphaned interaction rows.
        }
        throw abortedInteractionError();
      }
      throw error;
    }
  }

  async waitRuntimeControl(input: {
    listenerInstanceId: string;
    reservationId: string;
    signal?: AbortSignal | null;
  }): Promise<import("./native-live-mac-daemon-loop.js").NativeLiveRuntimeControlReservation | null> {
    const data = await this.post(
      `/reservations/${encodeURIComponent(input.reservationId)}/controls/wait`,
      {
        listener_instance_id: input.listenerInstanceId,
      },
      input.signal ?? null,
    );
    const result = readRecord(data);
    if (result.outcome === "timeout") return null;
    if (result.outcome !== "reserved") {
      throw new Error(
        "Native live runtime control wait returned an invalid outcome.",
      );
    }
    const control = readRecord(result.control);
    if (
      typeof control.controlId !== "string"
      || (
        control.kind !== "mid_turn_input"
        && control.kind !== "interrupt"
      )
      || !control.payload
      || typeof control.payload !== "object"
      || Array.isArray(control.payload)
    ) {
      throw new Error(
        "Native live runtime control reservation is invalid.",
      );
    }
    return {
      controlId: control.controlId,
      kind: control.kind,
      payload: control.payload as Record<string, unknown>,
    };
  }

  async completeRuntimeControl(input: {
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
  }): Promise<void> {
    await this.post(
      `/reservations/${encodeURIComponent(input.reservationId)}/controls/${encodeURIComponent(input.controlId)}/complete`,
      {
        listener_instance_id: input.listenerInstanceId,
        outcome: input.outcome,
      },
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

  private async post(
    path: string,
    body: unknown,
    signal: AbortSignal | null = null,
  ): Promise<unknown> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/internal/native-live-relay${path}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
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
      const error =
        record.error
        && typeof record.error === "object"
        && !Array.isArray(record.error)
          ? record.error as Record<string, unknown>
          : {};
      throw Object.assign(
        new Error("Native live relay request failed."),
        {
          relayCode:
            typeof error.code === "string"
              ? error.code
              : null,
          finalizeCode:
            typeof error.finalizeCode === "string"
              ? error.finalizeCode
              : null,
          httpStatus: response.status,
        },
      );
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


function abortedInteractionError(): Error {
  return Object.assign(
    new Error("Native live runtime interaction was aborted."),
    { runtimeCode: "ABORTED" },
  );
}

function isAbortedInteraction(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "runtimeCode" in error
    && (error as { runtimeCode?: unknown }).runtimeCode === "ABORTED"
  );
}
