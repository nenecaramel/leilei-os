import type {
  NativeLiveClaudeRuntime,
  NativeLiveNormalizedEvent,
  NativeLiveRuntimeResult,
} from "../conversation/native-live-conversation-orchestrator.js";

type NativeLiveForegroundRuntime = NativeLiveClaudeRuntime & {
  executeTurn?: (
    prompt: string,
    options: {
      mode: "new" | "fork";
      parentProviderSessionId: string | null;
      streaming: boolean;
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
    },
  ) => Promise<NativeLiveRuntimeResult>;
};
import {
  NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
  parseNativeLiveRuntimeCommand,
  type NativeLiveRuntimeCommand,
  type NativeLiveRuntimeExecutionResult,
  type NativeLiveRuntimeFailureCode,
} from "./native-live-runtime-protocol.js";

export class NativeLiveMacRuntimeExecutor {
  constructor(private readonly runtime: NativeLiveForegroundRuntime) {}

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
    } = {},
  ): Promise<NativeLiveRuntimeExecutionResult> {
    const command = parseNativeLiveRuntimeCommand(rawCommand);

    let runtimeResult: NativeLiveRuntimeResult;
    try {
      runtimeResult = this.runtime.executeTurn
        ? await this.runtime.executeTurn(
            command.prompt,
            {
              mode: command.runtime_mode,
              parentProviderSessionId:
                command.parent_provider_session_id,
              streaming: true,
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
            },
          )
        : command.runtime_mode === "new"
          ? await this.runtime.sendNew(command.prompt)
          : await this.runtime.fork(
              command.parent_provider_session_id!,
              command.prompt,
            );
    } catch (error) {
      return failure(command, runtimeFailureCode(error));
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

    return {
      protocol_version: NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
      prepare_id: command.prepare_id,
      request_id: command.request_id,
      conversation_id: command.conversation_id,
      status: "success",
      provider_session_id: runtimeResult.providerSessionId,
      normalized_events: [...runtimeResult.normalizedEvents],
    };
  }
}

function failure(
  command: NativeLiveRuntimeCommand,
  errorCode: NativeLiveRuntimeFailureCode,
): NativeLiveRuntimeExecutionResult {
  return {
    protocol_version: NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
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
    || value === "NO_PROVIDER_SESSION"
    || value === "PROVIDER_SESSION_CONFLICT"
    || value === "RUNTIME_UNAVAILABLE"
  );
}
