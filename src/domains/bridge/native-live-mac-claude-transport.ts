import type {
  NativeLiveClaudeRuntime,
  NativeLiveNormalizedEvent,
  NativeLiveRuntimeResult,
} from "../conversation/native-live-conversation-orchestrator.js";
import type { NativeLiveExecutionSelection } from "./native-live-execution-selection.js";
import type {
  NativeLiveRuntimeCompactionAdvisory,
  NativeLiveRuntimeContextUsage,
  NativeLiveRuntimeExecutionReadback,
} from "./native-live-runtime-protocol.js";

export type NativeLiveMacClaudeTransportKind =
  | "agent_sdk"
  | "headless";

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
    executeTurn?(
      prompt: string,
      options: NativeLiveMacInteractiveTurnOptions,
    ): Promise<NativeLiveRuntimeResult & {
      contextUsage?: NativeLiveRuntimeContextUsage | null;
      compactionAdvisory?:
        NativeLiveRuntimeCompactionAdvisory | null;
      executionReadback?:
        NativeLiveRuntimeExecutionReadback | null;
      executionReadbackError?: string | null;
    }>;
    compact?(
      sessionId: string,
      execution?: NativeLiveExecutionSelection | null,
    ): Promise<NativeLiveRuntimeResult & {
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

  if (!configured) return "agent_sdk";
  if (configured === "agent_sdk" || configured === "headless") {
    return configured;
  }

  throw new Error(
    "LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT must be agent_sdk or headless.",
  );
}

export async function createNativeLiveMacClaudeTransport(
  environment: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<{
  kind: NativeLiveMacClaudeTransportKind;
  runtime: NativeLiveMacClaudeTransport;
}> {
  const kind =
    resolveNativeLiveMacClaudeTransportKind(environment);

  if (kind === "agent_sdk") {
    const agentSdkModulePath =
      "../../../tools/claude-bridge/src/agent-sdk-claude-transport.mjs";
    const { AgentSdkClaudeTransport } = (await import(
      agentSdkModulePath
    )) as {
      AgentSdkClaudeTransport: new (options: {
        environment: NodeJS.ProcessEnv;
        cwd: string;
      }) => NativeLiveMacClaudeTransport;
    };
    return {
      kind,
      runtime: new AgentSdkClaudeTransport({
        environment,
        cwd,
      }),
    };
  }

  const headlessModulePath =
    "../../../tools/claude-bridge/src/headless-claude-transport.mjs";
  const { HeadlessClaudeTransport } = (await import(
    headlessModulePath
  )) as {
    HeadlessClaudeTransport: new (options: {
      environment: NodeJS.ProcessEnv;
    }) => NativeLiveMacClaudeTransport;
  };
  return {
    kind,
    runtime: new HeadlessClaudeTransport({
      environment,
    }),
  };
}
