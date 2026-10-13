import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createNativeLiveMacClaudeTransport, type NativeLiveMacClaudeTransport, type NativeLiveMacMcpServerConfig } from "./native-live-mac-claude-transport.js";

export type NativeLiveWorkingDirectoryRuntimeBinding = { runtime: NativeLiveMacClaudeTransport; workingDirectory: string };
export interface NativeLiveWorkingDirectoryRuntimeResolver {
  resolveWorkingDirectoryRuntime(input: { expectedWorkingDirectory: string | null }): Promise<NativeLiveWorkingDirectoryRuntimeBinding>;
}

export class NativeLiveMacWorkingDirectoryRuntimePool implements NativeLiveWorkingDirectoryRuntimeResolver {
  private readonly pending = new Map<string, Promise<NativeLiveMacClaudeTransport>>();
  private readonly resolved = new Set<NativeLiveMacClaudeTransport>();
  constructor(
    private readonly environment: NodeJS.ProcessEnv,
    private readonly defaultWorkingDirectory: string,
    private readonly createTransport = createNativeLiveMacClaudeTransport,
    private readonly createSessionStore: () => unknown = () => null,
    private readonly mcpServerConfig: NativeLiveMacMcpServerConfig | null = null,
  ) {}

  async resolveWorkingDirectoryRuntime(input: { expectedWorkingDirectory: string | null }): Promise<NativeLiveWorkingDirectoryRuntimeBinding> {
    const candidate = input.expectedWorkingDirectory ?? this.defaultWorkingDirectory;
    let workingDirectory: string;
    try {
      if (!isAbsolute(candidate)) throw new Error("not absolute");
      workingDirectory = await realpath(candidate);
      if (!(await stat(workingDirectory)).isDirectory()) throw new Error("not directory");
    } catch {
      throw Object.assign(new Error("Native Live working directory must resolve to an existing absolute directory."), { runtimeCode: "WORKING_DIRECTORY_UNAVAILABLE" });
    }
    let pending = this.pending.get(workingDirectory);
    if (!pending) {
      pending = this.createTransport(this.environment, workingDirectory, this.createSessionStore(), this.mcpServerConfig).then(({ runtime }) => { this.resolved.add(runtime); return runtime; });
      this.pending.set(workingDirectory, pending);
      // A failed initialization is not a permanently cached runtime.
      void pending.catch(() => { if (this.pending.get(workingDirectory) === pending) this.pending.delete(workingDirectory); });
    }
    return { runtime: await pending, workingDirectory };
  }

  async listExternalSessions() {
    const { runtime } = await this.resolveWorkingDirectoryRuntime({ expectedWorkingDirectory: null });
    if (!runtime.listSessions) throw Object.assign(new Error("Native Live runtime does not expose session listing."), { runtimeCode: "RUNTIME_UNAVAILABLE" });
    // SDK listing across projects retains historical cwd after daemon restart;
    // the current transport cache is not an inventory of durable directories.
    const rows = await runtime.listSessions({ allDirectories: true, limit: 100, offset: 0 });
    const sessions = [];
    for (const row of rows) {
      try {
        if (!isAbsolute(row.cwd)) continue;
        const workingDirectory = await realpath(row.cwd);
        if (!(await stat(workingDirectory)).isDirectory()) continue;
        sessions.push({ ...row, workingDirectory });
      } catch { /* Missing local directories cannot be forked on this Mac. */ }
    }
    return sessions.sort((a,b) => (b.lastModified ?? 0) - (a.lastModified ?? 0)).filter((session, index, all) => all.findIndex(candidate => candidate.sessionId === session.sessionId) === index);
  }

  async compactSession(sessionId: string, expectedWorkingDirectory: string | null, providerCheckpointId: string | null = null) {
    const { runtime } = await this.resolveWorkingDirectoryRuntime({ expectedWorkingDirectory });
    if (!runtime.compact) throw Object.assign(new Error("Native Live runtime does not expose compact."), { runtimeCode: "RUNTIME_UNAVAILABLE" });
    const result = await runtime.compact(sessionId, null, providerCheckpointId);
    if (typeof result.providerSessionId !== "string" || !result.providerSessionId.trim()) {
      throw Object.assign(new Error("Compact did not return a provider session."), { runtimeCode: "COMPACT_FAILED" });
    }
    return { ...result, providerSessionId: result.providerSessionId };
  }
  async deleteSession(sessionId: string, expectedWorkingDirectory: string | null): Promise<void> {
    const { runtime } = await this.resolveWorkingDirectoryRuntime({ expectedWorkingDirectory });
    await runtime.deleteSession(sessionId);
  }
  abortAll(): void { for (const runtime of this.resolved) runtime.abort(); }
}
