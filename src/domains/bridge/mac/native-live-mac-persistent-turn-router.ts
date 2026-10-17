import { NativeLiveMacExecutionLease } from "./native-live-mac-execution-lease.js";
import { isDeepStrictEqual } from "node:util";
import {
  parseNativeLiveRuntimeCommand,
  type NativeLiveRuntimeCommand,
} from "../protocol/native-live-runtime-protocol.js";
import {
  type NativeLiveMacPersistentSessionOptions,
  type NativeLiveMacPersistentTurnOutput,
  type NativeLiveMacSessionResult,
  type NativeLiveMacActiveTurnController,
} from "./native-live-mac-claude-transport.js";
import type { NativeLiveMacDaemonRelayClient } from "./native-live-mac-daemon-loop.js";
import { createNativeLiveMacExecutionAdmission } from "./native-live-mac-execution-admission.js";
import {
  NativeLiveMacSessionRegistry,
  type NativeLiveMacSessionBinding,
} from "./native-live-mac-session-registry.js";
import { resolveNativeLiveMacWorkingDirectory } from "./native-live-mac-working-directory-runtime.js";

export type NativeLiveMacPersistentBackgroundOwner = Readonly<{
  conversationId: string; generationId: string;
  source: Readonly<{ prepareId: string; requestId: string }> | null;
  providerSessionId: string; parentProviderCheckpointId: string | null; workingDirectory: string;
  executionStart?: boolean;
  deferred?: boolean;
}>;

export type NativeLiveMacPersistentAcknowledgement =
  | Readonly<{ status: "applied" | "idempotent" | "queued"; providerCheckpointId: string; continuationOnly?: boolean }>
  | Readonly<{ status: "rejected" }>;
type TurnInput = {
  command: NativeLiveRuntimeCommand;
  /** Materialized prompt (attachment paths appended) when the command has attachments. */
  prompt?: string;
  // The sink must use the existing transactional reservation/head fences. An
  // execution-admission snapshot cannot make finalization safe on its own.
  onResult(frame: { command: NativeLiveRuntimeCommand; result: NativeLiveMacSessionResult; providerCheckpointId: string }): Promise<NativeLiveMacPersistentAcknowledgement>;
  permissionHandler?: NativeLiveMacPersistentSessionOptions["permissionHandler"];
  questionHandler?: NativeLiveMacPersistentSessionOptions["questionHandler"];
  controlPump?: (controller: NativeLiveMacActiveTurnController, context: { signal: AbortSignal }) => Promise<void>;
} & NativeLiveMacPersistentTurnOutput;
type Slot = TurnInput & {
  inputId: string;
  phase: "executing" | "acknowledging";
  authorize: NativeLiveMacPersistentSessionOptions["authorize"];
  lease?: NativeLiveMacExecutionLease;
  controlAbort?: AbortController;
  resultReady: boolean;
  nativeStarted?: boolean;
  startedBinding?: Promise<void>;
  effectiveCommand?: NativeLiveRuntimeCommand;
  finished: Promise<void>;
  finish(): void;
};

// Explicit opt-in adapter. No daemon dispatch path selects this yet. A single
// router owns one conversation generation; never reuse it after rewind/handoff.
export class NativeLiveMacPersistentTurnRouter {
  private binding: NativeLiveMacSessionBinding | null = null;
  private generationId: string | null = null;
  private initialCommand: NativeLiveRuntimeCommand | null = null;
  private active: Slot | null = null;
  private retired = false;
  private suspended = false;
  private closing: Promise<void> | null = null;
  private acknowledgement = Promise.resolve();
  private providerCheckpointId: string | null = null;
  private backgroundSource: NativeLiveMacPersistentBackgroundOwner["source"] = null;

  constructor(private readonly input: {
    registry: NativeLiveMacSessionRegistry;
    listenerInstanceId: string;
    taskControlsAvailable?: () => Promise<boolean>;
    relay: Pick<NativeLiveMacDaemonRelayClient, "bindInput" | "checkExecutionAdmission" | "renewExecutionLease" | "checkTaskAdmission">;
    // Autonomous results deliberately have no foreground command. They require
    // their own durable preparation/branch fence, not the active turn's sink.
    onBackgroundResult(
      owner: NativeLiveMacPersistentBackgroundOwner,
      frame: Parameters<NativeLiveMacPersistentSessionOptions["onBackgroundResult"]>[0] & { providerCheckpointId: string },
    ): Promise<NativeLiveMacPersistentAcknowledgement>;
    onForegroundCoverage?(conversationId: string, generationId: string, coveringCheckpointId: string): Promise<number>;
    onForegroundPublished?(conversationId: string, generationId: string): Promise<void>;
    onForegroundUnpublished?(conversationId: string): void;
  }) {
    if (!input.listenerInstanceId.trim() || typeof input.onBackgroundResult !== "function") throw new Error("Listener and durable background sink are required.");
    this.input = { ...input };
  }

  async execute(input: TurnInput): Promise<NativeLiveMacSessionResult> {
    this.assertLive();
    if (this.suspended) throw new Error("Persistent session is draining for handoff.");
    if (this.active) throw new Error("Persistent turn is active or awaiting durable acknowledgement.");
    const command = freezeCommand(parseNativeLiveRuntimeCommand(input.command));
    if (!["send", "wake"].includes(command.operation) || !["new", "resume"].includes(command.runtime_mode)
      || (command.attachments?.length && typeof input.prompt !== "string") || command.failed_user_message_uuids?.length
      || command.parent_provider_checkpoint_id === undefined) throw new Error("Unsupported command for persistent turn routing.");
    if (typeof input.onResult !== "function") throw new Error("Durable turn result sink is required.");
    if (this.initialCommand && command.conversation_id !== this.initialCommand.conversation_id) throw new Error("Persistent router belongs to a different conversation.");
    if (this.binding && (command.runtime_mode !== "resume" || command.parent_provider_session_id !== this.binding.session.sessionId)) throw new Error("Persistent command changed session identity.");
    if (this.binding && command.parent_provider_checkpoint_id !== this.providerCheckpointId
      && !(command.operation === "send" && command.runtime_mode === "resume" && this.input.relay.bindInput))
      throw new Error("Persistent command changed checkpoint; retire before branching.");
    // A stale serialized send can only enter this writer's queue when the
    // server verifies its exact live reservation and branch at bindInput().
    // No retry/edit/wake/foreign session receives this exception.
    if (this.initialCommand && !this.selectionMatches(command)) throw new Error("Execution selection changes are not supported by the persistent router yet.");
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const slot: Slot = { ...input, resultReady: false, finished, finish, command, inputId: command.canonical_user_message_id ?? command.prepare_id,
      phase: "executing", authorize: createNativeLiveMacExecutionAdmission({ listenerInstanceId: this.input.listenerInstanceId, command, relay: this.input.relay }) };
    // Reserve before the first await, including path resolution and SDK startup.
    this.active = slot;
    let onCommandStarted: ((frame: { inputId: string; source: string }) => void) | null = null;
    let removeCommandStartedListener: (() => void) | null = null;
    let coveredBackgroundOutstanding = false;
    try {
      if (this.binding && command.expected_working_directory !== null) {
        const cwd = await resolveNativeLiveMacWorkingDirectory(command.expected_working_directory);
        this.assertSlot(slot);
        if (cwd !== this.binding.workingDirectory) throw new Error("Persistent command changed working directory.");
      }
      if (!this.binding) await this.open(slot);
      this.assertSlot(slot);
      if (this.input.relay.renewExecutionLease) {
        slot.lease = new NativeLiveMacExecutionLease({
          renew: () => this.input.relay.renewExecutionLease!({ listenerInstanceId: this.input.listenerInstanceId, command: slot.effectiveCommand ?? command }),
          onRevoked: async () => { if (this.active === slot && slot.phase === "executing") await this.close(); },
        });
        await slot.lease.start(); this.assertSlot(slot);
      }
      // Queued is an advisory reservation. Only the CLI's exact native start
      // UUID may bind the eventual canonical parent and continuation cursor.
      const bindInput = command.operation === "send" && command.runtime_mode === "resume"
        ? this.input.relay.bindInput?.bind(this.input.relay) : undefined;
      if (bindInput) {
        const queued = await bindInput({ listenerInstanceId: this.input.listenerInstanceId,
          command, phase: "queued", commandUuid: slot.inputId });
        if (!queued || queued.userMessageId !== slot.inputId
          || queued.parentProviderCheckpointId !== command.parent_provider_checkpoint_id)
          throw new Error("Native foreground queued input binding rejected.");
      }
      onCommandStarted = frame => {
        if (!bindInput || this.active !== slot || frame.inputId !== slot.inputId
          || frame.source !== "foreground" || slot.nativeStarted) return;
        slot.nativeStarted = true;
        // A native-start frame can race the preceding background HTTP ACK.
        // Never bind to a canonical head before its earlier receipt settles.
        // Capture only preceding acknowledgements, not this foreground's
        // future finalization (which would deadlock waiting on this binding).
        const precedingAcknowledgements = this.acknowledgement;
        slot.startedBinding = precedingAcknowledgements.then(() => {
          this.assertSlot(slot);
          if (this.suspended) throw new Error("Native binding was fenced during background recovery.");
          return bindInput({ listenerInstanceId: this.input.listenerInstanceId,
            command, phase: "started", commandUuid: frame.inputId });
        }).then(bound => {
          if (!bound || bound.userMessageId !== slot.inputId
            || bound.parentProviderCheckpointId !== this.providerCheckpointId)
            throw new Error("Native foreground started input cannot prove latest checkpoint.");
          // The server may have appended an earlier native background result
          // between queued and started. All subsequent lease/tool checks must
          // authorize the newly proven binding, never the original cursor.
          slot.effectiveCommand = { ...command, parent_provider_checkpoint_id: bound.parentProviderCheckpointId };
          slot.authorize = createNativeLiveMacExecutionAdmission({
            listenerInstanceId: this.input.listenerInstanceId,
            command: slot.effectiveCommand, relay: this.input.relay,
          });
        });
        slot.startedBinding.catch(() => {}); // The terminal path awaits the exact result.
      };
      if (bindInput) {
        const events = this.binding!.session.events;
        events.on("command-started", onCommandStarted);
        removeCommandStartedListener = () => events.off("command-started", onCommandStarted!);
      }
      const resultPromise = this.binding!.session.submit(input.prompt ?? command.prompt, { id: slot.inputId, source: command.operation === "wake" ? "task-notification" : "human", ...this.output(slot) });
      let controls: Promise<void> | null = null;
      if (input.controlPump) {
        slot.controlAbort = new AbortController();
        const session = this.binding!.session;
        const control = async <T>(call: () => Promise<T>, allowClosed = false): Promise<T> => {
          this.assertSlot(slot); if (this.suspended) throw new Error("Persistent session is draining.");
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const receipt = await Promise.race([call(), new Promise<never>((_, reject) => {
              timer = setTimeout(() => { void this.close().catch(() => {}); reject(new Error("Control receipt deadline expired; provider outcome unknown.")); }, 2_000);
            })]);
            if (allowClosed && receipt && typeof receipt === "object" && "session_closed" in receipt && receipt.session_closed === true && this.active === slot && !this.suspended) return receipt;
            this.assertSlot(slot); if (this.suspended) throw new Error("Persistent session is draining."); return receipt;
          } finally { clearTimeout(timer); }
        };
        const controller: NativeLiveMacActiveTurnController = {
          sendUserMessage: (text, options) => control(() => session.sendUserMessage(text, options)),
          interrupt: async () => { const receipt = await control(() => session.interruptTurn(), true); if (!receipt) throw new Error("No active input can be interrupted."); return receipt; },
        };
        controls = Promise.resolve().then(() => input.controlPump!(controller, { signal: slot.controlAbort!.signal }));
        controls.catch(() => {});
      }
      let result: NativeLiveMacSessionResult;
      try { result = await resultPromise; }
      finally { slot.controlAbort?.abort(); await controls?.catch(() => {}); }
      this.assertSlot(slot);
      if (result.inputId !== slot.inputId || result.providerSessionId !== this.binding!.session.sessionId) throw new Error("Persistent result changed input/session identity.");
      if (bindInput) {
        if (!slot.nativeStarted || !slot.startedBinding) throw new Error("Native foreground input started receipt is missing.");
        await slot.startedBinding;
      }
      slot.phase = "acknowledging"; // Revoke execution before awaiting the sink.
      slot.lease?.stop();
      await this.acknowledge(async () => {
        this.assertSlot(slot, "acknowledging");
        const providerCheckpointId = await this.binding!.session.verifyCheckpoint({ events: result.events, parentCheckpointId: this.providerCheckpointId });
        this.assertSlot(slot, "acknowledging");
        // The local SDK has proved that F descends the latest native
        // producer checkpoint. Journal the covering frontier *before* F is
        // submitted: a crash must not publish F without preserving B=>F proof.
        if (command.operation === "send") {
          const covered = await this.input.onForegroundCoverage?.(command.conversation_id, this.generationId!, providerCheckpointId);
          coveredBackgroundOutstanding = (covered ?? 0) > 0;
          this.assertSlot(slot, "acknowledging");
        }
        const outcome = await slot.onResult({ command, result, providerCheckpointId });
        this.assertSlot(slot, "acknowledging");
        const continuationOnly = outcome.status !== "rejected" && outcome.continuationOnly === true;
        if (continuationOnly && command.operation !== "wake") throw new Error("Only a quiet wake can acknowledge continuation without a visible source.");
        this.applyAcknowledgement(outcome, "turn", providerCheckpointId);
        if (!continuationOnly) this.backgroundSource = Object.freeze({ prepareId: command.prepare_id, requestId: command.request_id });
        if (command.operation === "send" && outcome.status !== "rejected") {
          // F is now a canonical head, so buffered autonomous B can be
          // published as the next real message using F's covering checkpoint.
          await this.input.onForegroundPublished?.(command.conversation_id, this.generationId!);
          coveredBackgroundOutstanding = false;
          this.assertSlot(slot, "acknowledging");
        }
      });
      this.assertSlot(slot, "acknowledging");
      return result;
    } catch (error) {
      // F may have failed after B\'s covering evidence was fsynced, or B\'s
      // post-F publication may have failed. Fence synchronously BEFORE another
      // foreground send can be dispatched against a potentially stale head.
      if (coveredBackgroundOutstanding) this.input.onForegroundUnpublished?.(command.conversation_id);
      // Provider work or a durable commit may already have happened. Never
      // replay, open a replacement query, or let a later turn consume this slot.
      try { await this.close(); } catch { /* Retain failed-close registry owner. */ }
      throw error;
    } finally {
      removeCommandStartedListener?.();
      slot.controlAbort?.abort(); slot.lease?.stop();
      if (this.active === slot) this.active = null;
      slot.finish();
    }
  }

  /** Whether this command can continue this writer: same session and committed checkpoint. */
  matches(rawCommand: NativeLiveRuntimeCommand): boolean {
    if (this.retired || this.suspended || this.active) return false;
    let command: NativeLiveRuntimeCommand;
    try { command = parseNativeLiveRuntimeCommand(rawCommand); } catch { return false; }
    if (!this.binding) return this.initialCommand === null;
    if (this.input.registry.get(this.binding.conversationId, this.binding.generationId) !== this.binding) return false;
    return command.conversation_id === this.binding.conversationId && command.runtime_mode === "resume"
      && command.parent_provider_session_id === this.binding.session.sessionId
      && (command.parent_provider_checkpoint_id === this.providerCheckpointId
        || (command.operation === "send" && this.input.relay.bindInput !== undefined))
      && this.selectionMatches(command);
  }
  private selectionMatches(command: NativeLiveRuntimeCommand): boolean {
    return (command.operation === "wake" && command.execution_selection == null)
      || isDeepStrictEqual(command.execution_selection, this.initialCommand?.execution_selection);
  }
  hasActiveTurn(): boolean { return this.active !== null; }
  get providerSessionId(): string | null { return this.binding?.session.sessionId ?? null; }
  async settle(): Promise<void> { await this.acknowledgement; }
  suspend(): void { this.suspended = true; this.active?.controlAbort?.abort(); }
  get workingDirectory(): string | null { return this.binding?.workingDirectory ?? null; }

  async close(): Promise<void> {
    this.retired = true; // Fence all callbacks synchronously before closing.
    this.active?.lease?.stop();
    this.active?.controlAbort?.abort();
    if (this.closing) return this.closing;
    const conversationId = this.initialCommand?.conversation_id;
    if (!conversationId || !this.generationId) return;
    const closing = this.input.registry.close(conversationId, this.generationId);
    this.closing = closing;
    try { await closing; }
    finally { if (this.closing === closing) this.closing = null; }
  }

  private assertLive(): void {
    if (this.retired || (this.binding && this.input.registry.get(this.binding.conversationId, this.binding.generationId) !== this.binding)) throw new Error("Persistent router generation is retired or closed.");
  }
  private assertSlot(slot: Slot, phase: Slot["phase"] = "executing"): void {
    this.assertLive();
    if (this.active !== slot || slot.phase !== phase) throw new Error("Persistent reservation is no longer active.");
  }
  private async authorize(context: Parameters<NativeLiveMacPersistentSessionOptions["authorize"]>[0]): Promise<boolean> {
    // Native timers may arrive as soon as the SDK finishes, before our durable
    // result receipt. Join that exact commit; never borrow a later reservation.
    const preceding = this.active;
    if (context.phase === "scheduled" && preceding?.resultReady) {
      await preceding.finished;
      if (this.active !== null) return false;
    }
    const slot = this.active;
    if (!slot && !this.suspended && (context.phase === "tool" || context.phase === "scheduled") && context.inputId === null && this.binding?.session.sessionId && this.backgroundSource && this.input.relay.checkTaskAdmission) {
      const source=this.backgroundSource, binding=this.binding, checkpoint=this.providerCheckpointId;
      try {
        this.assertLive();
        const admitted=await this.input.relay.checkTaskAdmission({listenerInstanceId:this.input.listenerInstanceId,prepareId:source.prepareId,providerSessionId:binding.session.sessionId!});
        this.assertLive();
        return admitted && !this.suspended && this.active===null && this.binding===binding && this.backgroundSource===source && this.providerCheckpointId===checkpoint;
      } catch {return false;}
    }
    if (this.suspended || !slot || slot.phase !== "executing" || context.inputId !== slot.inputId) return false;
    if (context.phase !== "input" && slot.command.operation === "send"
      && slot.command.runtime_mode === "resume" && this.input.relay.bindInput) {
      if (!slot.nativeStarted || !slot.startedBinding) return false;
      try { await slot.startedBinding; } catch { return false; }
    }
    try {
      this.assertSlot(slot);
      // Before command_lifecycle.started, the foreground was queued against
      // the previous canonical checkpoint. A native autonomous result can have
      // advanced the verified session checkpoint while it was queued. The
      // queued server binding (and fresh admission check below) is the fence;
      // rejecting that old cursor here would prevent native start and make
      // the authoritative rebind callback unreachable.
      if (context.phase === "input" && this.binding
        && slot.command.parent_provider_checkpoint_id !== this.providerCheckpointId
        && !(slot.command.operation === "send" && slot.command.runtime_mode === "resume"
          && this.input.relay.bindInput && !slot.nativeStarted)) return false;
      const checkpoint = this.providerCheckpointId;
      const admitted = await slot.authorize(context);
      this.assertSlot(slot);
      if (this.suspended || checkpoint !== this.providerCheckpointId) return false;
      return admitted;
    } catch { return false; }
  }
  private handler(kind: "permissionHandler" | "questionHandler"): NonNullable<TurnInput[typeof kind]> {
    return async (request, context) => {
      const denied = kind === "questionHandler"
        ? { decision: "cancel", message: "No live turn question handler is available." }
        : { decision: "deny", message: "No live turn permission handler is available.", interrupt: true };
      const slot = this.active;
      if (this.suspended || !slot || !slot[kind]) return denied;
      try {
        this.assertSlot(slot);
        const response = await slot[kind]!(request, context);
        this.assertSlot(slot);
        return this.suspended ? denied : response;
      } catch { return denied; }
    };
  }

  // Output callbacks act only while their own reservation is still executing.
  private output(slot: Slot): NativeLiveMacPersistentTurnOutput {
    const guard = <A extends unknown[], R>(handler: ((...args: A) => R) | undefined) => handler && ((...args: A): R => {
      this.assertSlot(slot);
      if (this.suspended) throw new Error("Persistent output is fenced for handoff.");
      return handler(...args);
    });
    return {
      ...(slot.onNormalizedEvent ? { onNormalizedEvent: guard(slot.onNormalizedEvent) } : {}),
      ...(slot.command.output_attachments_enabled === true && slot.toolImageHandler ? { toolImageHandler: guard(slot.toolImageHandler) } : {}),
      ...(slot.command.output_attachments_enabled === true && slot.sendFileHandler ? { sendFileHandler: guard(slot.sendFileHandler) } : {}),
    };
  }

  private applyAcknowledgement(outcome: NativeLiveMacPersistentAcknowledgement, kind: string, verified: string): void {
    if (!outcome || (outcome.status !== "applied" && outcome.status !== "idempotent" && outcome.status !== "queued")) throw new Error(`Persistent ${kind} finalization was rejected.`);
    if (typeof outcome.providerCheckpointId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outcome.providerCheckpointId)
      || outcome.providerCheckpointId === "00000000-0000-0000-0000-000000000000") throw new Error("Persistent acknowledgement requires its committed provider checkpoint.");
    if (outcome.providerCheckpointId !== verified) throw new Error(`Persistent ${kind} acknowledgement named a different checkpoint than the verified one.`);
    this.providerCheckpointId = outcome.providerCheckpointId;
  }

  private acknowledge<T>(sink: () => Promise<T>): Promise<T> {
    const outcome = this.acknowledgement.then(sink);
    this.acknowledgement = outcome.then(() => {}, () => {});
    return outcome;
  }

  private async open(slot: Slot): Promise<void> {
    const command = slot.command;
    if (this.input.registry.getGenerationId(command.conversation_id)) throw new Error("Conversation already owns a persistent writer.");
    this.initialCommand = command;
    this.providerCheckpointId = command.parent_provider_checkpoint_id ?? null;
    const taskControlsAvailable = await this.input.taskControlsAvailable?.() === true;
    this.assertSlot(slot);
    const options: NativeLiveMacPersistentSessionOptions = {
      execution: command.execution_selection,
      perTaskStopAffordance: taskControlsAvailable,
      authorize: context => this.authorize(context),
      permissionHandler: this.handler("permissionHandler"),
      questionHandler: this.handler("questionHandler"),
      onBackgroundResult: async frame => {
        this.assertLive();
        const foreground = this.active;
        if (foreground?.resultReady) { await foreground.finished; this.assertLive(); }
        if (!this.generationId) throw new Error("Persistent background generation is unavailable.");
        await this.acknowledge(async () => {
          this.assertLive();
          const providerCheckpointId = await this.binding!.session.verifyCheckpoint({ events: frame.events, parentCheckpointId: this.providerCheckpointId });
          this.assertLive();
          const owner: NativeLiveMacPersistentBackgroundOwner = Object.freeze({ conversationId: command.conversation_id,
            generationId: this.generationId!, source: this.backgroundSource, providerSessionId: this.binding!.session.sessionId!,
            executionStart: this.active?.command.operation === "send" && this.active?.nativeStarted !== true,
            deferred: this.active?.command.operation === "send" && this.active?.nativeStarted === true,
            parentProviderCheckpointId: this.providerCheckpointId, workingDirectory: this.binding!.workingDirectory });
          const outcome = await this.input.onBackgroundResult(owner, { ...frame, providerCheckpointId });
          this.assertLive();
          this.applyAcknowledgement(outcome, "background", providerCheckpointId);
        });
        this.assertLive();
      },
    };
    const input = { conversationId: command.conversation_id, expectedWorkingDirectory: command.expected_working_directory, options };
    const opening = command.runtime_mode === "new" ? this.input.registry.openNew(input) : this.input.registry.openExisting({ ...input, restore: {
      sessionId: command.parent_provider_session_id!, checkpointId: command.parent_provider_checkpoint_id!, inputId: slot.inputId, source: command.operation === "wake" ? "task-notification" : "human",
    } });
    this.generationId = this.input.registry.getGenerationId(command.conversation_id);
    this.binding = await opening;
    this.binding.session.events.on("turn-result", (frame: { inputId: string }) => {
      if (!this.retired && this.active?.inputId === frame.inputId) this.active.resultReady = true;
    });
    this.assertSlot(slot);
  }
}

function freezeCommand(command: NativeLiveRuntimeCommand): NativeLiveRuntimeCommand {
  // Parser builds fresh nested values; freezing prevents a sink/caller from
  // retargeting callbacks while asynchronous finalization is pending.
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  };
  freeze(command);
  return command;
}
