import { flushNativeLiveBackgroundWithListenerLease } from "./native-live-mac-background-lease.js";
import { runNativeLiveMacTaskControls, type NativeLiveMacTaskRelay } from "./native-live-mac-task-controls.js";
import { NativeLiveMacExecutionLease } from "./native-live-mac-execution-lease.js";
import { drainNativeLiveMacSession } from "./native-live-mac-session-drain.js";
import { NativeLiveMacSessionRegistry } from "./native-live-mac-session-registry.js";
import { NativeLiveMacPersistentTurnRouter } from "./native-live-mac-persistent-turn-router.js";
import { NativeLiveMacPersistentExecutor } from "./native-live-mac-persistent-executor.js";
import { NativeLiveMacBackgroundResultOutbox, NativeLiveMacBackgroundResultSink } from "./native-live-mac-background-result-sink.js";
import type { createNativeLiveMacClaudeTransport, NativeLiveMacMcpServerConfig } from "./native-live-mac-claude-transport.js";
import type { NativeLiveMacHttpRelayClient } from "./native-live-mac-http-relay-client.js";
import type { NativeLiveMacAttachmentMaterializer } from "./native-live-mac-attachment-materializer.js";
import type { NativeLiveMacOutputAttachmentSender } from "./native-live-mac-output-attachment-sender.js";

/** Owns the actual Mac caller chain; daemon activation requires lifecycle fencing. */
export class NativeLiveMacPersistentRuntime {
  readonly registry: NativeLiveMacSessionRegistry;
  readonly backgroundResults: NativeLiveMacBackgroundResultSink;
  readonly executor: NativeLiveMacPersistentExecutor;
  private watchdog: NativeLiveMacExecutionLease | null = null;
  private stopped = false;
  private readonly flushBackground: () => Promise<number>;
  private readonly taskAbort = new AbortController();
  private taskControls: Promise<void> = Promise.resolve();
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;
  constructor(input: {
    sessionLeaseScheduler?: ConstructorParameters<typeof NativeLiveMacExecutionLease>[0]["scheduler"];
    environment: NodeJS.ProcessEnv; defaultWorkingDirectory: string; listenerInstanceId: string;
    relay: Pick<NativeLiveMacHttpRelayClient, "checkExecutionAdmission" | "renewExecutionLease" | "checkTaskAdmission" | "renewSessionLease" | "prepareBackgroundResult" | "submitBackgroundResult"> & Partial<Pick<NativeLiveMacHttpRelayClient, "bindInput" | "renewLease" | "publishTaskState">> & Partial<NativeLiveMacTaskRelay>;
    outboxDirectory: string; mcpServerConfig?: NativeLiveMacMcpServerConfig | null;
    /** Injectable clock for deterministic retry/backoff regression tests. */
    backgroundRecoveryNow?: () => number;
    attachmentMaterializer: NativeLiveMacAttachmentMaterializer | null;
    outputAttachmentSender: NativeLiveMacOutputAttachmentSender | null;
    createTransport?: typeof createNativeLiveMacClaudeTransport;
    onSessionClose?: ConstructorParameters<typeof NativeLiveMacPersistentTurnRouter>[0]["onSessionClose"];
    onRuntimeFailure?: ConstructorParameters<typeof NativeLiveMacPersistentExecutor>[0]["onRuntimeFailure"];
  }) {
    this.registry = new NativeLiveMacSessionRegistry(input.environment, input.defaultWorkingDirectory, input.createTransport, () => null, input.mcpServerConfig ?? null);
    const outbox = new NativeLiveMacBackgroundResultOutbox(input.outboxDirectory);
    // Fence every conversation with unacknowledged producer output before
    // accepting a single fresh native send, including crashed or quarantined
    // records from a previous process. No new Claude execution on replay.
    const pendingRecovery = [...outbox.listSync(), ...outbox.listQuarantinedSync()];
    this.backgroundResults = new NativeLiveMacBackgroundResultSink({ listenerInstanceId: input.listenerInstanceId, relay: input.relay,
      outbox,
      ...(input.backgroundRecoveryNow ? { now: input.backgroundRecoveryNow } : {}),
      isForegroundActive:conversationId=>this.executor.isForegroundActive(conversationId),
      onImmediateFence: conversationId=>this.executor.suspend(conversationId,"recovery"),
      onRecoveryBlocked:async conversationId=>{this.executor.suspend(conversationId,"recovery");await this.executor.retire(conversationId,"BACKGROUND_RECOVERY_BLOCKED");},
      onRecovered:conversationId=>this.executor.recovered(conversationId),
    });
    this.flushBackground = async () => {
      const renewLease = input.relay.renewLease;
      // Missing lease support is not permission to replay under an expired
      // listener. Retain receipts and their startup fences until reacquired.
      if (!renewLease) return 0;
      let completed = 0;
      await flushNativeLiveBackgroundWithListenerLease({
        listenerInstanceId: input.listenerInstanceId,
        relay: { renewLease: value => renewLease.call(input.relay, value) },
        backgroundResults: { flush: async () => {
          // A lease request may finish after closeAll has retired every writer.
          // Recheck shutdown at the point replay would actually begin.
          if (this.stopped) return 0;
          completed = await this.backgroundResults.flush();
          return completed;
        } },
      });
      return completed;
    };
    // Capability is version support, never authorization. Keep the safe
    // interrupt fallback until a probe succeeds. Reuse recovery polling with
    // capped backoff and one in-flight probe, including for legacy servers.
    let taskControlsSupported = false, capabilityFailures = 0, nextCapabilityProbe = 0;
    let capabilityProbe: Promise<boolean> | null = null;
    const recheckTaskControls = (): Promise<boolean> => {
      if (capabilityProbe) return capabilityProbe;
      if (this.stopped || taskControlsSupported || Date.now() < nextCapabilityProbe
        || !input.relay.waitTaskControl || !input.relay.completeRuntimeControl || !input.relay.supportsTaskControls)
        return Promise.resolve(taskControlsSupported);
      capabilityProbe = Promise.resolve().then(() => input.relay.supportsTaskControls!()).catch(() => false).then(available => {
        if (this.stopped) return false;
        if (available) {
          taskControlsSupported = true;
          this.taskControls = runNativeLiveMacTaskControls({ registry:this.registry,
            relay:input.relay as typeof input.relay & NativeLiveMacTaskRelay,
            listenerInstanceId:input.listenerInstanceId,signal:this.taskAbort.signal });
        } else {
          nextCapabilityProbe = Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(capabilityFailures++, 4));
        }
        return taskControlsSupported;
      }).finally(() => { capabilityProbe = null; });
      return capabilityProbe;
    };
    void recheckTaskControls();
    const startWatchdog = () => {
      if(this.stopped || this.watchdog)return;
      const lease=new NativeLiveMacExecutionLease({
        ...(input.sessionLeaseScheduler?{scheduler:input.sessionLeaseScheduler}:{}),
        transientRetry: { validForMs: 60_000, retryMs: 5_000 },
        renew:()=>this.registry.snapshot().length===0?Promise.resolve(true):input.relay.renewSessionLease({listenerInstanceId:input.listenerInstanceId}),
        onRevoked:async()=>{
          if(this.watchdog!==lease)return;
          this.watchdog=null;
          // Listener expiry covers every current writer, including sessions
          // opened while the last renewal request was still in flight.
          const revoked=this.registry.snapshot();
          await Promise.allSettled(revoked.map(binding=>this.registry.getGenerationId(binding.conversationId)===binding.generationId
            ?this.executor.retire(binding.conversationId,"SESSION_LEASE_REVOKED"):Promise.resolve()));
        },
      });
      this.watchdog=lease;void lease.start().catch(()=>{});
    };
    this.executor = new NativeLiveMacPersistentExecutor({ hasCapacity: () => this.registry.size < 4, attachmentMaterializer: input.attachmentMaterializer, outputAttachmentSender: input.outputAttachmentSender, onRuntimeFailure: input.onRuntimeFailure ?? null,
      createRouter: () => { startWatchdog(); return new NativeLiveMacPersistentTurnRouter({ registry: this.registry, onSessionClose: input.onSessionClose, listenerInstanceId: input.listenerInstanceId,
        ...(input.relay.publishTaskState ? { publishTaskState: value => input.relay.publishTaskState!({...value,listenerInstanceId:input.listenerInstanceId}) } : {}),
        taskControlsAvailable: () => capabilityProbe ?? Promise.resolve(taskControlsSupported),
        outputAttachmentSender: input.outputAttachmentSender,
        relay: input.relay, onBackgroundResult: (owner, frame) => this.backgroundResults.commit(owner, frame),
        onForegroundCoverage: async (conversationId, generationId, checkpoint) => {
          try { return await this.backgroundResults.cover(conversationId, generationId, checkpoint); }
          catch (error) { this.executor.suspend(conversationId, "recovery"); throw error; }
        },
        onForegroundPublished: async (conversationId, generationId) => {
          try { await this.backgroundResults.publishCovered(conversationId, generationId); }
          catch (error) { this.executor.suspend(conversationId, "recovery"); throw error; }
        },
        hasUnpublishedDeferred: (conversationId, generationId) =>
          this.backgroundResults.hasUnpublishedDeferred(conversationId, generationId),
        onForegroundUnpublished: conversationId => this.executor.suspend(conversationId, "recovery") }); } });
    for (const conversationId of new Set(pendingRecovery.map(value => value.result.conversation_id)))
      this.executor.suspend(conversationId, "recovery");
    // Recovery runs independently of user input. Multiple older receipts can
    // require multiple passes; each flush settles at most one, so drive bounded
    // batches at startup and retry transient relay failures periodically.
    const replay = async () => {
      for (let index = 0; index < 512 && !this.stopped; index++) {
        if (await this.flushBackground() === 0) break;
      }
    };
    void replay().catch(() => {});
    this.recoveryTimer = setInterval(() => { void recheckTaskControls(); void replay().catch(() => {}); }, 30_000);
    this.recoveryTimer.unref?.();
  }
  async drain(conversationId: string, providerSessionId: string) {
    const generation = this.registry.getGenerationId(conversationId);
    const binding = generation ? this.registry.get(conversationId, generation) : null;
    if (!binding) {
      if (generation) return { ready: false, tasks: [], writer: "unknown" as const };
      this.executor.suspend(conversationId);
      const pending = this.backgroundResults.hasPendingRecovery(conversationId);
      if (pending) this.executor.suspend(conversationId, "recovery");
      return { ready: !pending, tasks: [], writer: "closed" as const };
    }
    if (binding.session.sessionId !== providerSessionId) throw new Error("Handoff session identity mismatch.");
    return drainNativeLiveMacSession({ session: binding.session,
      fence: () => this.executor.suspend(conversationId), close: () => this.executor.retire(conversationId,"HANDOFF_DRAIN"),
      settle: async () => {
        if (!this.backgroundResults.hasPendingRecovery(conversationId)) return;
        this.executor.suspend(conversationId, "recovery");
        await this.flushBackground();
        // Busy/missing ownership and a bounded flush that leaves more evidence
        // are both unsettled delivery, even after the local writer has closed.
        if (this.backgroundResults.hasPendingRecovery(conversationId))
          throw new Error("Background receipts remain unsettled for handoff.");
      },
    });
  }
  /** Ownership returned by a server attach; the binding was closed by the earlier drain. */
  async resume(conversationId: string, _providerSessionId: string): Promise<void> {
    this.executor.resumeHandoff(conversationId);
  }
  async closeAll(): Promise<void> {
    this.stopped=true;
    if (this.recoveryTimer) { clearInterval(this.recoveryTimer); this.recoveryTimer=null; }
    this.taskAbort.abort();await this.taskControls;
    this.stopped=true;this.watchdog?.stop();this.watchdog=null;
    await this.executor.closeAll();
    // Registry retains failed closes; its shutdown reports rather than hides them.
    await this.registry.closeAll();
    // Durable receipts remain for the next listener-owned recovery pass.
    // Shutdown must not start another network replay after retiring writers.
  }
}
