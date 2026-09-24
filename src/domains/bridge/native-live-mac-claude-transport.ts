import type {
  NativeLiveClaudeRuntime,
} from "../conversation/native-live-conversation-orchestrator.js";

export type NativeLiveMacClaudeTransportKind =
  | "agent_sdk"
  | "headless";

export type NativeLiveMacClaudeTransport =
  NativeLiveClaudeRuntime & {
    abort(): void;
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
    const { AgentSdkClaudeTransport } = await import(
      "../../../tools/claude-bridge/src/agent-sdk-claude-transport.mjs"
    );
    return {
      kind,
      runtime: new AgentSdkClaudeTransport({
        environment,
        cwd,
      }) as NativeLiveMacClaudeTransport,
    };
  }

  const { HeadlessClaudeTransport } = await import(
    "../../../tools/claude-bridge/src/headless-claude-transport.mjs"
  );
  return {
    kind,
    runtime: new HeadlessClaudeTransport({
      environment,
    }) as NativeLiveMacClaudeTransport,
  };
}
