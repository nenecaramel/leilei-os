import type {
  NativeLiveClaudeRuntime,
  NativeLiveNormalizedEvent,
  NativeLiveRuntimeResult,
} from "../conversation/native-live-conversation-orchestrator.js";

type NativeLiveForegroundRuntimeResult =
  NativeLiveRuntimeResult & {
    contextUsage?: NativeLiveRuntimeContextUsage | null;
    executionReadback?:
      NativeLiveRuntimeExecutionReadback | null;
    executionReadbackError?: string | null;
  };

type NativeLiveForegroundRuntime = NativeLiveClaudeRuntime & {
  executeTurn?: (
    prompt: string,
    options: {
      mode: "new" | "fork";
      parentProviderSessionId: string | null;
      streaming: boolean;
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
import type { NativeLiveExecutionSelection } from "./native-live-execution-selection.js";
import type {
  NativeLiveWorkspaceRuntimeResolver,
} from "./native-live-mac-workspace-runtime.js";
import type {
  NativeLiveMacAttachmentMaterializer,
} from "./native-live-mac-attachment-materializer.js";
import type {
  NativeLiveMacOutputAttachmentSender,
} from "./native-live-mac-output-attachment-sender.js";
import {
  NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
  parseNativeLiveRuntimeCommand,
  type NativeLiveRuntimeCommand,
  type NativeLiveRuntimeContextUsage,
  type NativeLiveRuntimeExecutionReadback,
  type NativeLiveRuntimeExecutionResult,
  type NativeLiveRuntimeFailureCode,
  type NativeLiveRuntimeMetadata,
} from "./native-live-runtime-protocol.js";

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
      NativeLiveMacOutputAttachmentSender | null = null,
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
      runtimeResult = runtime.executeTurn
        ? await runtime.executeTurn(
            runtimePrompt,
            {
              mode: command.runtime_mode,
              parentProviderSessionId:
                command.parent_provider_session_id,
              streaming: true,
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
              ...(this.outputAttachmentSender
                && command.protocol_version
                  === NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION
                ? {
                    sendFileHandler: async (input: {
                      path: string;
                      displayName: string | null;
                    }) => {
                      if (outputAttachmentIds.length >= 8) {
                        throw new Error(
                          "send_file may send at most 8 files in one turn.",
                        );
                      }
                      const attachment =
                        await this.outputAttachmentSender!.sendFile({
                          path: input.path,
                          displayName: input.displayName,
                          workspaceRoot: binding.workspaceRoot,
                        });
                      outputAttachmentIds.push(
                        attachment.attachmentId,
                      );
                      return attachment;
                    },
                  }
                : {}),
              ...(options.controlPump
                ? {
                    controlPump:
                      options.controlPump,
                  }
                : {}),
            },
          )
        : command.runtime_mode === "new"
          ? await runtime.sendNew(runtimePrompt)
          : await runtime.fork(
              command.parent_provider_session_id!,
              runtimePrompt,
            );
    } catch (error) {
      return failure(command, runtimeFailureCode(error));
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
      normalized_events: [...runtimeResult.normalizedEvents],
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

    if (!contextUsage && !execution) return null;

    return {
      context_usage: contextUsage,
      ...(execution ? { execution } : {}),
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

function failure(
  command: NativeLiveRuntimeCommand,
  errorCode: NativeLiveRuntimeFailureCode,
): NativeLiveRuntimeExecutionResult {
  return {
    protocol_version: command.protocol_version,
    prepare_id: command.prepare_id,
    request_id: command.request_id,
    conversation_id: command.conversation_id,
    status: "failure",
    error_code: errorCode,
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
