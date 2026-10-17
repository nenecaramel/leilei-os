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
  private readonly taskAbort = new AbortController();
  private readonly taskControls: Promise<void>;
  constructor(input: {
    sessionLeaseScheduler?: ConstructorParameters<typeof NativeLiveMacExecutionLease>[0]["scheduler"];
    environment: NodeJS.ProcessEnv; defaultWorkingDirectory: string; listenerInstanceId: string;
    relay: Pick<NativeLiveMacHttpRelayClient, "checkExecutionAdmission" | "renewExecutionLease" | "checkTaskAdmission" | "renewSessionLease" | "prepareBackgroundResult" | "submitBackgroundResult"> & Partial<Pick<NativeLiveMacHttpRelayClient, "bindInput">> & Partial<NativeLiveMacTaskRelay>;
    outboxDirectory: string; mcpServerConfig?: NativeLiveMacMcpServerConfig | null;
    attachmentMaterializer: NativeLiveMacAttachmentMaterializer | null;
    outputAttachmentSender: NativeLiveMacOutputAttachmentSender | null;
    createTransport?: typeof createNativeLiveMacClaudeTransport;
    onRuntimeFailure?: ConstructorParameters<typeof NativeLiveMacPersistentExecutor>[0]["onRuntimeFailure"];
  }) {
    this.registry = new NativeLiveMacSessionRegistry(input.environment, input.defaultWorkingDirectory, input.createTransport, () => null, input.mcpServerConfig ?? null);
    this.backgroundResults = new NativeLiveMacBackgroundResultSink({ listenerInstanceId: input.listenerInstanceId, relay: input.relay,
      outbox: new NativeLiveMacBackgroundResultOutbox(input.outboxDirectory),
      isForegroundActive:conversationId=>this.executor.isForegroundActive(conversationId),
      onRecoveryBlocked:async conversationId=>{this.executor.suspend(conversationId,"recovery");await this.executor.retire(conversationId);},
      onRecovered:conversationId=>this.executor.recovered(conversationId),
    });
    // Capability is version support, never authorization. Older/unreachable
    // servers keep the safe interrupt fallback and do not enter a retry loop.
    const taskControlsAvailable = input.relay.waitTaskControl && input.relay.completeRuntimeControl && input.relay.supportsTaskControls
      ? input.relay.supportsTaskControls().catch(()=>false) : Promise.resolve(false);
    this.taskControls = taskControlsAvailable.then(available=>available && !this.taskAbort.signal.aborted
      ? runNativeLiveMacTaskControls({ registry:this.registry,relay:input.relay as typeof input.relay & NativeLiveMacTaskRelay,listenerInstanceId:input.listenerInstanceId,signal:this.taskAbort.signal })
      : undefined);
    const startWatchdog = () => {
      if(this.stopped || this.watchdog)return;
      let captured: ReturnType<NativeLiveMacSessionRegistry["snapshot"]> = [];
      const lease=new NativeLiveMacExecutionLease({
        ...(input.sessionLeaseScheduler?{scheduler:input.sessionLeaseScheduler}:{}),
        renew:()=>{captured=this.registry.snapshot();return captured.length===0?Promise.resolve(true):input.relay.renewSessionLease({listenerInstanceId:input.listenerInstanceId});},
        onRevoked:async()=>{
          if(this.watchdog===lease)this.watchdog=null;
          await Promise.allSettled(captured.map(binding=>this.registry.getGenerationId(binding.conversationId)===binding.generationId
            ?this.executor.retire(binding.conversationId):Promise.resolve()));
        },
      });
      this.watchdog=lease;void lease.start().catch(()=>{});
    };
    this.executor = new NativeLiveMacPersistentExecutor({ hasCapacity: () => this.registry.size < 4, attachmentMaterializer: input.attachmentMaterializer, outputAttachmentSender: input.outputAttachmentSender, onRuntimeFailure: input.onRuntimeFailure ?? null,
      createRouter: () => { startWatchdog(); return new NativeLiveMacPersistentTurnRouter({ registry: this.registry, listenerInstanceId: input.listenerInstanceId,
        taskControlsAvailable: () => taskControlsAvailable,
        relay: input.relay, onBackgroundResult: (owner, frame) => this.backgroundResults.commit(owner, frame),
        onForegroundCoverage: (conversationId, generationId, checkpoint) => this.backgroundResults.cover(conversationId, generationId, checkpoint),
        onForegroundPublished: conversationId => this.backgroundResults.publishCovered(conversationId) }); } });
  }
  async drain(conversationId: string, providerSessionId: string) {
    const generation = this.registry.getGenerationId(conversationId);
    const binding = generation ? this.registry.get(conversationId, generation) : null;
    if (!binding) {
      if (generation) return { ready: false, tasks: [], writer: "unknown" as const };
      this.executor.suspend(conversationId);
      return { ready: true, tasks: [], writer: "closed" as const };
    }
    if (binding.session.sessionId !== providerSessionId) throw new Error("Handoff session identity mismatch.");
    return drainNativeLiveMacSession({ session: binding.session,
      fence: () => this.executor.suspend(conversationId), close: () => this.executor.retire(conversationId),
      settle: async () => { await this.backgroundResults.flush(); },
    });
  }
  /** Ownership returned by a server attach; the binding was closed by the earlier drain. */
  async resume(conversationId: string, _providerSessionId: string): Promise<void> {
    this.executor.resumeHandoff(conversationId);
  }
  async closeAll(): Promise<void> {
    this.taskAbort.abort();await this.taskControls;
    this.stopped=true;this.watchdog?.stop();this.watchdog=null;
    await this.executor.closeAll();
    // Registry retains failed closes; its shutdown reports rather than hides them.
    await this.registry.closeAll();
    await this.backgroundResults.flush();
  }
}
