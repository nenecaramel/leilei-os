import { isDeepStrictEqual } from "node:util";
import {
  parseNativeLiveRuntimeCommand,
  type NativeLiveRuntimeCommand,
} from "../protocol/native-live-runtime-protocol.js";
import {
  type NativeLiveMacPersistentSessionOptions,
  type NativeLiveMacPersistentTurnOutput,
  type NativeLiveMacSessionResult,
} from "./native-live-mac-claude-transport.js";
import type { NativeLiveMacDaemonRelayClient } from "./native-live-mac-daemon-loop.js";
import { createNativeLiveMacExecutionAdmission } from "./native-live-mac-execution-admission.js";
import {
  NativeLiveMacSessionRegistry,
  type NativeLiveMacSessionBinding,
} from "./native-live-mac-session-registry.js";
import { resolveNativeLiveMacWorkingDirectory } from "./native-live-mac-working-directory-runtime.js";

export type NativeLiveMacPersistentAcknowledgement =
  | Readonly<{ status: "applied" | "idempotent"; providerCheckpointId: string }>
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
} & NativeLiveMacPersistentTurnOutput;
type Slot = TurnInput & {
  inputId: string;
  phase: "executing" | "acknowledging";
  authorize: NativeLiveMacPersistentSessionOptions["authorize"];
};

// Explicit opt-in adapter. No daemon dispatch path selects this yet. A single
// router owns one conversation generation; never reuse it after rewind/handoff.
export class NativeLiveMacPersistentTurnRouter {
  private binding: NativeLiveMacSessionBinding | null = null;
  private generationId: string | null = null;
  private initialCommand: NativeLiveRuntimeCommand | null = null;
  private active: Slot | null = null;
  private retired = false;
  private closing: Promise<void> | null = null;
  private acknowledgement = Promise.resolve();
  private providerCheckpointId: string | null = null;

  constructor(private readonly input: {
    registry: NativeLiveMacSessionRegistry;
    listenerInstanceId: string;
    relay: Pick<NativeLiveMacDaemonRelayClient, "checkExecutionAdmission">;
    // Autonomous results deliberately have no foreground command. They require
    // their own durable preparation/branch fence, not the active turn's sink.
    onBackgroundResult(
      owner: Readonly<{ conversationId: string; generationId: string }>,
      frame: Parameters<NativeLiveMacPersistentSessionOptions["onBackgroundResult"]>[0] & { providerCheckpointId: string },
    ): Promise<NativeLiveMacPersistentAcknowledgement>;
  }) {
    if (!input.listenerInstanceId.trim() || typeof input.onBackgroundResult !== "function") throw new Error("Listener and durable background sink are required.");
    this.input = { ...input };
  }

  async execute(input: TurnInput): Promise<NativeLiveMacSessionResult> {
    this.assertLive();
    if (this.active) throw new Error("Persistent turn is active or awaiting durable acknowledgement.");
    const command = freezeCommand(parseNativeLiveRuntimeCommand(input.command));
    if (!["send", "wake"].includes(command.operation) || !["new", "resume"].includes(command.runtime_mode)
      || (command.attachments?.length && typeof input.prompt !== "string") || command.failed_user_message_uuids?.length
      || command.parent_provider_checkpoint_id === undefined) throw new Error("Unsupported command for persistent turn routing.");
    if (typeof input.onResult !== "function") throw new Error("Durable turn result sink is required.");
    if (this.initialCommand && command.conversation_id !== this.initialCommand.conversation_id) throw new Error("Persistent router belongs to a different conversation.");
    if (this.binding && (command.runtime_mode !== "resume" || command.parent_provider_session_id !== this.binding.session.sessionId)) throw new Error("Persistent command changed session identity.");
    if (this.binding && command.parent_provider_checkpoint_id !== this.providerCheckpointId) throw new Error("Persistent command changed checkpoint; retire before branching.");
    if (this.initialCommand && !isDeepStrictEqual(command.execution_selection, this.initialCommand.execution_selection)) throw new Error("Execution selection changes are not supported by the persistent router yet.");
    const slot: Slot = { ...input, command, inputId: command.canonical_user_message_id ?? command.prepare_id,
      phase: "executing", authorize: createNativeLiveMacExecutionAdmission({ listenerInstanceId: this.input.listenerInstanceId, command, relay: this.input.relay }) };
    // Reserve before the first await, including path resolution and SDK startup.
    this.active = slot;
    try {
      if (this.binding && command.expected_working_directory !== null) {
        const cwd = await resolveNativeLiveMacWorkingDirectory(command.expected_working_directory);
        this.assertSlot(slot);
        if (cwd !== this.binding.workingDirectory) throw new Error("Persistent command changed working directory.");
      }
      if (!this.binding) await this.open(slot);
      this.assertSlot(slot);
      const result = await this.binding!.session.submit(input.prompt ?? command.prompt, { id: slot.inputId, source: command.operation === "wake" ? "task-notification" : "human", ...this.output(slot) });
      this.assertSlot(slot);
      if (result.inputId !== slot.inputId || result.providerSessionId !== this.binding!.session.sessionId) throw new Error("Persistent result changed input/session identity.");
      slot.phase = "acknowledging"; // Revoke execution before awaiting the sink.
      await this.acknowledge(async () => {
        this.assertSlot(slot, "acknowledging");
        const providerCheckpointId = await this.binding!.session.verifyCheckpoint({ events: result.events, parentCheckpointId: this.providerCheckpointId });
        this.assertSlot(slot, "acknowledging");
        const outcome = await slot.onResult({ command, result, providerCheckpointId });
        this.assertSlot(slot, "acknowledging");
        this.applyAcknowledgement(outcome, "turn", providerCheckpointId);
      });
      this.assertSlot(slot, "acknowledging");
      return result;
    } catch (error) {
      // Provider work or a durable commit may already have happened. Never
      // replay, open a replacement query, or let a later turn consume this slot.
      try { await this.close(); } catch { /* Retain failed-close registry owner. */ }
      throw error;
    } finally { if (this.active === slot) this.active = null; }
  }

  /** Whether this command can continue this writer: same session and committed checkpoint. */
  matches(rawCommand: NativeLiveRuntimeCommand): boolean {
    if (this.retired || this.active) return false;
    let command: NativeLiveRuntimeCommand;
    try { command = parseNativeLiveRuntimeCommand(rawCommand); } catch { return false; }
    if (!this.binding) return this.initialCommand === null;
    return command.conversation_id === this.binding.conversationId && command.runtime_mode === "resume"
      && command.parent_provider_session_id === this.binding.session.sessionId
      && command.parent_provider_checkpoint_id === this.providerCheckpointId
      && isDeepStrictEqual(command.execution_selection, this.initialCommand?.execution_selection);
  }
  get workingDirectory(): string | null { return this.binding?.workingDirectory ?? null; }

  async close(): Promise<void> {
    this.retired = true; // Fence all callbacks synchronously before closing.
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
    const slot = this.active;
    if (!slot || slot.phase !== "executing" || context.inputId !== slot.inputId) return false;
    try {
      this.assertSlot(slot);
      if (context.phase === "input" && this.binding && slot.command.parent_provider_checkpoint_id !== this.providerCheckpointId) return false;
      const checkpoint = this.providerCheckpointId;
      const admitted = await slot.authorize(context);
      this.assertSlot(slot);
      if (checkpoint !== this.providerCheckpointId) return false;
      return admitted;
    } catch { return false; }
  }
  private handler(kind: "permissionHandler" | "questionHandler"): NonNullable<TurnInput[typeof kind]> {
    return async (request, context) => {
      const denied = kind === "questionHandler"
        ? { decision: "cancel", message: "No live turn question handler is available." }
        : { decision: "deny", message: "No live turn permission handler is available.", interrupt: true };
      const slot = this.active;
      if (!slot || !slot[kind]) return denied;
      try {
        this.assertSlot(slot);
        const response = await slot[kind]!(request, context);
        this.assertSlot(slot);
        return response;
      } catch { return denied; }
    };
  }

  // Output callbacks act only while their own reservation is still executing.
  private output(slot: Slot): NativeLiveMacPersistentTurnOutput {
    const guard = <A extends unknown[], R>(handler: ((...args: A) => R) | undefined) => handler && ((...args: A): R => {
      this.assertSlot(slot);
      return handler(...args);
    });
    return {
      ...(slot.onNormalizedEvent ? { onNormalizedEvent: guard(slot.onNormalizedEvent) } : {}),
      ...(slot.command.output_attachments_enabled === true && slot.toolImageHandler ? { toolImageHandler: guard(slot.toolImageHandler) } : {}),
      ...(slot.command.output_attachments_enabled === true && slot.sendFileHandler ? { sendFileHandler: guard(slot.sendFileHandler) } : {}),
    };
  }

  private applyAcknowledgement(outcome: NativeLiveMacPersistentAcknowledgement, kind: string, verified: string): void {
    if (!outcome || (outcome.status !== "applied" && outcome.status !== "idempotent")) throw new Error(`Persistent ${kind} finalization was rejected.`);
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
    const options: NativeLiveMacPersistentSessionOptions = {
      execution: command.execution_selection,
      authorize: context => this.authorize(context),
      permissionHandler: this.handler("permissionHandler"),
      questionHandler: this.handler("questionHandler"),
      onBackgroundResult: async frame => {
        this.assertLive();
        if (!this.generationId) throw new Error("Persistent background generation is unavailable.");
        const owner = Object.freeze({ conversationId: command.conversation_id, generationId: this.generationId });
        await this.acknowledge(async () => {
          this.assertLive();
          const providerCheckpointId = await this.binding!.session.verifyCheckpoint({ events: frame.events, parentCheckpointId: this.providerCheckpointId });
          this.assertLive();
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
