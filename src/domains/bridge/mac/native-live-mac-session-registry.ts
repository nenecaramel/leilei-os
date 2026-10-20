import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  createNativeLiveMacClaudeTransport,
  type NativeLiveMacClaudeTransport,
  type NativeLiveMacMcpServerConfig,
  type NativeLiveMacPersistentSession,
  type NativeLiveMacPersistentSessionOptions,
  type NativeLiveMacSessionRestore,
  type NativeLiveMacSessionFork,
  type NativeLiveMacSessionCloseReason,
} from "./native-live-mac-claude-transport.js";
import { resolveNativeLiveMacWorkingDirectory } from "./native-live-mac-working-directory-runtime.js";

export type NativeLiveMacSessionBinding = Readonly<{
  conversationId: string;
  generationId: string;
  workingDirectory: string;
  session: NativeLiveMacPersistentSession;
}>;
type Entry = {
  conversationId: string;
  generationId: string;
  retired: boolean;
  closeReason?: NativeLiveMacSessionCloseReason;
  runtime?: NativeLiveMacClaudeTransport;
  attemptedOpen: boolean;
  binding?: NativeLiveMacSessionBinding;
  opening: Promise<NativeLiveMacSessionBinding>;
  closing: Promise<void> | null;
  providerSessionId: string | null;
  observeEvent?: (event: Record<string, unknown>) => void;
};
type OpenInput = {
  conversationId: string;
  expectedWorkingDirectory: string | null;
  options: NativeLiveMacPersistentSessionOptions;
};

// Explicit new/local-restore session owner; durable relay/head fences remain required.
// The cwd pool remains available for legacy turns, listing, compact and cleanup.
export class NativeLiveMacSessionRegistry {
  private readonly entries = new Map<string, Entry>();
  private shutDown = false;
  private readonly changes = new EventEmitter();
  waitForChange(signal: AbortSignal): Promise<void> {
    return new Promise(resolve=>{
      const finish=()=>{this.changes.off("change",finish);signal.removeEventListener("abort",finish);resolve();};
      this.changes.once("change",finish);signal.addEventListener("abort",finish,{once:true});
      if(signal.aborted)finish();
    });
  }
  constructor(
    private readonly environment: NodeJS.ProcessEnv,
    private readonly defaultWorkingDirectory: string,
    private readonly createTransport = createNativeLiveMacClaudeTransport,
    private readonly createSessionStore: () => unknown = () => null,
    private readonly mcpServerConfig: NativeLiveMacMcpServerConfig | null = null,
    private readonly maxSessions = 4,
  ) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) throw new Error("Session capacity must be a positive integer.");
  }
  get size(): number { return this.entries.size; }
  snapshot(): ReadonlyArray<NativeLiveMacSessionBinding> {
    return [...this.entries.values()].flatMap(entry=>entry.binding&&!entry.retired?[entry.binding]:[]);
  }

  async openNew(input: OpenInput): Promise<NativeLiveMacSessionBinding> {
    return this.openOwned(input, null);
  }

  async openExisting(input: OpenInput & { restore: NativeLiveMacSessionRestore }): Promise<NativeLiveMacSessionBinding> {
    return this.openOwned(input, { ...input.restore });
  }

  /** A branch replacement owns its newly forked SDK process across later sends. */
  async openFork(input: OpenInput & { fork: NativeLiveMacSessionFork }): Promise<NativeLiveMacSessionBinding> {
    return this.openOwned(input, null, { ...input.fork });
  }

  private async openOwned(input: OpenInput, restore: NativeLiveMacSessionRestore | null, fork: NativeLiveMacSessionFork | null = null): Promise<NativeLiveMacSessionBinding> {
    if (this.shutDown) throw new Error("Persistent session registry is shut down.");
    const { conversationId } = input;
    if (typeof conversationId !== "string" || !conversationId.trim()) throw new Error("Conversation identity is required.");
    if (this.entries.has(conversationId)) throw new Error("Conversation already owns a session; retire it explicitly first.");
    if (restore && [...this.entries.values()].some(entry => entry.providerSessionId === restore.sessionId)) throw new Error("Native provider session is already owned by another conversation.");
    if (this.size >= this.maxSessions) throw new Error("Persistent session capacity reached; no background work was evicted.");
    // Reserve synchronously before path/factory awaits so duplicate opens cannot
    // replace callback ownership. Generation is local, not a server epoch token.
    const entry: Entry = {
      conversationId, generationId: randomUUID(), retired: false,
      attemptedOpen: false, closing: null, opening: null!, providerSessionId: restore?.sessionId ?? null,
    };
    this.entries.set(conversationId, entry);
    entry.opening = this.launch(entry, { ...input, options: { ...input.options } }, restore, fork);
    try { return await entry.opening; }
    catch (error) {
      entry.closeReason ??= "STARTUP_FAILED";
      entry.retired = true;
      // Failed close retains the slot/runtime for an explicit close retry.
      try { await this.dispose(entry); } catch { /* Preserve startup error. */ }
      throw error;
    }
  }

  // Metadata-only lookup permits targeted cleanup after failed startup, when
  // openNew could not return a binding. This token is not durable admission.
  getGenerationId(conversationId: string): string | null {
    return this.entries.get(conversationId)?.generationId ?? null;
  }

  get(conversationId: string, generationId: string): NativeLiveMacSessionBinding | null {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.generationId !== generationId || entry.retired || !entry.binding
      || ["closed", "failed"].includes(entry.binding.session.state)) return null;
    return entry.binding;
  }

  async close(conversationId: string, generationId: string, reason: NativeLiveMacSessionCloseReason = "EXPLICIT_CLOSE"): Promise<void> {
    const entry = this.entries.get(conversationId);
    if (!entry || entry.generationId !== generationId) return;
    entry.closeReason ??= reason;
    this.retire(entry);
    await this.dispose(entry);
  }

  async closeAll(): Promise<void> {
    this.shutDown = true;
    const entries = [...this.entries.values()];
    // Revoke every captured generation before awaiting any one SDK process.
    for (const entry of entries) { entry.closeReason ??= "DAEMON_SHUTDOWN"; this.retire(entry); }
    const outcomes = await Promise.allSettled(entries.map(entry => this.dispose(entry)));
    const failures = outcomes.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(r => r.reason), "Persistent sessions could not all close.");
  }

  private retire(entry: Entry): void {
    const wasRetired = entry.retired;
    entry.retired = true;
    this.changes.emit("change");
    // Startup may still await the SDK loader. Cancel its transport claim now;
    // waiting only for open() would permit a late process launch after retire.
    if (!wasRetired && !entry.binding) entry.runtime?.abort(Object.assign(new Error("Session host was closed."), {sessionCloseReason:entry.closeReason ?? "EXPLICIT_CLOSE"}));
  }
  private assertLive(entry: Entry): void {
    if (entry.retired || this.entries.get(entry.conversationId) !== entry) throw new Error("Persistent session generation was retired.");
  }
  private claimProviderIdentity(entry: Entry, sessionId: string | null): void {
    if (!sessionId) return;
    if ((entry.providerSessionId && entry.providerSessionId !== sessionId)
      || [...this.entries.values()].some(other => other !== entry && other.providerSessionId === sessionId)) throw new Error("Native provider session is already owned or changed identity.");
    entry.providerSessionId = sessionId;
  }
  private async launch(entry: Entry, input: OpenInput, restore: NativeLiveMacSessionRestore | null, fork: NativeLiveMacSessionFork | null): Promise<NativeLiveMacSessionBinding> {
    const workingDirectory = await resolveNativeLiveMacWorkingDirectory(input.expectedWorkingDirectory ?? this.defaultWorkingDirectory);
    this.assertLive(entry);
    const { runtime } = await this.createTransport(this.environment, workingDirectory, this.createSessionStore(), this.mcpServerConfig);
    if ([...this.entries.values()].some(other => other !== entry && other.runtime === runtime)) {
      throw new Error("Persistent runtime is already owned by another conversation.");
    }
    entry.runtime = runtime;
    this.assertLive(entry);
    if (!(restore ? runtime.restorePersistentSession : fork ? runtime.forkPersistentSession : runtime.openPersistentSession)
      || !runtime.closePersistentSession) throw new Error("Runtime does not support owned persistent sessions.");
    const { authorize, onBackgroundResult, ...settings } = input.options;
    if (typeof authorize !== "function" || typeof onBackgroundResult !== "function") throw new Error("Session admission and durable background sink are required.");
    entry.attemptedOpen = true;
    const handlers: NativeLiveMacPersistentSessionOptions = {
      ...settings,
      authorize: async context => {
        this.assertLive(entry);
        this.claimProviderIdentity(entry, context.providerSessionId);
        const admitted = await authorize(context);
        this.assertLive(entry);
        return admitted;
      },
      onBackgroundResult: async frame => {
        this.assertLive(entry);
        // The caller must enforce durable reservation/lease/head fencing inside
        // the sink. Local retirement cannot undo an already committed write.
        this.claimProviderIdentity(entry, typeof frame.result.session_id === "string" ? frame.result.session_id : null);
        await onBackgroundResult(frame);
        this.assertLive(entry);
      },
    };
    const session = restore
      ? await runtime.restorePersistentSession!(restore, handlers)
      : fork ? await runtime.forkPersistentSession!(fork, handlers)
      : await runtime.openPersistentSession!(handlers);
    this.assertLive(entry);
    this.claimProviderIdentity(entry, session.sessionId);
    entry.observeEvent = event => {
      if (typeof event.session_id === "string") {
        const previous = entry.providerSessionId;
        this.claimProviderIdentity(entry, event.session_id);
        // Input admission can claim identity synchronously during init's pump,
        // before this observer runs. Init must still wake a waiting task pump.
        if (entry.providerSessionId !== previous || (event.type === "system" && event.subtype === "init")) this.changes.emit("change");
      }
    };
    session.events.on("event", entry.observeEvent);
    const binding = Object.freeze({ conversationId: entry.conversationId, generationId: entry.generationId, workingDirectory, session });
    entry.binding = binding;
    this.changes.emit("change");
    return binding;
  }
  private async dispose(entry: Entry): Promise<void> {
    if (entry.closing) return entry.closing;
    const closing = (async () => {
      await entry.opening.catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([(async () => {
          if (entry.attemptedOpen) await entry.runtime!.closePersistentSession!(Object.assign(new Error("Session host was closed."), {sessionCloseReason:entry.closeReason ?? "EXPLICIT_CLOSE"}));
          if (entry.binding) await entry.binding.session.completion.catch(() => {});
        })(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Persistent output stream close is unconfirmed.")), 5_000);
        })]);
      } finally { clearTimeout(timer); }
      if (entry.binding && entry.observeEvent) entry.binding.session.events.off("event", entry.observeEvent);
      if (this.entries.get(entry.conversationId) === entry) this.entries.delete(entry.conversationId);
    })();
    entry.closing = closing;
    try { await closing; }
    finally { if (entry.closing === closing) entry.closing = null; }
  }
}
