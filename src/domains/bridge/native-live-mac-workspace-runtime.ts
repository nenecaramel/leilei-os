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
    private readonly createSessionStore:
      (workspaceId: string) => unknown = () => null,
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

    const runtimeKey =
      (input.workspaceId ?? "__base__") + "\0" + workspaceRoot;
    let pending = this.pending.get(runtimeKey);
    if (!pending) {
      const sessionStore =
        input.workspaceId === null
          ? null
          : this.createSessionStore(input.workspaceId);
      pending = this.createTransport(
        this.environment,
        workspaceRoot,
        sessionStore,
      ).then(({ runtime }) => {
        this.resolved.add(runtime);
        return runtime;
      });
      this.pending.set(runtimeKey, pending);
    }

    return {
      runtime: await pending,
      workspaceRoot,
    };
  }

  async listExternalSessions(): Promise<Array<{
    sessionId: string;
    summary: string | null;
    customTitle: string | null;
    firstPrompt: string | null;
    gitBranch: string | null;
    lastModified: number | null;
    createdAt: number | null;
    workspaceId: string | null;
    workspaceRoot: string;
  }>> {
    const bindings: Array<{
      workspaceId: string | null;
      workspaceRoot: string;
    }> = [
      {
        workspaceId: null,
        workspaceRoot: this.baseWorkspaceRoot,
      },
      ...Object.entries(this.workspaceRoots).map(
        ([workspaceId, workspaceRoot]) => ({
          workspaceId,
          workspaceRoot,
        }),
      ),
    ];
    const seenRoots = new Set<string>();
    const sessions = [];

    for (const binding of bindings) {
      if (seenRoots.has(binding.workspaceRoot)) continue;
      seenRoots.add(binding.workspaceRoot);

      const { runtime } = await this.resolveWorkspaceRuntime({
        workspaceId: binding.workspaceId,
        expectedWorkspaceRoot: binding.workspaceRoot,
      });
      if (!runtime.listSessions) {
        throw runtimeError(
          "Native Live runtime does not expose session listing.",
          "RUNTIME_UNAVAILABLE",
        );
      }
      const rows = await runtime.listSessions({
        limit: 100,
        offset: 0,
      });
      for (const row of rows) {
        sessions.push({
          sessionId: row.sessionId,
          summary: row.summary,
          customTitle: row.customTitle,
          firstPrompt: row.firstPrompt,
          gitBranch: row.gitBranch,
          lastModified: row.lastModified,
          createdAt: row.createdAt,
          workspaceId: binding.workspaceId,
          workspaceRoot: binding.workspaceRoot,
        });
      }
    }

    return sessions
      .sort((left, right) =>
        (right.lastModified ?? 0) - (left.lastModified ?? 0)
      )
      .filter(
        (session, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.sessionId === session.sessionId,
          ) === index,
      );
  }

  async compactSession(
    sessionId: string,
    workspaceId: string | null,
    expectedWorkspaceRoot: string | null,
  ) {
    const { runtime } = await this.resolveWorkspaceRuntime({
      workspaceId,
      expectedWorkspaceRoot,
    });
    if (!runtime.compact) {
      throw runtimeError(
        "Native Live runtime does not expose compact.",
        "RUNTIME_UNAVAILABLE",
      );
    }
    return runtime.compact(sessionId);
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
  runtimeCode:
    | "WORKSPACE_UNAVAILABLE"
    | "WORKSPACE_ROOT_MISMATCH"
    | "RUNTIME_UNAVAILABLE",
): Error {
  return Object.assign(new Error(message), { runtimeCode });
}
