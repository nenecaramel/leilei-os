import type { NativeLiveMemeRuntimeHandlers } from "./native-live-mac-meme-sender.js";
import { isAbsolute } from "node:path";
import type {
  NativeLiveClaudeRuntime,
  NativeLiveNormalizedEvent,
  NativeLiveRuntimeResult,
} from "../../conversation/native-live-conversation-orchestrator.js";
import type { NativeLiveExecutionSelection } from "../turn/native-live-execution-selection.js";
import type {
  NativeLiveRuntimeContextUsage,
  NativeLiveRuntimeExecutionReadback,
} from "../protocol/native-live-runtime-protocol.js";
import type {
  NativeLiveClaudeAlbumRuntimeHandlers,
} from "../../album/claude-photo-album-tool-contract.js";

export type NativeLiveMacClaudeTransportKind = "agent_sdk";

export type NativeLiveMacMcpServerConfig = {
  type: "http";
  url: string;
  headers: Readonly<Record<string, string>>;
};

export type NativeLiveMacAlbumToolHandlers =
  NativeLiveClaudeAlbumRuntimeHandlers;

export type NativeLiveMacActiveTurnController = {
  sendUserMessage(
    text: string,
    options?: { uuid?: string | null },
  ): Record<string, unknown>;
  interrupt(): Promise<Record<string, unknown>>;
};

export type NativeLiveMacInteractiveTurnOptions = {
  mode: "new" | "resume" | "fork";
  parentProviderSessionId: string | null;
  parentProviderCheckpointId?: string | null;
  requireProviderCheckpoint?: boolean;
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
  albumHandlers?: NativeLiveMacAlbumToolHandlers;
  controlPump?: (
    controller: NativeLiveMacActiveTurnController,
    context: { signal: AbortSignal },
  ) => Promise<void>;
};

export type NativeLiveMacClaudeTransport =
  NativeLiveClaudeRuntime & {
    abort(): void;
    deleteSession(sessionId: string): Promise<void>;
    forkSessionAtCheckpoint?(
      sessionId: string,
      checkpointId: string,
    ): Promise<{
      providerSessionId: string;
    }>;
    listSessions?(input?: {
      allDirectories?: boolean;
      limit?: number;
      offset?: number;
    }): Promise<Array<{
      sessionId: string;
      summary: string | null;
      customTitle: string | null;
      firstPrompt: string | null;
      gitBranch: string | null;
      cwd: string;
      lastModified: number | null;
      createdAt: number | null;
    }>>;
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
      parentProviderCheckpointId?: string | null,
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
  workingDirectory?: string,
  sessionStore: unknown = null,
  mcpServerConfig: NativeLiveMacMcpServerConfig | null = null,
): Promise<{
  kind: NativeLiveMacClaudeTransportKind;
  runtime: NativeLiveMacClaudeTransport;
}> {
  const normalizedWorkingDirectory = workingDirectory?.trim();
  if (
    !normalizedWorkingDirectory
    || !isAbsolute(normalizedWorkingDirectory)
  ) {
    throw new Error(
      "Native Live Mac Claude transport requires an explicit absolute working directory.",
    );
  }

  const kind =
    resolveNativeLiveMacClaudeTransportKind(environment);
  const agentSdkModulePath =
    "../../../../tools/claude-bridge/src/agent-sdk-claude-transport.mjs";
  const { AgentSdkClaudeTransport } = (await import(
    agentSdkModulePath
  )) as {
    AgentSdkClaudeTransport: new (options: {
      environment: NodeJS.ProcessEnv;
      cwd: string;
      sessionStore?: unknown;
      mcpServerConfig?: NativeLiveMacMcpServerConfig;
    }) => NativeLiveMacClaudeTransport;
  };

  return {
    kind,
    runtime: new AgentSdkClaudeTransport({
      environment: sanitizeNativeLiveClaudeEnvironment(environment),
      cwd: normalizedWorkingDirectory,
      ...(sessionStore ? { sessionStore } : {}),
      ...(mcpServerConfig ? { mcpServerConfig } : {}),
    }),
  };
}

const NATIVE_LIVE_CLAUDE_ENV_DENYLIST = new Set([
  "LEILEI_NATIVE_LIVE_RELAY_TOKEN",
  "NATIVE_LIVE_RELAY_AUTH_TOKEN",
  "MCP_AUTH_TOKEN",
]);

export function sanitizeNativeLiveClaudeEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !NATIVE_LIVE_CLAUDE_ENV_DENYLIST.has(key),
    ),
  );
}
