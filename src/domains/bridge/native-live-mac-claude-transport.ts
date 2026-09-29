import { isAbsolute } from "node:path";
import type {
  NativeLiveClaudeRuntime,
  NativeLiveNormalizedEvent,
  NativeLiveRuntimeResult,
} from "../conversation/native-live-conversation-orchestrator.js";
import type { NativeLiveExecutionSelection } from "./native-live-execution-selection.js";
import type {
  NativeLiveRuntimeContextUsage,
  NativeLiveRuntimeExecutionReadback,
} from "./native-live-runtime-protocol.js";

export type NativeLiveMacClaudeTransportKind = "agent_sdk";

export type NativeLiveMacActiveTurnController = {
  sendUserMessage(text: string): Record<string, unknown>;
  interrupt(): Promise<Record<string, unknown>>;
};

export type NativeLiveMacInteractiveTurnOptions = {
  mode: "new" | "resume" | "fork";
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
};

export type NativeLiveMacClaudeTransport =
  NativeLiveClaudeRuntime & {
    abort(): void;
    deleteSession(sessionId: string): Promise<void>;
    executeTurn?(
      prompt: string,
      options: NativeLiveMacInteractiveTurnOptions,
    ): Promise<NativeLiveRuntimeResult & {
      contextUsage?: NativeLiveRuntimeContextUsage | null;
      executionReadback?:
        NativeLiveRuntimeExecutionReadback | null;
      executionReadbackError?: string | null;
    }>;
    compact?(
      sessionId: string,
      execution?: NativeLiveExecutionSelection | null,
    ): Promise<NativeLiveRuntimeResult & {
      contextUsage?: NativeLiveRuntimeContextUsage | null;
      compaction?: {
        boundary?: Record<string, unknown> | null;
        postCompact?: Array<{
          summary?: string | null;
        }>;
      };
    }>;
  };

export function resolveNativeLiveMacClaudeTransportKind(
  environment: NodeJS.ProcessEnv,
): NativeLiveMacClaudeTransportKind {
  const configured =
    environment.LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT
      ?.trim()
      .toLowerCase();

  if (!configured || configured === "agent_sdk") {
    return "agent_sdk";
  }

  throw new Error(
    "LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT is retired; native live uses agent_sdk only.",
  );
}

export async function createNativeLiveMacClaudeTransport(
  environment: NodeJS.ProcessEnv = process.env,
  workspaceRoot?: string,
  sessionStore: unknown = null,
): Promise<{
  kind: NativeLiveMacClaudeTransportKind;
  runtime: NativeLiveMacClaudeTransport;
}> {
  const normalizedWorkspaceRoot = workspaceRoot?.trim();
  if (
    !normalizedWorkspaceRoot
    || !isAbsolute(normalizedWorkspaceRoot)
  ) {
    throw new Error(
      "Native Live Mac Claude transport requires an explicit absolute workspace root.",
    );
  }

  const kind =
    resolveNativeLiveMacClaudeTransportKind(environment);
  const agentSdkModulePath =
    "../../../tools/claude-bridge/src/agent-sdk-claude-transport.mjs";
  const { AgentSdkClaudeTransport } = (await import(
    agentSdkModulePath
  )) as {
    AgentSdkClaudeTransport: new (options: {
      environment: NodeJS.ProcessEnv;
      cwd: string;
      sessionStore?: unknown;
    }) => NativeLiveMacClaudeTransport;
  };

  return {
    kind,
    runtime: new AgentSdkClaudeTransport({
      environment,
      cwd: normalizedWorkspaceRoot,
      ...(sessionStore ? { sessionStore } : {}),
    }),
  };
}
