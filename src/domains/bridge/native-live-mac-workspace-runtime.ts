import type {
  NativeLiveMacClaudeTransport,
} from "./native-live-mac-claude-transport.js";
import {
  createNativeLiveMacClaudeTransport,
} from "./native-live-mac-claude-transport.js";

export type NativeLiveWorkspaceRuntimeBinding = {
  runtime: NativeLiveMacClaudeTransport;
  workspaceRoot: string;
};

export interface NativeLiveWorkspaceRuntimeResolver {
  resolveWorkspaceRuntime(input: {
    workspaceId: string | null;
    expectedWorkspaceRoot: string | null;
  }): Promise<NativeLiveWorkspaceRuntimeBinding>;
}

export class NativeLiveMacWorkspaceRuntimePool
implements NativeLiveWorkspaceRuntimeResolver {
  private readonly pending = new Map<
    string,
    Promise<NativeLiveMacClaudeTransport>
  >();
  private readonly resolved = new Set<NativeLiveMacClaudeTransport>();

  constructor(
    private readonly environment: NodeJS.ProcessEnv,
    private readonly baseWorkspaceRoot: string,
    private readonly workspaceRoots: Readonly<Record<string, string>>,
    private readonly createTransport = createNativeLiveMacClaudeTransport,
  ) {}

  async resolveWorkspaceRuntime(input: {
    workspaceId: string | null;
    expectedWorkspaceRoot: string | null;
  }): Promise<NativeLiveWorkspaceRuntimeBinding> {
    const workspaceRoot =
      input.workspaceId === null
        ? this.baseWorkspaceRoot
        : this.workspaceRoots[input.workspaceId];

    if (!workspaceRoot) {
      throw runtimeError(
        "Native Live Workspace is not mapped on this Mac.",
        "WORKSPACE_UNAVAILABLE",
      );
    }
    if (
      input.expectedWorkspaceRoot !== null
      && input.expectedWorkspaceRoot !== workspaceRoot
    ) {
      throw runtimeError(
        "Native Live Workspace root changed for an existing provider session.",
        "WORKSPACE_ROOT_MISMATCH",
      );
    }

    let pending = this.pending.get(workspaceRoot);
    if (!pending) {
      pending = this.createTransport(
        this.environment,
        workspaceRoot,
      ).then(({ runtime }) => {
        this.resolved.add(runtime);
        return runtime;
      });
      this.pending.set(workspaceRoot, pending);
    }

    return {
      runtime: await pending,
      workspaceRoot,
    };
  }

  async deleteSession(
    sessionId: string,
    workspaceId: string | null,
    expectedWorkspaceRoot: string | null,
  ): Promise<void> {
    const { runtime } = await this.resolveWorkspaceRuntime({
      workspaceId,
      expectedWorkspaceRoot,
    });
    await runtime.deleteSession(sessionId);
  }

  abortAll(): void {
    for (const runtime of this.resolved) runtime.abort();
  }
}

function runtimeError(
  message: string,
  runtimeCode: "WORKSPACE_UNAVAILABLE" | "WORKSPACE_ROOT_MISMATCH",
): Error {
  return Object.assign(new Error(message), { runtimeCode });
}
