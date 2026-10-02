import type {
  NativeLiveClaudeRuntime,
  NativeLiveNormalizedEvent,
} from "../../conversation/native-live-conversation-orchestrator.js";
import {
  canonicalizeNativeLiveEvents,
} from "../../conversation/native-live-conversation-orchestrator.js";
import {
  MAX_BACKGROUND_MODEL_OUTPUT_CHARS,
  NATIVE_LIVE_BACKGROUND_MODEL_PROTOCOL_VERSION,
  parseNativeLiveBackgroundModelCommand,
  type NativeLiveBackgroundModelCommand,
  type NativeLiveBackgroundModelExecutionResult,
  type NativeLiveBackgroundModelFailureCode,
} from "../background/native-live-background-model-protocol.js";

export class NativeLiveMacBackgroundModelExecutor {
  constructor(private readonly runtime: Pick<NativeLiveClaudeRuntime, "sendNew">) {}

  async execute(
    rawCommand: unknown,
  ): Promise<NativeLiveBackgroundModelExecutionResult> {
    const command = parseNativeLiveBackgroundModelCommand(rawCommand);

    let events: NativeLiveNormalizedEvent[];
    try {
      const result = await this.runtime.sendNew(command.prompt);
      events = [...result.normalizedEvents];
    } catch (error) {
      return failure(command, runtimeFailureCode(error));
    }

    if (
      events.some(
        (event) => event.type === "tool_use" || event.type === "tool_result",
      )
    ) {
      return failure(command, "TOOL_USE_FORBIDDEN");
    }

    const text = readFinalText(events);
    if (!text) {
      return failure(command, "RUNTIME_OUTPUT_ERROR");
    }

    return {
      protocol_version: NATIVE_LIVE_BACKGROUND_MODEL_PROTOCOL_VERSION,
      task_id: command.task_id,
      task_kind: command.task_kind,
      status: "success",
      final_text: text,
    };
  }
}

function readFinalText(
  events: readonly NativeLiveNormalizedEvent[],
): string | null {
  let finalText: string | null = null;
  for (const event of events) {
    if (event.type !== "result") continue;
    const payload = event.payload ?? {};
    if (payload.status === "error") return null;
    if (
      typeof payload.final_text === "string"
      && payload.final_text.trim()
    ) {
      finalText = payload.final_text.trim();
    }
  }

  const candidate = finalText ?? canonicalText(events);
  if (
    !candidate
    || [...candidate].length > MAX_BACKGROUND_MODEL_OUTPUT_CHARS
  ) {
    return null;
  }
  return candidate;
}

function canonicalText(
  events: readonly NativeLiveNormalizedEvent[],
): string | null {
  const canonical = canonicalizeNativeLiveEvents(events);
  if (canonical.error) return null;
  const text = canonical.blocks
    .filter(
      (block) =>
        block.kind === "text"
        && typeof block.text === "string",
    )
    .map((block) => block.text!.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return text || null;
}

function failure(
  command: NativeLiveBackgroundModelCommand,
  errorCode: NativeLiveBackgroundModelFailureCode,
): NativeLiveBackgroundModelExecutionResult {
  return {
    protocol_version: NATIVE_LIVE_BACKGROUND_MODEL_PROTOCOL_VERSION,
    task_id: command.task_id,
    task_kind: command.task_kind,
    status: "failure",
    error_code: errorCode,
  };
}

function runtimeFailureCode(
  error: unknown,
): NativeLiveBackgroundModelFailureCode {
  if (
    typeof error === "object"
    && error !== null
    && "runtimeCode" in error
  ) {
    const code = (error as { runtimeCode?: unknown }).runtimeCode;
    if (
      code === "CLAUDE_PROCESS_FAILED"
      || code === "MALFORMED_STREAM"
      || code === "ABORTED"
      || code === "RUNTIME_UNAVAILABLE"
    ) {
      return code;
    }
  }
  return "RUNTIME_UNAVAILABLE";
}
