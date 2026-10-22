import type { NativeLiveMacOutputAttachmentCollector, NativeLiveMacOutputAttachmentReceipt } from "./native-live-mac-output-attachment-collector.js";
import { isAbsolute } from "node:path";
import type { EventEmitter } from "node:events";
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

export type NativeLiveMacClaudeTransportKind = "agent_sdk";

export type NativeLiveMacSessionSource = "human" | "task-notification" | "unclassified";
export type NativeLiveMacSessionResult = {
  providerSessionId: string;
  inputId: string;
  contextUsage?: NativeLiveRuntimeContextUsage | null;
  executionReadback?: NativeLiveRuntimeExecutionReadback | null;
  executionReadbackError?: string | null;
  result: Record<string, unknown>;
  events: Record<string, unknown>[];
  /** Normalized output this turn owns (SDK-stamped), as streamed live. */
  normalizedEvents: NativeLiveNormalizedEvent[];
};
export type NativeLiveMacPersistentTurnOutput = {
  onNormalizedEvent?: NativeLiveMacInteractiveTurnOptions["onNormalizedEvent"];
  toolImageHandler?: NativeLiveMacInteractiveTurnOptions["toolImageHandler"];
  sendFileHandler?: NativeLiveMacInteractiveTurnOptions["sendFileHandler"];
};
/** A handle belongs to exactly one live SDK process and task appearance. */
export type NativeLiveMacTaskState = {
  taskId: string; runId: string | null; handle: string; active: boolean;
  status: "observed" | "pending" | "running" | "paused" | "killed" | "ended" | "completed" | "failed" | "stopped" | "unknown";
  stopStatus: "requested" | "unknown" | null;
  taskType: string | null; description: string | null; parentTaskId: string | null;
  ambient: boolean; summary: string | null;
};
export type NativeLiveMacSessionCloseReason =
  | "EXPLICIT_CLOSE" | "CONTROL_RECEIPT_TIMEOUT" | "EXECUTION_LEASE_REVOKED"
  | "SESSION_LEASE_REVOKED" | "TURN_FAILED" | "EXECUTOR_FAILED" | "BRANCH_REPLACED"
  | "LEGACY_FALLBACK" | "HANDOFF_DRAIN" | "BACKGROUND_RECOVERY_BLOCKED"
  | "BACKGROUND_RECOVERED" | "MANUAL_COMPACT" | "SESSION_CLEANUP" | "DAEMON_SHUTDOWN"
  | "STARTUP_FAILED" | "STARTUP_ABORTED" | "TRANSPORT_ABORT" | "SDK_FAILURE"
  | "INTERRUPT_WITH_BACKGROUND_TASKS" | "BACKGROUND_ACK_FAILED";
export type NativeLiveMacSessionCloseDiagnostic = Readonly<{
  closeId: string; reasonCode: string; phase: "requested" | "completed" | "failed"; state: string;
  providerSessionId: string | null; inputId: string | null;
  pendingInputs: number; backgroundTasks: number; resultReceived: boolean;
  conversationId?: string; generationId?: string; prepareId?: string | null;
}>;

export type NativeLiveMacPersistentSession = {
  readonly state: string;
  readonly sessionId: string | null;
  readonly tasks: ReadonlyMap<string, Record<string, unknown>>;
  events: Pick<EventEmitter, "on" | "off" | "once">;
  completion: Promise<void>;
  submit(text: string, options?: { id?: string; source?: NativeLiveMacSessionSource } & NativeLiveMacPersistentTurnOutput): Promise<NativeLiveMacSessionResult>;
  sendUserMessage(text: string, options?: { uuid?: string | null }): Promise<Record<string, unknown>>;
  interruptTurn(): Promise<{ still_queued: string[] } | null>;
  /** Optional for legacy/test transports; current persistent SDK hosts expose it. */
  listTasks?(): NativeLiveMacTaskState[];
  stopTask(id: string, expected?: { handle: string }): Promise<void>;
  /** Desktop's /model and /effort on the live session; absent on legacy/test transports. */
  applyExecutionSelection?(selection: NativeLiveExecutionSelection | null | undefined): Promise<void>;
  readTaskOutput?(id: string, expected: { handle: string; signal?: AbortSignal }): Promise<{ output: string; totalBytes: number; truncated: boolean }>;
  /** The frame's last top-level assistant record, once durable and descended from the parent. */
  verifyCheckpoint(input: { events: Record<string, unknown>[]; parentCheckpointId: string | null; timeoutMs?: number }): Promise<string>;
  /** Read-only recovery; available only after confirmed native writer closure. */
  recoverCompletedTurn?(input: { inputId: string; parentCheckpointId: string | null }): Promise<{result: NativeLiveMacSessionResult; providerCheckpointId: string} | null>;
  close(reason?: Error): Promise<void>;
};
export type NativeLiveMacSessionFork = Readonly<{ sessionId: string; checkpointId: string }>;
export type NativeLiveMacSessionRestore = Readonly<{
  sessionId: string;
  checkpointId: string;
  inputId: string;
  source: "human" | "task-notification";
  timeoutMs?: number;
  /** Edit: resume this session at the earlier checkpoint over LeileiOS-only turns. */
  rewind?: boolean;
}>;
export type NativeLiveMacPersistentSessionOptions = {
  authorize(context: { phase: "input" | "tool" | "scheduled"; inputId: string | null; source: NativeLiveMacSessionSource | null; providerSessionId: string | null }): Promise<boolean>;
  createBackgroundOutput?(input: {segmentId:string;commandUuid:string}): NativeLiveMacOutputAttachmentCollector;
  onBackgroundResult(frame: { result: Record<string, unknown>; events: Record<string, unknown>[]; normalizedEvents: NativeLiveNormalizedEvent[];
    segmentId?: string; commandUuid?: string;
  } & Partial<NativeLiveMacOutputAttachmentReceipt>): Promise<void>;
  execution?: NativeLiveExecutionSelection | null;
  perTaskStopAffordance?: boolean;
  onCloseDiagnostic?(frame: NativeLiveMacSessionCloseDiagnostic): void;
  permissionHandler?: NativeLiveMacInteractiveTurnOptions["permissionHandler"];
  questionHandler?: NativeLiveMacInteractiveTurnOptions["questionHandler"];
};

export type NativeLiveMacMcpServerConfig = {
  type: "http";
  url: string;
  headers: Readonly<Record<string, string>>;
};

export type NativeLiveMacActiveTurnController = {
  sendUserMessage(
    text: string,
    options?: { uuid?: string | null },
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  interrupt(): Promise<Record<string, unknown>>;
};

export type NativeLiveMacInteractiveTurnOptions = {
  mode: "new" | "resume" | "fork";
  parentProviderSessionId: string | null;
  parentProviderCheckpointId?: string | null;
  requireProviderCheckpoint?: boolean;
  streaming: boolean;
  userMessageUuid?: string | null;
  failedUserMessageUuids?: readonly string[];
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
  toolImageHandler?: (input: { data: string; mimeType: string }, context: { signal: AbortSignal }) => Promise<unknown>;
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
};

export type NativeLiveMacClaudeTransport =
  NativeLiveClaudeRuntime & {
    closePersistentSession?(reason?: Error): Promise<void>;
    restorePersistentSession?(restore: NativeLiveMacSessionRestore, options: NativeLiveMacPersistentSessionOptions): Promise<NativeLiveMacPersistentSession>;
    forkPersistentSession?(fork: NativeLiveMacSessionFork, options: NativeLiveMacPersistentSessionOptions): Promise<NativeLiveMacPersistentSession>;
    openPersistentSession?(options: NativeLiveMacPersistentSessionOptions): Promise<NativeLiveMacPersistentSession>;
    abort(reason?: Error): void;
    deleteSession(sessionId: string): Promise<void>;
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
      toolPermissionPolicy: "auto_allow";
      mcpServerConfig?: NativeLiveMacMcpServerConfig;
    }) => NativeLiveMacClaudeTransport;
  };

  return {
    kind,
    runtime: new AgentSdkClaudeTransport({
      environment: sanitizeNativeLiveClaudeEnvironment(environment),
      cwd: normalizedWorkingDirectory,
      toolPermissionPolicy: "auto_allow",
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
      // Quarantine retired configuration still present in the owner's env;
      // it is not consumed, and must never become a Claude child credential.
      ([key]) => !NATIVE_LIVE_CLAUDE_ENV_DENYLIST.has(key)
        && !key.startsWith("LEILEI_MEME_"),
    ),
  );
}
