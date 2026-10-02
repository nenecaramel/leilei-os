import { createHash, randomUUID } from "node:crypto";
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
  ClaudeAlbumToolPhoto,
} from "../../album/claude-photo-album-tool-contract.js";

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

  async savePhoto(input: {
    sourceAttachmentId: string;
    triggerUserMessageId: string;
    description: string | null;
    whySaved: string;
    tags: string[];
  }): Promise<{
    photo: ClaudeAlbumToolPhoto;
    created: boolean;
  }> {
    let payload: unknown;
    try {
      payload = await this.post(
        "/album/photos/save",
        {
          source_attachment_id:
            input.sourceAttachmentId,
          trigger_user_message_id:
            input.triggerUserMessageId,
          description: input.description,
          why_saved: input.whySaved,
          tags: input.tags,
        },
      );
    } catch (error) {
      if (
        error
        && typeof error === "object"
        && "relayCode" in error
        && error.relayCode === "SOURCE_ATTACHMENT_UNAVAILABLE"
        && "relayMessage" in error
        && typeof error.relayMessage === "string"
        && error.relayMessage.trim()
      ) {
        throw Object.assign(
          new Error(error.relayMessage),
          {
            relayCode: error.relayCode,
            httpStatus:
              "httpStatus" in error
                ? error.httpStatus
                : null,
          },
        );
      }
      throw error;
    }
    const data = readRecord(payload);
    return {
      photo: parseAlbumPhoto(data.photo),
      created: data.created === true,
    };
  }

  async searchPhotos(input: {
    query: string | null;
    limit: number;
  }): Promise<ClaudeAlbumToolPhoto[]> {
    const data = readRecord(
      await this.post(
        "/album/photos/search",
        {
          query: input.query,
          limit: input.limit,
        },
      ),
    );
    if (!Array.isArray(data.photos)) {
      throw new Error(
        "Native live album search response is invalid.",
      );
    }
    return data.photos.map(parseAlbumPhoto);
  }

  async viewPhoto(input: {
    photoId: string;
  }): Promise<{
    photo: ClaudeAlbumToolPhoto;
    image: {
      data: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
    };
  }> {
    const data = readRecord(
      await this.post(
        "/album/photos/"
          + encodeURIComponent(input.photoId)
          + "/view",
        {},
      ),
    );
    const photo = parseAlbumPhoto(data.photo);
    const download = readRecord(data.download);
    if (
      typeof download.url !== "string"
      || download.method !== "GET"
    ) {
      throw new Error(
        "Native live album preview response is invalid.",
      );
    }

    const response = await this.fetchImpl(
      new URL(
        download.url,
        this.baseUrl + "/",
      ).toString(),
      {
        method: "GET",
        headers: readStringRecord(download.headers),
      },
    );
    if (!response.ok) {
      throw new Error(
        "Album photo preview download failed with HTTP "
          + response.status
          + ".",
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");
    if (
      bytes.byteLength !== photo.sizeBytes
      || sha256 !== photo.sha256.toLowerCase()
    ) {
      throw new Error(
        "Album photo preview bytes did not match stored metadata.",
      );
    }

    return {
      photo,
      image: {
        data: bytes.toString("base64"),
        mimeType: photo.mimeType,
        sizeBytes: bytes.byteLength,
        sha256,
      },
    };
  }

  async sendPhoto(input: {
    photoId: string;
  }): Promise<{
    photo: ClaudeAlbumToolPhoto;
    attachment: {
      attachmentId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      kind: "image";
    };
  }> {
    const data = readRecord(
      await this.post(
        "/album/photos/"
          + encodeURIComponent(input.photoId)
          + "/send",
        {},
      ),
    );
    const attachment = parseAttachmentDescriptor(
      data.attachment,
    );
    if (attachment.kind !== "image") {
      throw new Error(
        "Native live album send response did not return an image.",
      );
    }
    return {
      photo: parseAlbumPhoto(data.photo),
      attachment: {
        ...attachment,
        kind: "image",
      },
    };
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

  async reserveExternalSessions(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }) {
    const data = await this.post(
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
            workspaceId: string | null;
            workspaceRoot: string;
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
              workspace_id: session.workspaceId,
              workspace_root: session.workspaceRoot,
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
    const data = await this.post(
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
        record.workspaceId === undefined
        || record.workspaceId === null
        || typeof record.workspaceId === "string"
      )
      || !(
        record.effectiveWorkspaceRoot === undefined
        || record.effectiveWorkspaceRoot === null
        || typeof record.effectiveWorkspaceRoot === "string"
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

  async submitManualCompactResult(input: {
    listenerInstanceId: string;
    reservationId: string;
    outcome:
      | {
          status: "success";
          result: {
            providerSessionId: string;
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
      event: import("../../conversation/native-live-conversation-orchestrator.js").NativeLiveNormalizedEvent;
    }>;
  }): Promise<void> {
    await this.appendRuntimeEventBatch({
      listenerInstanceId: input.listenerInstanceId,
      reservationId: input.reservationId,
      events: [...input.events],
    });
  }

  private async appendRuntimeEventBatch(input: {
    listenerInstanceId: string;
    reservationId: string;
    events: Array<{
      sequence: number;
      event: import("../../conversation/native-live-conversation-orchestrator.js").NativeLiveNormalizedEvent;
    }>;
  }): Promise<void> {
    try {
      await this.postRetryableBounded(
        `/reservations/${encodeURIComponent(input.reservationId)}/events/batch`,
        {
          listener_instance_id: input.listenerInstanceId,
          events: input.events,
        },
        3,
      );
    } catch (error) {
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
      });
      await this.appendRuntimeEventBatch({
        ...input,
        events: input.events.slice(midpoint),
      });
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
    );
  }

  async submitResult(input: {
    listenerInstanceId: string;
    reservationId: string;
    result: NativeLiveRuntimeExecutionResult;
  }): Promise<void> {
    await this.postRetryable(
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

  private async postRetryableBounded(
    path: string,
    body: unknown,
    maxAttempts: number,
  ): Promise<unknown> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.post(path, body);
      } catch (error) {
        if (
          !isTransientRelayWaitError(error)
          || attempt >= maxAttempts
        ) {
          throw error;
        }
        await delayRelayRetry(
          Math.min(250 * 2 ** (attempt - 1), 1_000),
          null,
        );
      }
    }
    throw new Error("Native live relay retry budget exhausted.");
  }

  private async postRetryable(
    path: string,
    body: unknown,
  ): Promise<unknown> {
    let attempt = 0;
    while (true) {
      try {
        return await this.post(path, body);
      } catch (error) {
        if (!isTransientRelayWaitError(error)) {
          throw error;
        }
        attempt += 1;
        await delayRelayRetry(
          Math.min(250 * 2 ** Math.min(attempt - 1, 4), 3_000),
          null,
        );
      }
    }
  }

  private async postWait(
    path: string,
    body: unknown,
    signal: AbortSignal | null = null,
  ): Promise<unknown> {
    let attempt = 0;
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      try {
        return await this.post(path, body, signal);
      } catch (error) {
        if (!isTransientRelayWaitError(error) || signal?.aborted) {
          throw error;
        }
        attempt += 1;
        await delayRelayRetry(
          Math.min(250 * 2 ** Math.min(attempt - 1, 4), 3_000),
          signal,
        );
      }
    }
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
          connection: "close",
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
          relayMessage:
            typeof error.message === "string"
            && error.message.trim()
              ? error.message
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

function parseAttachmentDescriptor(
  value: unknown,
): {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  kind: "image" | "file";
} {
  const attachment = readRecord(value);
  if (
    typeof attachment.attachmentId !== "string"
    || typeof attachment.filename !== "string"
    || typeof attachment.mimeType !== "string"
    || typeof attachment.sizeBytes !== "number"
    || typeof attachment.sha256 !== "string"
    || (
      attachment.kind !== "image"
      && attachment.kind !== "file"
    )
  ) {
    throw new Error(
      "Native live attachment descriptor is invalid.",
    );
  }
  return {
    attachmentId: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    sha256: attachment.sha256,
    kind: attachment.kind,
  };
}

function parseAlbumPhoto(
  value: unknown,
): ClaudeAlbumToolPhoto {
  const photo = readRecord(value);
  if (
    typeof photo.id !== "string"
    || typeof photo.filename !== "string"
    || typeof photo.mimeType !== "string"
    || typeof photo.sizeBytes !== "number"
    || typeof photo.sha256 !== "string"
    || (
      photo.description !== null
      && typeof photo.description !== "string"
    )
    || typeof photo.whySaved !== "string"
    || !Array.isArray(photo.tags)
    || !photo.tags.every(
      (tag) => typeof tag === "string",
    )
    || typeof photo.sourceAttachmentId !== "string"
    || (
      photo.sourceMessageId !== null
      && typeof photo.sourceMessageId !== "string"
    )
    || typeof photo.createdAt !== "string"
  ) {
    throw new Error(
      "Native live album photo descriptor is invalid.",
    );
  }
  return {
    id: photo.id,
    filename: photo.filename,
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes,
    sha256: photo.sha256,
    description: photo.description,
    whySaved: photo.whySaved,
    tags: [...photo.tags] as string[],
    sourceAttachmentId: photo.sourceAttachmentId,
    sourceMessageId: photo.sourceMessageId,
    createdAt: photo.createdAt,
  };
}

function readStringRecord(
  value: unknown,
): Record<string, string> {
  const record = readRecord(value);
  return Object.fromEntries(
    Object.entries(record).map(([key, field]) => {
      if (typeof field !== "string") {
        throw new Error(
          "Native live attachment slot header is invalid.",
        );
      }
      return [key, field];
    }),
  );
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

function isRelayPayloadTooLarge(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "httpStatus" in error
    && (error as { httpStatus?: unknown }).httpStatus === 413,
  );
}

function isTransientRelayWaitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    httpStatus?: unknown;
    name?: unknown;
  };
  if (
    typeof record.httpStatus === "number"
    && (
      record.httpStatus === 502
      || record.httpStatus === 503
      || record.httpStatus === 504
    )
  ) {
    return true;
  }
  return record.name === "TypeError";
}

function delayRelayRetry(
  milliseconds: number,
  signal: AbortSignal | null,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
