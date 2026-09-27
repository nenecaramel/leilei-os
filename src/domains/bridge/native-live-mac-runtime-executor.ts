import type {
  NativeLiveClaudeRuntime,
  NativeLiveNormalizedEvent,
  NativeLiveRuntimeResult,
} from "../conversation/native-live-conversation-orchestrator.js";

type NativeLiveForegroundRuntimeResult =
  NativeLiveRuntimeResult & {
    contextUsage?: NativeLiveRuntimeContextUsage | null;
    compactionAdvisory?:
      NativeLiveRuntimeCompactionAdvisory | null;
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
import {
  NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
  parseNativeLiveRuntimeCommand,
  type NativeLiveRuntimeCommand,
  type NativeLiveRuntimeCompactionAdvisory,
  type NativeLiveRuntimeContextUsage,
  type NativeLiveRuntimeExecutionReadback,
  type NativeLiveRuntimeExecutionResult,
  type NativeLiveRuntimeFailureCode,
  type NativeLiveRuntimeMetadata,
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
      controlPump?: (
        controller: NativeLiveMacActiveTurnController,
        context: { signal: AbortSignal },
      ) => Promise<void>;
    } = {},
  ): Promise<NativeLiveRuntimeExecutionResult> {
    const command = parseNativeLiveRuntimeCommand(rawCommand);

    let runtimeResult: NativeLiveForegroundRuntimeResult;
    try {
      runtimeResult = this.runtime.executeTurn
        ? await this.runtime.executeTurn(
            command.prompt,
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
              ...(options.controlPump
                ? {
                    controlPump:
                      options.controlPump,
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

    const runtimeMetadata = await this.buildRuntimeMetadata(
      command,
      runtimeResult,
    );

    return {
      protocol_version: NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
      prepare_id: command.prepare_id,
      request_id: command.request_id,
      conversation_id: command.conversation_id,
      status: "success",
      provider_session_id: runtimeResult.providerSessionId,
      normalized_events: [...runtimeResult.normalizedEvents],
      ...(runtimeMetadata
        ? { runtime_metadata: runtimeMetadata }
        : {}),
    };
  }

  private async buildRuntimeMetadata(
    command: NativeLiveRuntimeCommand,
    runtimeResult: NativeLiveForegroundRuntimeResult,
  ): Promise<NativeLiveRuntimeMetadata | null> {
    const advisory = runtimeResult.compactionAdvisory ?? null;
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

    if (!advisory && !contextUsage && !execution) return null;

    if (!advisory) {
      return {
        context_usage: contextUsage,
        compaction_advisory: null,
        compaction: null,
        ...(execution ? { execution } : {}),
      };
    }

    if (!advisory.due) {
      return {
        context_usage: contextUsage,
        compaction_advisory: advisory,
        compaction: {
          source: "runtime_threshold",
          attempted: false,
          outcome: "not_due",
          boundary: null,
          summary: null,
          failure_code: null,
        },
        ...(execution ? { execution } : {}),
      };
    }

    if (!this.runtime.compact) {
      return {
        context_usage: contextUsage,
        compaction_advisory: advisory,
        compaction: {
          source: "runtime_threshold",
          attempted: false,
          outcome: "unsupported",
          boundary: null,
          summary: null,
          failure_code: "COMPACT_UNSUPPORTED",
        },
        ...(execution ? { execution } : {}),
      };
    }

    try {
      const compacted = await this.runtime.compact(
        runtimeResult.providerSessionId!,
        command.execution_selection ?? null,
      );
      if (
        compacted.providerSessionId
        !== runtimeResult.providerSessionId
      ) {
        throw Object.assign(
          new Error(
            "Automatic compact changed provider session identity.",
          ),
          { runtimeCode: "PROVIDER_SESSION_CONFLICT" },
        );
      }

      return {
        context_usage:
          compacted.contextUsage ?? contextUsage,
        compaction_advisory: advisory,
        compaction: {
          source: "runtime_threshold",
          attempted: true,
          outcome: "succeeded",
          boundary:
            compacted.compaction?.boundary ?? null,
          summary: latestCompactSummary(
            compacted.compaction?.postCompact,
          ),
          failure_code: null,
        },
        ...(execution ? { execution } : {}),
      };
    } catch {
      return {
        context_usage: contextUsage,
        compaction_advisory: advisory,
        compaction: {
          source: "runtime_threshold",
          attempted: true,
          outcome: "failed",
          boundary: null,
          summary: null,
          failure_code: "COMPACT_FAILED",
        },
        ...(execution ? { execution } : {}),
      };
    }
  }
}

function latestCompactSummary(
  values:
    | Array<{ summary?: string | null }>
    | undefined,
): string | null {
  if (!values) return null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const summary = values[index]?.summary;
    if (typeof summary === "string" && summary.trim()) {
      return summary.trim();
    }
  }
  return null;
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
    || value === "INTERRUPTED"
    || value === "NO_PROVIDER_SESSION"
    || value === "PROVIDER_SESSION_CONFLICT"
    || value === "RUNTIME_UNAVAILABLE"
  );
}
