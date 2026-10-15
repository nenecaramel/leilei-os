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
  constructor(input: {
    environment: NodeJS.ProcessEnv; defaultWorkingDirectory: string; listenerInstanceId: string;
    relay: Pick<NativeLiveMacHttpRelayClient, "checkExecutionAdmission" | "renewExecutionLease" | "prepareBackgroundResult" | "submitBackgroundResult">;
    outboxDirectory: string; mcpServerConfig?: NativeLiveMacMcpServerConfig | null;
    attachmentMaterializer: NativeLiveMacAttachmentMaterializer | null;
    outputAttachmentSender: NativeLiveMacOutputAttachmentSender | null;
    createTransport?: typeof createNativeLiveMacClaudeTransport;
  }) {
    this.registry = new NativeLiveMacSessionRegistry(input.environment, input.defaultWorkingDirectory, input.createTransport, () => null, input.mcpServerConfig ?? null);
    this.backgroundResults = new NativeLiveMacBackgroundResultSink({ listenerInstanceId: input.listenerInstanceId, relay: input.relay,
      outbox: new NativeLiveMacBackgroundResultOutbox(input.outboxDirectory) });
    this.executor = new NativeLiveMacPersistentExecutor({ attachmentMaterializer: input.attachmentMaterializer, outputAttachmentSender: input.outputAttachmentSender,
      createRouter: () => new NativeLiveMacPersistentTurnRouter({ registry: this.registry, listenerInstanceId: input.listenerInstanceId,
        relay: input.relay, onBackgroundResult: (owner, frame) => this.backgroundResults.commit(owner, frame) }) });
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
  async closeAll(): Promise<void> {
    await this.executor.closeAll();
    // Registry retains failed closes; its shutdown reports rather than hides them.
    await this.registry.closeAll();
    await this.backgroundResults.flush();
  }
}
