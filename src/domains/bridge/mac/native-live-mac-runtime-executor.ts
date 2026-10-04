import type { NativeLiveMemeRuntimeHandlers } from "./native-live-mac-meme-sender.js";
import type {
  NativeLiveClaudeRuntime,
  NativeLiveNormalizedEvent,
  NativeLiveRuntimeResult,
} from "../../conversation/native-live-conversation-orchestrator.js";

type NativeLiveForegroundRuntimeResult =
  NativeLiveRuntimeResult & {
    contextUsage?: NativeLiveRuntimeContextUsage | null;
    executionReadback?:
      NativeLiveRuntimeExecutionReadback | null;
    executionReadbackError?: string | null;
    sessionStoreObservability?:
      NativeLiveRuntimeSessionStoreHealth | null;
  };

export type NativeLiveMacRuntimeFailureDiagnostics = {
  prepareId: string;
  runtimeCode: NativeLiveRuntimeFailureCode;
  errorName?: string;
  errorMessage?: string;
  causeName?: string;
  causeMessage?: string;
  causeCode?: string;
  providerSessionId?: string;
  resultSubtype?: string;
  resultIsError?: boolean;
  resultErrorMessages?: string[];
  eventCount: number;
  normalizedEventCount: number;
  lastRawEventTypes: string[];
  lastNormalizedEventTypes: string[];
};

type NativeLiveForegroundRuntime = NativeLiveClaudeRuntime & {
  executeTurn?: (
    prompt: string,
    options: {
      mode: "new" | "fork";
      parentProviderSessionId: string | null;
      streaming: boolean;
      userMessageUuid?: string | null;
      execution?: NativeLiveExecutionSelection | null;
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
      trustedReadPaths?: readonly string[];
      sendFileHandler?: (input: {
        path: string;
        displayName: string | null;
      }) => Promise<{
        attachmentId: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
        sha256: string;
        kind: "image" | "file";
      }>;
      memeHandlers?: NativeLiveMemeRuntimeHandlers;
      albumHandlers?: NativeLiveClaudeAlbumRuntimeHandlers;
      controlPump?: (
        controller: NativeLiveMacActiveTurnController,
        context: { signal: AbortSignal },
      ) => Promise<void>;
    },
  ) => Promise<NativeLiveForegroundRuntimeResult>;
  compact?: (
    sessionId: string,
    execution?: NativeLiveExecutionSelection | null,
  ) => Promise<NativeLiveRuntimeResult & {
    contextUsage?: NativeLiveRuntimeContextUsage | null;
    compaction?: {
      boundary?: Record<string, unknown> | null;
      postCompact?: Array<{
        summary?: string | null;
      }>;
    };
  }>;
};
import type {
  NativeLiveMacActiveTurnController,
} from "./native-live-mac-claude-transport.js";
import type { NativeLiveExecutionSelection } from "../turn/native-live-execution-selection.js";
import type {
  NativeLiveWorkspaceRuntimeResolver,
} from "./native-live-mac-workspace-runtime.js";
import type {
  NativeLiveMacAttachmentMaterializer,
} from "./native-live-mac-attachment-materializer.js";
import type {
  NativeLiveMacOutputAttachmentSender,
} from "./native-live-mac-output-attachment-sender.js";
import type {
  ClaudeAlbumRuntimeSaveInput,
  NativeLiveClaudeAlbumRuntimeHandlers,
  NativeLiveClaudeAlbumToolClient,
} from "../../album/claude-photo-album-tool-contract.js";
import {
  NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
  parseNativeLiveRuntimeCommand,
  parseNativeLiveRuntimeEnvironment,
  parseNativeLiveRuntimeOutputResources,
  parseNativeLiveRuntimeResultTelemetry,
  parseNativeLiveRuntimeVcsChanges,
  parseNativeLiveRuntimeSessionStoreHealth,
  type NativeLiveRuntimeCommand,
  type NativeLiveRuntimeContextUsage,
  type NativeLiveRuntimeExecutionReadback,
  type NativeLiveRuntimeExecutionResult,
  type NativeLiveRuntimeFailureCode,
  type NativeLiveRuntimeMetadata,
  type NativeLiveRuntimeSessionStoreHealth,
} from "../protocol/native-live-runtime-protocol.js";

export class NativeLiveMacRuntimeExecutor {
  private readonly runtime: NativeLiveForegroundRuntime | null;
  private readonly resolver: NativeLiveWorkspaceRuntimeResolver | null;

  constructor(
    runtimeOrResolver:
      | NativeLiveForegroundRuntime
      | NativeLiveWorkspaceRuntimeResolver,
    private readonly fallbackWorkspaceRoot = "/",
    private readonly attachmentMaterializer:
      NativeLiveMacAttachmentMaterializer | null = null,
    private readonly outputAttachmentSender:
      Pick<NativeLiveMacOutputAttachmentSender, "sendFile"> | null = null,
    private readonly onRuntimeFailure:
      ((diagnostics: NativeLiveMacRuntimeFailureDiagnostics) => void) | null = null,
    private readonly albumToolClient:
      NativeLiveClaudeAlbumToolClient | null = null,
    private readonly memeSender: NativeLiveMemeRuntimeHandlers | null = null,
  ) {
    if ("resolveWorkspaceRuntime" in runtimeOrResolver) {
      this.runtime = null;
      this.resolver = runtimeOrResolver;
    } else {
      this.runtime = runtimeOrResolver;
      this.resolver = null;
    }
  }

  async execute(
    rawCommand: unknown,
    options: {
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
    } = {},
  ): Promise<NativeLiveRuntimeExecutionResult> {
    const command = parseNativeLiveRuntimeCommand(rawCommand);

    let runtimeResult: NativeLiveForegroundRuntimeResult;
    let binding: {
      runtime: NativeLiveForegroundRuntime;
      workspaceRoot: string;
    };
    const outputAttachmentIds: string[] = [];
    let pendingOutputAttachments = 0;
    async function sendOutput<T>(
      send: () => Promise<T>,
      attachmentId: (result: T) => string,
      limitMessage: string,
    ): Promise<T> {
      if (outputAttachmentIds.length + pendingOutputAttachments >= 8) throw new Error(limitMessage);
      pendingOutputAttachments += 1;
      try {
        const result = await send();
        outputAttachmentIds.push(attachmentId(result));
        return result;
      } finally {
        pendingOutputAttachments -= 1;
      }
    }
    try {
      const localAttachments =
        this.attachmentMaterializer
          ? await this.attachmentMaterializer.materialize(command)
          : [];
      if (
        (command.attachments?.length ?? 0) > 0
        && !this.attachmentMaterializer
      ) {
        throw Object.assign(
          new Error(
            "Native Live attachment materializer is unavailable.",
          ),
          { runtimeCode: "ATTACHMENT_UNAVAILABLE" },
        );
      }
      const runtimePrompt =
        this.attachmentMaterializer
          ? this.attachmentMaterializer.appendPrompt(
              command.prompt,
              localAttachments,
            )
          : command.prompt;

      binding = await this.resolveRuntime(command);
      const runtime = binding.runtime;
      if (runtime.executeTurn) {
        const turnOptions = {
          mode: command.runtime_mode,
          parentProviderSessionId:
            command.parent_provider_session_id,
          streaming: true,
          userMessageUuid:
            command.canonical_user_message_id,
          ...(command.execution_selection
            ? { execution: command.execution_selection }
            : {}),
          ...(options.onNormalizedEvent
            ? {
                onNormalizedEvent:
                  options.onNormalizedEvent,
              }
            : {}),
          ...(options.permissionHandler
            ? {
                permissionHandler:
                  options.permissionHandler,
              }
            : {}),
          ...(options.questionHandler
            ? {
                questionHandler:
                  options.questionHandler,
              }
            : {}),
          ...(localAttachments.length > 0
            ? {
                trustedReadPaths:
                  localAttachments.map(
                    (attachment) =>
                      attachment.localPath,
                  ),
              }
            : {}),
          ...(this.outputAttachmentSender
            && command.protocol_version
              === NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION
            ? {
                sendFileHandler: async (input: {
                  path: string;
                  displayName: string | null;
                }) => {
                  return sendOutput(
                    () => this.outputAttachmentSender!.sendFile({
                      path: input.path,
                      displayName: input.displayName,
                      workspaceRoot: binding.workspaceRoot,
                    }),
                    attachment => attachment.attachmentId,
                    "send_file may send at most 8 files in one turn.",
                  );
                },
              }
            : {}),
          ...(this.albumToolClient
            && command.protocol_version
              === NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION
            ? {
                albumHandlers: {
                  savePhoto: async (
                    input: ClaudeAlbumRuntimeSaveInput,
                  ) => {
                    if (!command.canonical_user_message_id) {
                      throw new Error(
                        "Saving a new album photo is unavailable during a silence wake.",
                      );
                    }
                    const result =
                      await this.albumToolClient!.savePhoto({
                        ...input,
                        triggerUserMessageId:
                          command.canonical_user_message_id,
                      });
                    if (
                      result.created
                      && options.onNormalizedEvent
                    ) {
                      await options.onNormalizedEvent({
                        type: "runtime",
                        payload: {
                          kind: "album_saved",
                          photo_id: result.photo.id,
                          filename: result.photo.filename,
                          source_attachment_id:
                            result.photo.sourceAttachmentId,
                          user_message_uuid:
                            command.canonical_user_message_id,
                        },
                      });
                    }
                    return result;
                  },
                  searchPhotos: (input: {
                    query: string | null;
                    limit: number;
                  }) =>
                    this.albumToolClient!.searchPhotos(
                      input,
                    ),
                  viewPhoto: (input: {
                    photoId: string;
                  }) =>
                    this.albumToolClient!.viewPhoto(
                      input,
                    ),
                  sendPhoto: async (input: {
                    photoId: string;
                  }) => {
                    return sendOutput(
                      () => this.albumToolClient!.sendPhoto(input),
                      result => result.attachment.attachmentId,
                      "Album photo send would exceed the 8-file turn limit.",
                    );
                  },
                },
              }
            : {}),
          ...(this.memeSender
            && command.protocol_version === NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION
            ? {
                memeHandlers: {
                  sendMeme: (input: { memeId: string }) => sendOutput(
                    () => this.memeSender!.sendMeme(input),
                    attachment => attachment.attachmentId,
                    "Meme send would exceed the 8-file turn limit.",
                  ),
                },
              }
            : {}),
          ...(options.controlPump
            ? {
                controlPump:
                  options.controlPump,
              }
            : {}),
        };

        try {
          runtimeResult = await runtime.executeTurn(
            runtimePrompt,
            turnOptions,
          );
        } catch (error) {
          if (!isRetryableLeileiosMcpStartupFailure(error)) {
            throw error;
          }
          runtimeResult = await runtime.executeTurn(
            runtimePrompt,
            turnOptions,
          );
        }
      } else {
        runtimeResult = command.runtime_mode === "new"
          ? await runtime.sendNew(runtimePrompt)
          : await runtime.fork(
              command.parent_provider_session_id!,
              runtimePrompt,
            );
      }
    } catch (error) {
      const errorCode = runtimeFailureCode(error);
      if (this.onRuntimeFailure) {
        try {
          this.onRuntimeFailure(
            runtimeFailureDiagnostics(
              command.prepare_id,
              errorCode,
              error,
            ),
          );
        } catch {
          // Diagnostics must never alter runtime failure semantics.
        }
      }
      return failure(
        command,
        errorCode,
        runtimeMetadataFromFailure(error),
      );
    } finally {
      if (this.attachmentMaterializer) {
        await this.attachmentMaterializer
          .cleanup(command)
          .catch(() => undefined);
      }
    }

    if (!runtimeResult.providerSessionId) {
      return failure(command, "NO_PROVIDER_SESSION");
    }

    if (
      command.runtime_mode === "fork"
      && runtimeResult.providerSessionId === command.parent_provider_session_id
    ) {
      return failure(command, "PROVIDER_SESSION_CONFLICT");
    }

    const runtimeMetadata = await this.buildRuntimeMetadata(
      command,
      runtimeResult,
      binding.runtime,
    );

    return {
      protocol_version: command.protocol_version,
      prepare_id: command.prepare_id,
      request_id: command.request_id,
      conversation_id: command.conversation_id,
      status: "success",
      provider_session_id: runtimeResult.providerSessionId,
      workspace_id: command.workspace_id,
      effective_workspace_root: binding.workspaceRoot,
      normalized_events:
        terminalFallbackEvents(runtimeResult.normalizedEvents),
      ...(outputAttachmentIds.length > 0
        ? { output_attachment_ids: outputAttachmentIds }
        : {}),
      ...(runtimeMetadata
        ? { runtime_metadata: runtimeMetadata }
        : {}),
    };
  }

  private async buildRuntimeMetadata(
    _command: NativeLiveRuntimeCommand,
    runtimeResult: NativeLiveForegroundRuntimeResult,
    _runtime: NativeLiveForegroundRuntime,
  ): Promise<NativeLiveRuntimeMetadata | null> {
    const contextUsage = runtimeResult.contextUsage ?? null;
    const execution =
      runtimeResult.executionReadback
        ? {
            readback: {
              requested:
                runtimeResult.executionReadback.requested,
              applied:
                runtimeResult.executionReadback.applied,
              capability:
                runtimeResult.executionReadback.capability,
            },
            readback_error:
              runtimeResult.executionReadbackError
                ? "READBACK_UNAVAILABLE" as const
                : null,
          }
        : null;
    const environment =
      runtimeEnvironmentFromNormalizedEvents(
        runtimeResult.normalizedEvents,
      );
    const result =
      runtimeResultTelemetryFromNormalizedEvents(
        runtimeResult.normalizedEvents,
      );
    const outputResources =
      runtimeOutputResourcesFromNormalizedEvents(
        runtimeResult.normalizedEvents,
      );
    const vcsChanges =
      runtimeVcsChangesFromNormalizedEvents(
        runtimeResult.normalizedEvents,
      );
    const sessionStore =
      runtimeResult.sessionStoreObservability
        ? (() => {
            try {
              return parseNativeLiveRuntimeSessionStoreHealth(
                runtimeResult.sessionStoreObservability,
              );
            } catch {
              return null;
            }
          })()
        : null;

    if (
      !contextUsage
      && !execution
      && !environment
      && !result
      && outputResources.length === 0
      && vcsChanges.length === 0
      && !sessionStore
    ) return null;

    return {
      context_usage: contextUsage,
      ...(execution ? { execution } : {}),
      ...(environment ? { environment } : {}),
      ...(result ? { result } : {}),
      ...(outputResources.length > 0
        ? { output_resources: outputResources }
        : {}),
      ...(vcsChanges.length > 0
        ? { vcs_changes: vcsChanges }
        : {}),
      ...(sessionStore
        ? { session_store: sessionStore }
        : {}),
    };
  }

  private async resolveRuntime(
    command: NativeLiveRuntimeCommand,
  ): Promise<{
    runtime: NativeLiveForegroundRuntime;
    workspaceRoot: string;
  }> {
    if (this.resolver) {
      return this.resolver.resolveWorkspaceRuntime({
        workspaceId: command.workspace_id,
        expectedWorkspaceRoot: command.expected_workspace_root,
      });
    }
    if (!this.runtime || command.workspace_id !== null) {
      throw Object.assign(
        new Error("Native Live Workspace runtime is unavailable."),
        { runtimeCode: "WORKSPACE_UNAVAILABLE" },
      );
    }
    if (
      command.expected_workspace_root !== null
      && command.expected_workspace_root !== this.fallbackWorkspaceRoot
    ) {
      throw Object.assign(
        new Error("Native Live Workspace root does not match the runtime."),
        { runtimeCode: "WORKSPACE_ROOT_MISMATCH" },
      );
    }
    return {
      runtime: this.runtime,
      workspaceRoot: this.fallbackWorkspaceRoot,
    };
  }
}

const LEILEIOS_MCP_STARTUP_ERROR =
  "LeileiOS MCP did not connect before the Claude turn started.";

const TERMINAL_RESULT_RUNTIME_ONLY_EVENT_TYPES =
  new Set<string>([
    "session",
    "partial_text",
    "task",
    "runtime",
    "compaction",
  ]);

function terminalFallbackEvents(
  events: readonly NativeLiveNormalizedEvent[],
): NativeLiveNormalizedEvent[] {
  return events.filter(
    (event) =>
      !TERMINAL_RESULT_RUNTIME_ONLY_EVENT_TYPES.has(
        String(event.type),
      ),
  );
}

function runtimeResultTelemetryFromNormalizedEvents(
  events: readonly NativeLiveNormalizedEvent[],
) {
  const result = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "result"
        && event.payload
        && typeof event.payload.telemetry === "object"
        && event.payload.telemetry !== null
        && !Array.isArray(event.payload.telemetry),
    );
  if (!result?.payload?.telemetry) return null;
  try {
    return parseNativeLiveRuntimeResultTelemetry(
      result.payload.telemetry,
    );
  } catch {
    // Provider observability is auxiliary. A malformed telemetry projection
    // must not rewrite the canonical turn outcome.
    return null;
  }
}

function runtimeMetadataFromFailure(
  error: unknown,
): NativeLiveRuntimeMetadata | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const normalizedEvents =
    Array.isArray(record.normalizedEvents)
      ? record.normalizedEvents.filter(
          (event): event is NativeLiveNormalizedEvent =>
            Boolean(
              event
              && typeof event === "object"
              && typeof (event as Record<string, unknown>).type === "string",
            ),
        )
      : [];
  const result =
    runtimeResultTelemetryFromNormalizedEvents(
      normalizedEvents,
    );
  const environment =
    runtimeEnvironmentFromNormalizedEvents(
      normalizedEvents,
    );
  const outputResources =
    runtimeOutputResourcesFromNormalizedEvents(
      normalizedEvents,
    );
  const vcsChanges =
    runtimeVcsChangesFromNormalizedEvents(
      normalizedEvents,
    );
  const sessionStore =
    runtimeSessionStoreHealthFromFailure(record);

  if (
    !result
    && !environment
    && outputResources.length === 0
    && vcsChanges.length === 0
    && !sessionStore
  ) return null;
  return {
    context_usage: null,
    ...(environment ? { environment } : {}),
    ...(result ? { result } : {}),
    ...(outputResources.length > 0
      ? { output_resources: outputResources }
      : {}),
    ...(vcsChanges.length > 0
      ? { vcs_changes: vcsChanges }
      : {}),
    ...(sessionStore
      ? { session_store: sessionStore }
      : {}),
  };
}

function runtimeSessionStoreHealthFromFailure(
  record: Record<string, unknown>,
): NativeLiveRuntimeSessionStoreHealth | null {
  if (!record.sessionStoreObservability) return null;
  try {
    return parseNativeLiveRuntimeSessionStoreHealth(
      record.sessionStoreObservability,
    );
  } catch {
    // SessionStore health is auxiliary observability. Malformed diagnostics
    // must not change the canonical provider failure.
    return null;
  }
}

function runtimeVcsChangesFromNormalizedEvents(
  events: readonly NativeLiveNormalizedEvent[],
) {
  const candidates: unknown[] = [];

  for (const event of events) {
    if (event.type !== "runtime") continue;
    const payload = event.payload ?? {};
    if (payload.kind !== "vcs_state_changed") continue;

    const mutationKind =
      typeof payload.mutation_kind === "string"
        ? payload.mutation_kind
        : null;
    const cwd =
      typeof payload.cwd === "string"
        ? payload.cwd
        : null;
    if (!mutationKind?.trim() || !cwd?.trim()) continue;

    candidates.push({
      mutation_kind: mutationKind,
      cwd,
      branch:
        typeof payload.branch === "string"
          ? payload.branch
          : null,
    });
    if (candidates.length >= 64) break;
  }

  try {
    return parseNativeLiveRuntimeVcsChanges(candidates);
  } catch {
    // VCS mutation hints are auxiliary observability. Malformed provider
    // telemetry must never rewrite the canonical turn outcome.
    return [];
  }
}

function runtimeOutputResourcesFromNormalizedEvents(
  events: readonly NativeLiveNormalizedEvent[],
) {
  const candidates: unknown[] = [];

  for (const event of events) {
    const payload = event.payload ?? {};
    const source =
      event.type === "tool_result"
        ? "tool_result"
        : event.type === "task"
          && payload.phase === "notification"
          ? "task_notification"
          : null;
    if (!source || !Array.isArray(payload.resource_links)) {
      continue;
    }

    const toolUseId =
      typeof payload.tool_use_id === "string"
        ? payload.tool_use_id
        : null;
    const taskId =
      source === "task_notification"
      && typeof payload.task_id === "string"
        ? payload.task_id
        : null;

    for (const link of payload.resource_links) {
      if (
        !link
        || typeof link !== "object"
        || Array.isArray(link)
      ) {
        continue;
      }
      const record = link as Record<string, unknown>;
      const uri =
        typeof record.uri === "string"
          ? record.uri
          : null;
      if (!uri) continue;

      candidates.push({
        source,
        tool_use_id: toolUseId,
        task_id: taskId,
        uri,
        name:
          typeof record.name === "string"
            ? record.name
            : null,
        title:
          typeof record.title === "string"
            ? record.title
            : null,
        description:
          typeof record.description === "string"
            ? record.description
            : null,
        mime_type:
          typeof record.mime_type === "string"
            ? record.mime_type
            : null,
        size:
          typeof record.size === "number"
            ? record.size
            : null,
        annotations:
          record.annotations
          && typeof record.annotations === "object"
          && !Array.isArray(record.annotations)
            ? record.annotations
            : null,
        metadata:
          record.metadata
          && typeof record.metadata === "object"
          && !Array.isArray(record.metadata)
            ? record.metadata
            : null,
      });

      if (candidates.length >= 128) break;
    }
    if (candidates.length >= 128) break;
  }

  try {
    return parseNativeLiveRuntimeOutputResources(
      candidates,
    );
  } catch {
    // Resource references are observability/provenance. Malformed provider
    // metadata must not change the canonical turn outcome.
    return [];
  }
}

function runtimeEnvironmentFromNormalizedEvents(
  events: readonly NativeLiveNormalizedEvent[],
) {
  const session = events.find(
    (event) =>
      event.type === "session"
      && event.payload
      && typeof event.payload.environment === "object"
      && event.payload.environment !== null
      && !Array.isArray(event.payload.environment),
  );
  if (!session?.payload?.environment) return null;
  try {
    return parseNativeLiveRuntimeEnvironment(
      session.payload.environment,
    );
  } catch {
    // Observability must never turn a successful provider execution into
    // a canonical failure. Malformed/unknown init data is ignored here;
    // the normalized runtime event remains available for diagnosis.
    return null;
  }
}

function isRetryableLeileiosMcpStartupFailure(
  error: unknown,
): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message !== LEILEIOS_MCP_STARTUP_ERROR) return false;
  const record = error as unknown as Record<string, unknown>;
  if (
    record.runtimeCode !== undefined
    && record.runtimeCode !== "RUNTIME_UNAVAILABLE"
  ) {
    return false;
  }
  if (
    typeof record.providerSessionId === "string"
    && record.providerSessionId.trim()
  ) {
    return false;
  }
  if (
    Array.isArray(record.events)
    && record.events.length > 0
  ) {
    return false;
  }
  if (
    Array.isArray(record.normalizedEvents)
    && record.normalizedEvents.length > 0
  ) {
    return false;
  }
  return true;
}

function runtimeFailureDiagnostics(
  prepareId: string,
  runtimeCode: NativeLiveRuntimeFailureCode,
  error: unknown,
): NativeLiveMacRuntimeFailureDiagnostics {
  const record =
    error && typeof error === "object"
      ? error as Record<string, unknown>
      : {};
  const cause =
    record.cause && typeof record.cause === "object"
      ? record.cause as Record<string, unknown>
      : {};
  const result =
    record.result && typeof record.result === "object"
      ? record.result as Record<string, unknown>
      : {};
  const events = Array.isArray(record.events)
    ? record.events
    : [];
  const normalizedEvents =
    Array.isArray(record.normalizedEvents)
      ? record.normalizedEvents
      : [];

  const resultErrors = Array.isArray(result.errors)
    ? result.errors
        .map((value) => boundedDiagnosticText(value))
        .filter((value): value is string => Boolean(value))
        .slice(0, 3)
    : [];

  return {
    prepareId,
    runtimeCode,
    ...(error instanceof Error
      ? {
          errorName: boundedDiagnosticText(error.name) ?? "Error",
          ...(boundedDiagnosticText(error.message)
            ? { errorMessage: boundedDiagnosticText(error.message)! }
            : {}),
        }
      : {}),
    ...(typeof cause.name === "string"
      ? { causeName: boundedDiagnosticText(cause.name)! }
      : {}),
    ...(typeof cause.message === "string"
      ? { causeMessage: boundedDiagnosticText(cause.message)! }
      : {}),
    ...(typeof cause.code === "string"
      ? { causeCode: boundedDiagnosticText(cause.code)! }
      : {}),
    ...(typeof record.providerSessionId === "string"
      ? {
          providerSessionId:
            boundedDiagnosticText(record.providerSessionId)!,
        }
      : {}),
    ...(typeof result.subtype === "string"
      ? { resultSubtype: boundedDiagnosticText(result.subtype)! }
      : {}),
    ...(typeof result.is_error === "boolean"
      ? { resultIsError: result.is_error }
      : {}),
    ...(resultErrors.length > 0
      ? { resultErrorMessages: resultErrors }
      : {}),
    eventCount: events.length,
    normalizedEventCount: normalizedEvents.length,
    lastRawEventTypes: events
      .slice(-6)
      .map(describeRawEvent)
      .filter((value): value is string => Boolean(value)),
    lastNormalizedEventTypes: normalizedEvents
      .slice(-6)
      .map((value) =>
        value
        && typeof value === "object"
        && typeof (value as Record<string, unknown>).type === "string"
          ? boundedDiagnosticText(
              (value as Record<string, unknown>).type,
            )
          : null
      )
      .filter((value): value is string => Boolean(value)),
  };
}

function describeRawEvent(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type =
    typeof record.type === "string"
      ? boundedDiagnosticText(record.type)
      : null;
  const subtype =
    typeof record.subtype === "string"
      ? boundedDiagnosticText(record.subtype)
      : null;
  if (!type) return subtype;
  return subtype ? `${type}:${subtype}` : type;
}

function boundedDiagnosticText(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  let text = value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/giu, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, "sk-[redacted]")
    .replace(/\/Users\/[^/\s]+/gu, "~")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) return null;
  if (text.length > 320) {
    text = text.slice(0, 317) + "...";
  }
  return text;
}

function failure(
  command: NativeLiveRuntimeCommand,
  errorCode: NativeLiveRuntimeFailureCode,
  runtimeMetadata: NativeLiveRuntimeMetadata | null = null,
): NativeLiveRuntimeExecutionResult {
  return {
    protocol_version: command.protocol_version,
    prepare_id: command.prepare_id,
    request_id: command.request_id,
    conversation_id: command.conversation_id,
    status: "failure",
    error_code: errorCode,
    ...(runtimeMetadata
      ? { runtime_metadata: runtimeMetadata }
      : {}),
  };
}

function runtimeFailureCode(error: unknown): NativeLiveRuntimeFailureCode {
  if (
    typeof error === "object"
    && error !== null
    && "runtimeCode" in error
    && isRuntimeFailureCode((error as { runtimeCode?: unknown }).runtimeCode)
  ) {
    return (error as { runtimeCode: NativeLiveRuntimeFailureCode }).runtimeCode;
  }
  return "RUNTIME_UNAVAILABLE";
}

function isRuntimeFailureCode(
  value: unknown,
): value is NativeLiveRuntimeFailureCode {
  return (
    value === "CLAUDE_PROCESS_FAILED"
    || value === "MALFORMED_STREAM"
    || value === "ABORTED"
    || value === "INTERRUPTED"
    || value === "NO_PROVIDER_SESSION"
    || value === "PROVIDER_SESSION_CONFLICT"
    || value === "WORKSPACE_UNAVAILABLE"
    || value === "WORKSPACE_ROOT_MISMATCH"
    || value === "ATTACHMENT_UNAVAILABLE"
    || value === "RUNTIME_UNAVAILABLE"
  );
}
