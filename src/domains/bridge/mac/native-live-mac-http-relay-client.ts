import {
  NativeLiveMacRelayHttp,
  awaitRelayDeadline,
} from "./native-live-mac-relay-http.js";
import {
  parseAttachmentDescriptor,
  readStringRecord,
  parseSilenceWakeSchedule,
  readRecord,
  abortedInteractionError,
  isAbortedInteraction,
  isRelayPayloadTooLarge,
} from "./native-live-mac-relay-response.js";
import {
  backgroundIdentity,
  backgroundResult,
  type NativeLiveBackgroundPrepare,
  type NativeLiveBackgroundSubmit,
  type NativeLiveBackgroundPrepared,
  type NativeLiveBackgroundAck,
} from "../protocol/native-live-background-result.js";
import { requireUuid } from "../protocol/runtime-protocol/parsing.js";
import { parseNativeLiveExecutionAdmissionBody } from "../protocol/native-live-execution-admission.js";
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
} from "../protocol/native-live-runtime-protocol.js";
import type {
  NativeLiveSemanticFallbackCode,
  NativeLiveSemanticScoringReservation,
} from "../mind/native-live-semantic-handshake.js";
import {
  parseNativeLiveBackgroundModelCommand,
  type NativeLiveBackgroundModelExecutionResult,
} from "../background/native-live-background-model-protocol.js";
import type {
  NativeLiveSilenceWakeIgnoredReason,
  NativeLiveSilenceWakeSchedule,
  NativeLiveWakeFireSlot,
} from "../turn/native-live-silence-wake.js";

type FetchLike = typeof fetch;

// Server-side reserves answer in milliseconds; this only bounds a lost response.
const RESERVE_TIMEOUT_MS = 15_000;

export class NativeLiveMacHttpRelayClient extends NativeLiveMacRelayHttp
implements NativeLiveMacDaemonRelayClient {
  private readonly reserveTimeoutMs: number;

  constructor(baseUrl: string, token: string, fetchImpl: FetchLike = fetch,
    options: { reserveTimeoutMs?: number } = {}) {
    super(baseUrl, token, fetchImpl);
    this.reserveTimeoutMs = options.reserveTimeoutMs ?? RESERVE_TIMEOUT_MS;
  }

  // Reserves run in the daemon's main loop. A response a proxy drops after the
  // server answered must not hold the loop until fetch's own 5-minute timeout;
  // the loop's retry and durable recovery already handle that ambiguity.
  private reserve(path: string, body: unknown): Promise<unknown> {
    const signal = AbortSignal.timeout(this.reserveTimeoutMs);
    return awaitRelayDeadline(this.post(path, body, signal), signal);
  }

  async createAttachmentUploadSlot(input: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    kind: "image" | "file";
  }): Promise<{
    attachment: {
      attachmentId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      kind: "image" | "file";
    };
    upload: {
      url: string;
      method: "PUT";
      headers: Record<string, string>;
    };
  }> {
    const data = readRecord(
      await this.post(
        "/attachments/upload-slots",
        {
          filename: input.filename,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          sha256: input.sha256,
          kind: input.kind,
        },
      ),
    );
    const attachment =
      parseAttachmentDescriptor(data.attachment);
    const upload = readRecord(data.upload);
    if (
      typeof upload.url !== "string"
      || upload.method !== "PUT"
    ) {
      throw new Error(
        "Native live attachment upload slot is invalid.",
      );
    }
    return {
      attachment,
      upload: {
        url: new URL(
          upload.url,
          this.baseUrl + "/",
        ).toString(),
        method: "PUT",
        headers: readStringRecord(upload.headers),
      },
    };
  }

  async completeAttachmentUpload(input: {
    attachmentId: string;
  }): Promise<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    kind: "image" | "file";
  }> {
    const data = readRecord(
      await this.post(
        "/attachments/"
          + encodeURIComponent(input.attachmentId)
          + "/complete",
        {},
      ),
    );
    return parseAttachmentDescriptor(data.attachment);
  }

  async createAttachmentDownloadSlot(input: {
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
  }> {
    const data = readRecord(
      await this.post(
        "/attachments/"
          + encodeURIComponent(input.attachmentId)
          + "/download-slot",
        {},
      ),
    );
    const attachment =
      parseAttachmentDescriptor(data.attachment);
    const download = readRecord(data.download);
    if (
      typeof download.url !== "string"
      || download.method !== "GET"
    ) {
      throw new Error(
        "Native live attachment download slot is invalid.",
      );
    }
    return {
      url: new URL(
        download.url,
        this.baseUrl + "/",
      ).toString(),
      method: "GET",
      headers: readStringRecord(download.headers),
      attachment,
    };
  }

  async reserveSemanticScoring(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveSemanticScoringReservation | null> {
    const data = await this.reserve("/semantic/reserve", {
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
          || (item.kind !== "memory")
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

  async reserveExternalSessions(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }) {
    const data = await this.reserve(
      "/external-sessions/reserve",
      {
        listener_instance_id: input.listenerInstanceId,
        dispatch_target: input.dispatchTarget,
      },
    );
    if (data === null) return null;
    const record = readRecord(data);
    if (typeof record.reservationId !== "string") {
      throw new Error(
        "Native live external session reservation is invalid.",
      );
    }
    return {
      reservationId: record.reservationId,
    };
  }

  async submitExternalSessionsResult(input: {
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
  }): Promise<void> {
    await this.post(
      `/external-sessions/reservations/${encodeURIComponent(input.reservationId)}/result`,
      input.outcome.status === "success"
        ? {
            listener_instance_id: input.listenerInstanceId,
            status: "success",
            sessions: input.outcome.sessions.map((session) => ({
              session_id: session.sessionId,
              summary: session.summary,
              custom_title: session.customTitle,
              first_prompt: session.firstPrompt,
              git_branch: session.gitBranch,
              last_modified: session.lastModified,
              created_at: session.createdAt,
              working_directory: session.workingDirectory,
            })),
          }
        : {
            listener_instance_id: input.listenerInstanceId,
            status: "failure",
            failure_code: input.outcome.failureCode,
          },
    );
  }

  async reserveManualCompact(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }) {
    const data = await this.reserve(
      "/manual-compact/reserve",
      {
        listener_instance_id: input.listenerInstanceId,
        dispatch_target: input.dispatchTarget,
      },
    );
    if (data === null) return null;
    const record = readRecord(data);
    if (
      typeof record.reservationId !== "string"
      || typeof record.conversationId !== "string"
      || typeof record.expectedHeadMessageId !== "string"
      || typeof record.sourceMessageId !== "string"
      || typeof record.providerSessionId !== "string"
      || !record.providerSessionId.trim()
      || !(
        record.effectiveWorkingDirectory === undefined
        || record.effectiveWorkingDirectory === null
        || typeof record.effectiveWorkingDirectory === "string"
      )
    ) {
      throw new Error(
        "Native live manual compact reservation is invalid.",
      );
    }
    return {
      reservationId: record.reservationId,
      conversationId: record.conversationId,
      expectedHeadMessageId: record.expectedHeadMessageId,
      sourceMessageId: record.sourceMessageId,
      providerSessionId: record.providerSessionId,
      effectiveWorkingDirectory:
        typeof record.effectiveWorkingDirectory === "string"
          ? record.effectiveWorkingDirectory
          : null,
      ...(Object.hasOwn(record, "providerCheckpointId") ? { providerCheckpointId: typeof record.providerCheckpointId === "string" ? record.providerCheckpointId : null } : {}),
    };
  }

  async submitManualCompactResult(input: {
    listenerInstanceId: string;
    reservationId: string;
    outcome:
      | {
          status: "success";
          result: {
            providerSessionId: string;
            providerCheckpointId?: string | null;
            contextUsage: unknown;
            boundary: Record<string, unknown> | null;
            summary: string | null;
          };
        }
      | {
          status: "failure";
          failureCode: string;
        };
  }): Promise<void> {
    await this.post(
      `/manual-compact/reservations/${encodeURIComponent(input.reservationId)}/result`,
      input.outcome.status === "success"
        ? {
            listener_instance_id: input.listenerInstanceId,
            status: "success",
            result: {
              provider_session_id:
                input.outcome.result.providerSessionId,
              provider_checkpoint_id: input.outcome.result.providerCheckpointId ?? null,
              context_usage:
                input.outcome.result.contextUsage,
              boundary: input.outcome.result.boundary,
              summary: input.outcome.result.summary,
            },
          }
        : {
            listener_instance_id: input.listenerInstanceId,
            status: "failure",
            failure_code: input.outcome.failureCode,
          },
    );
  }

  async reserveProviderSessionCleanup(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }) {
    const data = await this.reserve(
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
        record.effectiveWorkingDirectory === undefined
        || record.effectiveWorkingDirectory === null
        || (
          typeof record.effectiveWorkingDirectory === "string"
          && record.effectiveWorkingDirectory.trim()
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
      effectiveWorkingDirectory:
        typeof record.effectiveWorkingDirectory === "string"
          ? record.effectiveWorkingDirectory
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
    const data = await this.reserve("/background-model/reserve", {
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

  async readSilenceWakeSchedule(): Promise<
    NativeLiveSilenceWakeSchedule | null
  > {
    const data = await this.post(
      "/silence-wake/schedule",
      {},
    );
    return data === null
      ? null
      : parseSilenceWakeSchedule(data);
  }

  async fireSilenceWake(input: {
    epochId: string;
    slot: NativeLiveWakeFireSlot;
  }): Promise<{
    outcome: "queued" | "ignored";
    schedule: NativeLiveSilenceWakeSchedule | null;
    reason?: NativeLiveSilenceWakeIgnoredReason;
  }> {
    const data = readRecord(
      await this.post(
        "/silence-wake/fire",
        {
          epoch_id: input.epochId,
          slot: input.slot,
        },
      ),
    );
    if (
      data.outcome !== "queued"
      && data.outcome !== "ignored"
    ) {
      throw new Error(
        "Native live silence wake outcome is invalid.",
      );
    }

    const reason =
      data.reason === "source_changed"
        || data.reason === "slot_not_due"
        || data.reason === "foreground_active"
        || data.reason === "already_consumed"
        ? data.reason
        : undefined;
    if (
      data.outcome === "ignored"
      && data.reason !== undefined
      && !reason
    ) {
      throw new Error(
        "Native live silence wake ignore reason is invalid.",
      );
    }

    return {
      outcome: data.outcome,
      schedule:
        data.schedule === null
          ? null
          : parseSilenceWakeSchedule(data.schedule),
      ...(reason ? { reason } : {}),
    };
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
    const data = await this.postWait(
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
    persistentSessions?: boolean;
  }): Promise<NativeLiveDaemonReservation | null> {
    const data = await this.reserve("/reserve", {
      listener_instance_id: input.listenerInstanceId,
      dispatch_target: input.dispatchTarget,
      ...(input.persistentSessions === true ? { persistent_sessions: true } : {}),
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

  async bindInput(input: {
    listenerInstanceId: string; command: import("../protocol/native-live-runtime-protocol.js").NativeLiveRuntimeCommand;
    phase: "queued" | "started"; commandUuid: string;
  }): Promise<{ userMessageId: string; parentProviderCheckpointId: string | null } | null> {
    const c = input.command;
    if (c.operation !== "send" || c.runtime_mode !== "resume"
      || !c.canonical_user_message_id || input.commandUuid !== c.canonical_user_message_id) return null;
    const body = {
      listener_instance_id: input.listenerInstanceId, request_id: c.request_id,
      conversation_id: c.conversation_id, runtime_mode: c.runtime_mode,
      canonical_user_message_id: c.canonical_user_message_id,
      parent_provider_session_id: c.parent_provider_session_id,
      parent_provider_checkpoint_id: c.parent_provider_checkpoint_id,
      command_uuid: input.commandUuid, phase: input.phase,
    };
    // Binding is idempotent on the server (a started marker is returned as is),
    // so a stalled attempt gets a fresh one instead of failing a finished turn.
    // All attempts share eight seconds.
    const deadline = AbortSignal.timeout(8_000);
    let data: Record<string, unknown>;
    for (let attempt = 1; ; attempt += 1) {
      const signal = AbortSignal.any([deadline, AbortSignal.timeout(3_000)]);
      try {
        data = readRecord(await awaitRelayDeadline(this.post(
          `/reservations/${encodeURIComponent(c.prepare_id)}/input-binding`, body, signal,
        ), signal));
        break;
      } catch (error) {
        if (deadline.aborted || attempt >= 3 || !(error instanceof Error && error.name === "TimeoutError")) throw error;
      }
    }
    const bound = data.bound;
    if (!bound || typeof bound !== "object" || Array.isArray(bound)) return null;
    const row = bound as Record<string, unknown>;
    if (row.userMessageId !== input.commandUuid ||
      (row.parentProviderCheckpointId !== null &&
        (typeof row.parentProviderCheckpointId !== "string" || !row.parentProviderCheckpointId.trim())))
      throw new Error("Native binding returned an unrelated input or invalid checkpoint.");
    return { userMessageId: row.userMessageId, parentProviderCheckpointId: row.parentProviderCheckpointId as string | null };
  }

  async checkExecutionAdmission(input: {
    listenerInstanceId: string;
    command: import("../protocol/native-live-runtime-protocol.js").NativeLiveRuntimeCommand;
  }): Promise<boolean> {
    const c = input.command;
    const body = { listener_instance_id: input.listenerInstanceId, request_id: c.request_id,
      conversation_id: c.conversation_id, runtime_mode: c.runtime_mode,
      canonical_user_message_id: c.canonical_user_message_id,
      parent_provider_session_id: c.parent_provider_session_id,
      parent_provider_checkpoint_id: c.parent_provider_checkpoint_id };
    if (!parseNativeLiveExecutionAdmissionBody(body)) return false;
    // This endpoint only checks current ownership; it cannot submit input or
    // execute a model/tool, so it may be rechecked but is never cached. A
    // stalled connection that never reaches the server gets a fresh attempt
    // after 2.5s instead of failing the turn; all attempts share eight seconds.
    const deadline = AbortSignal.timeout(8_000);
    for (let attempt = 1; ; attempt += 1) {
      const signal = AbortSignal.any([deadline, AbortSignal.timeout(2_500)]);
      try {
        const data = readRecord(await awaitRelayDeadline(this.postRetryableBounded(
          `/reservations/${encodeURIComponent(c.prepare_id)}/execution-admission`, body, 2, signal,
        ), signal));
        if (typeof data.admitted !== "boolean") throw new Error("Native live execution admission response is invalid.");
        return data.admitted;
      } catch (error) {
        if (deadline.aborted || attempt >= 3 || !(error instanceof Error && error.name === "TimeoutError")) throw error;
      }
    }
  }

  async renewSessionLease(input: {listenerInstanceId:string}): Promise<boolean> {
    const data=readRecord(await this.post("/session-lease/renew",{listener_instance_id:input.listenerInstanceId,dispatch_target:"claude_code"},AbortSignal.timeout(2_000)));
    if(typeof data.renewed!=="boolean")throw new Error("Invalid session lease renewal receipt.");return data.renewed;
  }

  async renewExecutionLease(input: { listenerInstanceId: string; command: import("../protocol/native-live-runtime-protocol.js").NativeLiveRuntimeCommand }): Promise<boolean> {
    const c = input.command;
    const body = { listener_instance_id: input.listenerInstanceId, request_id: c.request_id, conversation_id: c.conversation_id,
      runtime_mode: c.runtime_mode, canonical_user_message_id: c.canonical_user_message_id,
      parent_provider_session_id: c.parent_provider_session_id, parent_provider_checkpoint_id: c.parent_provider_checkpoint_id };
    if (!parseNativeLiveExecutionAdmissionBody(body)) return false;
    const data = readRecord(await this.post(`/reservations/${encodeURIComponent(c.prepare_id)}/execution-lease/renew`, body, AbortSignal.timeout(2_000)));
    if (typeof data.renewed !== "boolean") throw new Error("Native execution renewal response is invalid.");
    return data.renewed;
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
      event: import("../../conversation/native-live-conversation-orchestrator.js").NativeLiveNormalizedEvent;
    }>;
  }): Promise<void> {
    await this.appendRuntimeEventBatch({
      listenerInstanceId: input.listenerInstanceId,
      reservationId: input.reservationId,
      events: [...input.events],
    }, AbortSignal.timeout(2_000));
  }

  private async appendRuntimeEventBatch(input: {
    listenerInstanceId: string;
    reservationId: string;
    events: Array<{
      sequence: number;
      event: import("../../conversation/native-live-conversation-orchestrator.js").NativeLiveNormalizedEvent;
    }>;
  }, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    try {
      // Bound caller latency even when fetch or its body reader ignores abort.
      // All retries and recursive 413 splits consume this same elapsed budget.
      await awaitRelayDeadline(this.postRetryableBounded(
        `/reservations/${encodeURIComponent(input.reservationId)}/events/batch`,
        {
          listener_instance_id: input.listenerInstanceId,
          events: input.events,
        },
        3,
        signal,
      ), signal);
    } catch (error) {
      signal.throwIfAborted();
      if (
        !isRelayPayloadTooLarge(error)
        || input.events.length <= 1
      ) {
        throw error;
      }

      const midpoint = Math.ceil(input.events.length / 2);
      await this.appendRuntimeEventBatch({
        ...input,
        events: input.events.slice(0, midpoint),
      }, signal);
      await this.appendRuntimeEventBatch({
        ...input,
        events: input.events.slice(midpoint),
      }, signal);
    }
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
        const data = await this.postWait(
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

  async supportsTaskControls():Promise<boolean> {
    try {
      const data=readRecord(await this.post("/task-controls/capabilities",{},AbortSignal.timeout(2_000)));
      return data.version===1;
    } catch {return false;}
  }
  async publishTaskState(input: import("./native-live-mac-task-state-publisher.js").NativeLiveTaskStateUpdate & {listenerInstanceId:string}): Promise<{outcome:"created"|"idempotent"|"stale"}> {
    const signal=AbortSignal.timeout(2_000);
    const data=readRecord(await awaitRelayDeadline(this.postRetryableBounded(`/reservations/${encodeURIComponent(input.prepareId)}/task-state`,{
      listener_instance_id:input.listenerInstanceId,provider_session_id:input.providerSessionId,generation_id:input.generationId,
      snapshot_sequence:input.snapshotSequence,tasks:input.tasks,
    },3,signal),signal));
    if(!["created","idempotent","stale"].includes(String(data.outcome)))throw Error("Task state response invalid.");
    return data as {outcome:"created"|"idempotent"|"stale"};
  }
  async checkTaskAdmission(input:{listenerInstanceId:string;prepareId:string;providerSessionId:string}):Promise<boolean> {
    const data=readRecord(await this.post(`/reservations/${encodeURIComponent(input.prepareId)}/task-admission`,{listener_instance_id:input.listenerInstanceId,provider_session_id:input.providerSessionId},AbortSignal.timeout(2_000)));
    return data.admitted===true;
  }
  async waitTaskControl(input: { listenerInstanceId:string; bindings:import("../runtime-interaction/native-live-task-control-repository.js").NativeLiveTaskBinding[]; signal:AbortSignal }):Promise<import("./native-live-mac-task-controls.js").NativeLiveMacTaskControl|null> {
    const result=readRecord(await this.postWait("/task-controls/wait",{listener_instance_id:input.listenerInstanceId,bindings:input.bindings},input.signal));
    if(result.outcome==="timeout")return null;
    const control=readRecord(result.control);
    if(result.outcome!=="reserved" || control.kind!=="task" || typeof control.controlId!=="string" || typeof control.prepareId!=="string")throw Error("Task control response invalid.");
    return {controlId:control.controlId,prepareId:control.prepareId,payload:readRecord(control.payload)};
  }

  async waitRuntimeControl(input: {
    listenerInstanceId: string;
    reservationId: string;
    signal?: AbortSignal | null;
  }): Promise<import("./native-live-mac-daemon-loop.js").NativeLiveRuntimeControlReservation | null> {
    const data = await this.postWait(
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
      AbortSignal.timeout(2_000),
    );
  }

  async prepareBackgroundResult(input: NativeLiveBackgroundPrepare): Promise<NativeLiveBackgroundPrepared> {
    const identity = backgroundIdentity(input);
    const parent = requireUuid(input.parentProviderCheckpointId, "parentProviderCheckpointId");
    const data = readRecord(await this.postRetryableBounded(
      `/reservations/${identity.sourcePrepareId}/background-results/prepare`,
      { receipt_id: identity.receiptId, listener_instance_id: identity.listenerInstanceId,
        generation_id: identity.generationId, parent_provider_checkpoint_id: parent,
        ...(input.executionStart === true ? { execution_start: true } : {}),
        ...(input.deferred === true ? { deferred: true } : {}) }, 3, AbortSignal.timeout(5_000),
    ));
    if (data.receiptId !== identity.receiptId || data.parentProviderCheckpointId !== parent
      || typeof data.providerSessionId !== "string" || !data.providerSessionId.trim() || data.providerSessionId.length > 1024
      || typeof data.expiresAt !== "string" || !Number.isFinite(Date.parse(data.expiresAt))) {
      throw new Error("Native background preparation response is invalid.");
    }
    return { receiptId: identity.receiptId, providerSessionId: data.providerSessionId,
      parentProviderCheckpointId: parent, expiresAt: data.expiresAt };
  }

  async submitBackgroundResult(input: NativeLiveBackgroundSubmit): Promise<NativeLiveBackgroundAck> {
    const identity = backgroundIdentity(input), result = backgroundResult(input.result);
    const data = readRecord(await this.postRetryableBounded(
      `/reservations/${identity.sourcePrepareId}/background-results/${identity.receiptId}/result`,
      { listener_instance_id: identity.listenerInstanceId, generation_id: identity.generationId, result,
        ...(input.coveringCheckpointId ? { covering_checkpoint_id: requireUuid(input.coveringCheckpointId, "coveringCheckpointId") } : {}) }, 3, AbortSignal.timeout(5_000),
    ));
    const outcome = data.outcome;
    if (!["committed", "queued", "failed", "stale"].includes(String(outcome)) || typeof data.duplicate !== "boolean"
      || (outcome === "committed" ? result.status !== "success" || data.providerCheckpointId !== (input.coveringCheckpointId ?? result.provider_checkpoint_id)
        : data.providerCheckpointId !== null || (outcome === "failed" && result.status !== "failure") || (outcome === "queued" && result.status !== "success"))) {
      throw new Error("Native background submission response is invalid.");
    }
    return { outcome: outcome as NativeLiveBackgroundAck["outcome"], duplicate: data.duplicate,
      providerCheckpointId: outcome === "committed" ? requireUuid(data.providerCheckpointId, "providerCheckpointId") : null };
  }

  async submitResult(input: {
    listenerInstanceId: string;
    reservationId: string;
    result: NativeLiveRuntimeExecutionResult;
  }): Promise<{
    canonicalOutcome: string | null;
    nativeResumeCheckpointId?: string;
  }> {
    const data = readRecord(
      await this.postRetryableBounded(
        `/reservations/${encodeURIComponent(input.reservationId)}/result`,
        {
          listener_instance_id: input.listenerInstanceId,
          result: input.result,
        },
        3,
        AbortSignal.timeout(5_000),
      ),
    );
    if (data.nativeResumeCheckpointId !== undefined
      && (!["wake_quiet", "wake_stale"].includes(data.canonicalOutcome as string) || !requireUuid(data.nativeResumeCheckpointId, "nativeResumeCheckpointId"))) {
      throw new Error("Native quiet acknowledgement is invalid.");
    }
    return {
      ...(data.nativeResumeCheckpointId !== undefined ? { nativeResumeCheckpointId: data.nativeResumeCheckpointId as string } : {}),
      canonicalOutcome:
        typeof data.canonicalOutcome === "string"
          ? data.canonicalOutcome
          : null,
    };
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
}
