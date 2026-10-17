import type { NativeLiveMacActiveTurnController } from "./native-live-mac-claude-transport.js";
import type { NativeLiveNormalizedEvent } from "../../conversation/native-live-conversation-orchestrator.js";
import {
  NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION,
  parseNativeLiveRuntimeCommand,
  type NativeLiveRuntimeCommand,
  type NativeLiveRuntimeExecutionResult,
} from "../protocol/native-live-runtime-protocol.js";
import type { NativeLiveMacAttachmentMaterializer } from "./native-live-mac-attachment-materializer.js";
import type { NativeLiveMacOutputAttachmentSender } from "./native-live-mac-output-attachment-sender.js";
import type { NativeLiveMacPersistentAcknowledgement, NativeLiveMacPersistentTurnRouter } from "./native-live-mac-persistent-turn-router.js";
import { buildNativeLiveRuntimeMetadata, failure, runtimeFailureCode, runtimeFailureDiagnostics, terminalFallbackEvents, type NativeLiveMacRuntimeFailureDiagnostics } from "./native-live-mac-runtime-executor.js";

type Router = Pick<NativeLiveMacPersistentTurnRouter, "execute" | "close" | "matches" | "workingDirectory"> & Partial<Pick<NativeLiveMacPersistentTurnRouter, "suspend" | "settle" | "providerSessionId" | "hasActiveTurn">>;
type Handler = (request: Record<string, unknown>, context: { signal: AbortSignal | null }) => Promise<Record<string, unknown>>;
export type NativeLiveMacPersistentCommit = (result: NativeLiveRuntimeExecutionResult) => Promise<{ canonicalOutcome: string | null; nativeResumeCheckpointId?: string } | void>;
/**
 * committed: the result was submitted inside the turn (any server outcome); never resubmit.
 * unknown: submission was attempted and its outcome is unknown.
 * pending: nothing was submitted; the caller submits this (failure) result normally.
 */
export type NativeLiveMacPersistentExecution = Readonly<{
  result: NativeLiveRuntimeExecutionResult;
  delivery: "committed" | "unknown" | "pending";
  canonicalOutcome?: string | null;
}>;

// Not selected by the daemon yet. One router per conversation; a command that
// cannot continue it (fork, edit, other checkpoint) retires it and goes legacy.
export class NativeLiveMacPersistentExecutor {
  private readonly routers = new Map<string, Router>();
  private readonly retiring = new Set<string>();
  private shutDown = false;
  private readonly suspended = new Map<string, Set<"handoff" | "recovery">>();
  suspend(conversationId: string, reason: "handoff" | "recovery" = "handoff"): void {
    const reasons=this.suspended.get(conversationId)??new Set();reasons.add(reason);this.suspended.set(conversationId,reasons);this.routers.get(conversationId)?.suspend?.();
  }
  async recovered(conversationId:string):Promise<void>{
    const reasons=this.suspended.get(conversationId);if(!reasons?.has("recovery"))return;
    await this.retire(conversationId);reasons.delete("recovery");if(!reasons.size)this.suspended.delete(conversationId);
  }
  /** The conversation was attached back to LeileiOS: accept its turns again. Recovery fences stay. */
  resumeHandoff(conversationId: string): void {
    const reasons=this.suspended.get(conversationId);if(!reasons)return;
    reasons.delete("handoff");if(!reasons.size)this.suspended.delete(conversationId);
  }
  isForegroundActive(conversationId: string): boolean { return this.routers.get(conversationId)?.hasActiveTurn?.() === true; }
  assertAccepting(conversationId: string): void { if (this.shutDown || this.suspended.has(conversationId)) throw new Error("Persistent session is fenced for handoff."); }

  constructor(private readonly input: {
    createRouter(conversationId: string): Router;
    hasCapacity?(): boolean;
    attachmentMaterializer: NativeLiveMacAttachmentMaterializer | null;
    outputAttachmentSender: Pick<NativeLiveMacOutputAttachmentSender, "sendFile"> & Partial<Pick<NativeLiveMacOutputAttachmentSender, "sendInlineImage">> | null;
    /** Local daemon diagnostics only: bounded error identity, never prompt or output. */
    onRuntimeFailure?: ((diagnostics: NativeLiveMacRuntimeFailureDiagnostics) => void) | null;
  }) {}

  /** A send/wake that a new or the conversation's current writer can run. */
  canRoute(rawCommand: unknown): boolean {
    if (this.shutDown) return false;
    let command: NativeLiveRuntimeCommand;
    try { command = parseNativeLiveRuntimeCommand(rawCommand); } catch { return false; }
    const ordinary = ["send", "wake"].includes(command.operation) && ["new", "resume"].includes(command.runtime_mode);
    const replacement = ["edit", "retry"].includes(command.operation) && ["new", "fork"].includes(command.runtime_mode);
    if (!(ordinary || replacement) || command.parent_provider_checkpoint_id === undefined
      || command.failed_user_message_uuids?.length) return false;
    if (command.attachments?.length && !this.input.attachmentMaterializer) return false;
    if (this.retiring.has(command.conversation_id) || this.suspended.has(command.conversation_id)) return false;
    const router = this.routers.get(command.conversation_id);
    return router ? router.matches(command) : this.input.hasCapacity?.() !== false;
  }

  /** Close the conversation's writer before a legacy operation touches its session. */
  async retire(conversationId: string): Promise<void> {
    const router = this.routers.get(conversationId);
    if (!router) return;
    this.retiring.add(conversationId);
    await router.close();
    await router.settle?.();
    if (this.routers.get(conversationId) === router) this.routers.delete(conversationId);
    this.retiring.delete(conversationId);
  }

  async retireSession(providerSessionId: string): Promise<void> {
    for (const [id, router] of this.routers) if (router.providerSessionId === providerSessionId) await this.retire(id);
  }

  async retireAll(): Promise<void> {
    const outcomes=await Promise.allSettled([...this.routers.keys()].map(id=>this.retire(id)));
    const errors=outcomes.filter((r):r is PromiseRejectedResult=>r.status==="rejected");
    if(errors.length)throw new AggregateError(errors.map(r=>r.reason),"Persistent writers could not all close.");
  }

  async closeAll(): Promise<void> {
    this.shutDown = true;
    await this.retireAll();
  }

  async execute(rawCommand: unknown, options: {
    commit: NativeLiveMacPersistentCommit;
    onNormalizedEvent?: (event: NativeLiveNormalizedEvent) => void | Promise<void>;
    permissionHandler?: Handler;
    questionHandler?: Handler;
    controlPump?: (controller: NativeLiveMacActiveTurnController, context: { signal: AbortSignal }) => Promise<void>;
  }): Promise<NativeLiveMacPersistentExecution> {
    const command = parseNativeLiveRuntimeCommand(rawCommand);
    this.assertAccepting(command.conversation_id);
    if (!this.canRoute(command)) throw new Error("Command cannot use the persistent writer.");
    let router = this.routers.get(command.conversation_id);
    if (!router) { router = this.input.createRouter(command.conversation_id); this.routers.set(command.conversation_id, router); }
    const outputIds: string[] = [];
    const outputMetadata: Array<{ attachment_id: string; duration_seconds: number }> = [];
    let pendingOutputs = 0;
    const sendOutput = async <T>(send: () => Promise<T>, id: (value: T) => string, limit: string, signal?: AbortSignal): Promise<T> => {
      if (outputIds.length + pendingOutputs >= 8) throw new Error(limit);
      pendingOutputs += 1;
      try { const value = await send(); signal?.throwIfAborted(); outputIds.push(id(value)); return value; }
      finally { pendingOutputs -= 1; }
    };
    const outputs = this.input.outputAttachmentSender && command.output_attachments_enabled !== false
      && command.protocol_version === NATIVE_LIVE_RUNTIME_PROTOCOL_VERSION ? this.input.outputAttachmentSender : null;
    let delivery: NativeLiveMacPersistentExecution["delivery"] = "pending";
    let submitted: NativeLiveRuntimeExecutionResult | null = null;
    let canonicalOutcome: string | null = null;
    try {
      const local = this.input.attachmentMaterializer ? await this.input.attachmentMaterializer.materialize(command) : [];
      const prompt = this.input.attachmentMaterializer ? this.input.attachmentMaterializer.appendPrompt(command.prompt, local) : command.prompt;
      await router.execute({
        command, prompt,
        ...(options.onNormalizedEvent ? { onNormalizedEvent: options.onNormalizedEvent } : {}),
        ...(options.permissionHandler ? { permissionHandler: options.permissionHandler } : {}),
        ...(options.questionHandler ? { questionHandler: options.questionHandler } : {}),
        ...(options.controlPump ? { controlPump: options.controlPump } : {}),
        ...(outputs?.sendInlineImage ? { toolImageHandler: async (image: { data: string; mimeType: string }, context: { signal: AbortSignal }) => {
          context.signal.throwIfAborted();
          return sendOutput(() => outputs.sendInlineImage!({ ...image, signal: context.signal }), value => value.attachmentId,
            "Tool images and send_file may send at most 8 files in one turn.", context.signal);
        } } : {}),
        ...(outputs ? { sendFileHandler: async (file: { path: string; displayName: string | null }) => {
          const attachment = await sendOutput(() => outputs.sendFile({ path: file.path, displayName: file.displayName, workingDirectory: router!.workingDirectory! }),
            value => value.attachmentId, "send_file may send at most 8 files in one turn.");
          if (typeof attachment.durationSeconds === "number" && Number.isFinite(attachment.durationSeconds) && attachment.durationSeconds > 0) {
            outputMetadata.push({ attachment_id: attachment.attachmentId, duration_seconds: attachment.durationSeconds });
          }
          return attachment;
        } } : {}),
        onResult: async ({ result, providerCheckpointId }): Promise<NativeLiveMacPersistentAcknowledgement> => {
          const metadata = buildNativeLiveRuntimeMetadata(result);
          const success: NativeLiveRuntimeExecutionResult = {
            protocol_version: command.protocol_version, prepare_id: command.prepare_id, request_id: command.request_id,
            conversation_id: command.conversation_id, status: "success", provider_session_id: result.providerSessionId,
            effective_working_directory: router!.workingDirectory!, provider_checkpoint_id: providerCheckpointId,
            normalized_events: terminalFallbackEvents(result.normalizedEvents),
            ...(metadata ? { runtime_metadata: metadata } : {}),
            ...(outputIds.length ? { output_attachment_ids: [...outputIds] } : {}),
            ...(outputMetadata.length ? { output_attachment_metadata: [...outputMetadata] } : {}),
          };
          submitted = success;
          delivery = "unknown"; // From here a lost response is not the same as "not submitted".
          const receipt = await options.commit(success);
          delivery = "committed"; canonicalOutcome = receipt?.canonicalOutcome ?? null;
          // A quiet resume has no visible canonical turn. Only its explicit,
          // exact server-committed continuation cursor may keep this writer.
          const quiet = command.operation === "wake" && command.runtime_mode === "resume"
            && canonicalOutcome === "wake_quiet" && receipt?.nativeResumeCheckpointId === providerCheckpointId;
          return canonicalOutcome === "completed" || canonicalOutcome === "idempotent" || quiet
            ? { status: canonicalOutcome === "idempotent" ? "idempotent" : "applied", providerCheckpointId, ...(quiet ? { continuationOnly: true } : {}) }
            : { status: "rejected" };
        },
      });
      return { result: submitted!, delivery: "committed", canonicalOutcome };
    } catch (error) {
      // The router has already closed its writer; never replay the turn.
      try { await this.retire(command.conversation_id); } catch { /* Keep ownership until a verified close. */ }
      if (delivery !== "pending") return { result: submitted!, delivery, ...(delivery === "committed" ? { canonicalOutcome } : {}) };
      const code = runtimeFailureCode(error);
      try { this.input.onRuntimeFailure?.(runtimeFailureDiagnostics(command.prepare_id, code, error)); } catch { /* Diagnostics never change the outcome. */ }
      return { result: failure(command, code), delivery };
    } finally {
      await this.input.attachmentMaterializer?.cleanup(command).catch(() => undefined);
    }
  }
}
