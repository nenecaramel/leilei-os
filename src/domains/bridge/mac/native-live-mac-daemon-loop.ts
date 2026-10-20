import { runDaemonMaintenance } from "./native-live-mac-daemon-maintenance.js";
import type {
  NativeLiveRuntimeControlReservation,
  NativeLiveDaemonRejectCode,
  NativeLiveResultSubmissionReceipt,
  NativeLiveDaemonRunOutcome,
  NativeLiveMacDaemonRelayClient,
  NativeLivePreparedCommandExecutor,
  NativeLiveDaemonIdleOpportunity,
  NativeLiveExternalSessionExecutor,
  NativeLiveManualCompactExecutor,
  NativeLiveProviderSessionCleanupExecutor,
  NativeLiveBackgroundModelExecutor,
} from "./native-live-mac-daemon-contract.js";
export type { NativeLiveDaemonLeaseState, NativeLiveDaemonReservation, NativeLiveProviderSessionCleanupReservation, NativeLiveBackgroundModelReservation, NativeLiveRuntimeControlReservation, NativeLiveDaemonRejectCode, NativeLiveResultSubmissionReceipt, NativeLiveDaemonRunOutcome, NativeLiveMacDaemonRelayClient, NativeLivePreparedCommandExecutor, NativeLiveDaemonIdleOpportunity, NativeLiveExternalSessionExecutor, NativeLiveManualCompactExecutor, NativeLiveProviderSessionCleanupExecutor, NativeLiveBackgroundModelExecutor } from "./native-live-mac-daemon-contract.js";
import type {
  NativeLiveMacPersistentExecutor,
  NativeLiveMacPersistentExecution,
} from "./native-live-mac-persistent-executor.js";
import { failure as runtimeFailure } from "./native-live-mac-runtime-executor.js";
import type { NativeLiveMacResultOutbox, NativeLivePendingResult } from "./native-live-mac-result-outbox.js";
import type {
  NativeLiveRuntimeCommand,
  NativeLiveRuntimeExecutionResult,
} from "../protocol/native-live-runtime-protocol.js";
import type {
  BreathSemanticScorer,
} from "../../runtime/breath/breath-semantic-recall.js";
import type {
  NativeLiveSemanticFallbackCode,
} from "../mind/native-live-semantic-handshake.js";

import type {
  NativeLiveNormalizedEvent,
} from "../../conversation/native-live-conversation-orchestrator.js";
import type {
  NativeLiveMacActiveTurnController,
} from "./native-live-mac-claude-transport.js";


export class NativeLiveMacDaemonLoop {
  private running = false;
  private readonly resultRecoveryConversations = new Set<string>();

  constructor(
    private readonly listenerInstanceId: string,
    private readonly relay: NativeLiveMacDaemonRelayClient,
    private readonly executor: NativeLivePreparedCommandExecutor,
    private readonly semanticScorer: BreathSemanticScorer | null = null,
    private readonly idleOpportunity:
      NativeLiveDaemonIdleOpportunity | null = null,
    private readonly backgroundModelExecutor:
      NativeLiveBackgroundModelExecutor | null = null,
    private readonly providerSessionCleanupExecutor:
      NativeLiveProviderSessionCleanupExecutor | null = null,
    private readonly manualCompactExecutor:
      NativeLiveManualCompactExecutor | null = null,
    private readonly externalSessionExecutor:
      NativeLiveExternalSessionExecutor | null = null,
    private readonly resultOutbox: NativeLiveMacResultOutbox | null = null,
    private readonly persistentExecutor: (Pick<NativeLiveMacPersistentExecutor, "canRoute" | "execute" | "retire"> & Partial<Pick<NativeLiveMacPersistentExecutor, "assertAccepting" | "retireSession" | "shouldDeferWake" | "suspend">>) | null = null,
    private readonly backgroundResults: { flush(): Promise<number> } | null = null,
  ) {}

  async runOnce(): Promise<NativeLiveDaemonRunOutcome> {
    if (this.running) {
      throw Object.assign(new Error("Native live daemon loop is already running."), {
        code: "NATIVE_LIVE_DAEMON_REENTRANT",
      });
    }

    this.running = true;
    let runtimeEventTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      for (const entry of await this.resultOutbox?.listQuarantined() ?? []) {
        this.fenceResultConversation(entry.result.conversation_id);
      }
      // One fresh listener lease covers recovery and this dispatch iteration.
      // Replaying old output still precedes selecting any fresh model input.
      const leaseStartedAt = performance.now();
      const lease = await this.relay.renewLease({
        listenerInstanceId: this.listenerInstanceId,
        dispatchTarget: "claude_code",
      });
      if (lease === "busy") return { outcome: "busy" };
      await this.backgroundResults?.flush();
      // Listener leases last 60s. Slow recovery or network setup must not
      // consume the lease before fresh work; the server still fences each call.
      if (performance.now() - leaseStartedAt >= 30_000) {
        const renewed = await this.relay.renewLease({
          listenerInstanceId: this.listenerInstanceId,
          dispatchTarget: "claude_code",
        });
        if (renewed === "busy") return { outcome: "busy" };
      }
      const pending = (await this.resultOutbox?.list())?.[0];
      if (pending) {
        let receipt: NativeLiveResultSubmissionReceipt | void;
        try {
          receipt = await this.relay.submitResult(pending);
        } catch (error) {
          if (await this.quarantineConflict(pending, error)) return this.resultRecoveryOutcome(pending.reservationId, pending.result.conversation_id);
          return { outcome: "delivery_unknown", reservationId: pending.reservationId, result: pending.result };
        }
        await this.resultOutbox!.acknowledge(pending);
        return { outcome: "completed", reservationId: pending.reservationId, result: pending.result,
          ...(receipt?.canonicalOutcome ? { canonicalOutcome: receipt.canonicalOutcome } : {}) };
      }

      let semanticReservationId: string | null = null;
      if (
        this.relay.reserveSemanticScoring
        && this.relay.submitSemanticScores
        && this.relay.submitSemanticFallback
      ) {
        const semantic = await this.relay.reserveSemanticScoring({
          listenerInstanceId: this.listenerInstanceId,
          dispatchTarget: "claude_code",
        });
        if (semantic) {
          semanticReservationId = semantic.reservationId;
          try {
            if (!this.semanticScorer) {
              await this.relay.submitSemanticFallback({
                listenerInstanceId: this.listenerInstanceId,
                reservationId: semantic.reservationId,
                code: "E5_PROVIDER_UNAVAILABLE",
              });
            } else {
              const scored = await this.semanticScorer.score({
                query: semantic.query,
                candidates: semantic.candidates,
              });
              await this.relay.submitSemanticScores({
                listenerInstanceId: this.listenerInstanceId,
                reservationId: semantic.reservationId,
                scores: Object.fromEntries(scored),
              });
            }
          } catch (error) {
            if (this.semanticScorer && isSemanticProviderFailure(error)) {
              try {
                await this.relay.submitSemanticFallback({
                  listenerInstanceId: this.listenerInstanceId,
                  reservationId: semantic.reservationId,
                  code: semanticFallbackCode(error),
                });
              } catch {
                return {
                  outcome: "semantic_delivery_unknown",
                  reservationId: semantic.reservationId,
                };
              }
            } else {
              return {
                outcome: "semantic_delivery_unknown",
                reservationId: semantic.reservationId,
              };
            }
          }
        }
      }

      const reservation = await this.relay.reserveNext({
        listenerInstanceId: this.listenerInstanceId,
        dispatchTarget: "claude_code",
        ...(this.persistentExecutor ? { persistentSessions: true } : {}),
      });
      if (!reservation) {
        if (semanticReservationId) {
          return {
            outcome: "semantic_completed",
            reservationId: semanticReservationId,
          };
        }

        const maintenance = await runDaemonMaintenance({
          listenerInstanceId: this.listenerInstanceId, relay: this.relay,
          externalSessionExecutor: this.externalSessionExecutor, manualCompactExecutor: this.manualCompactExecutor,
          providerSessionCleanupExecutor: this.providerSessionCleanupExecutor, backgroundModelExecutor: this.backgroundModelExecutor,
          persistentExecutor: this.persistentExecutor,
        });
        if (maintenance) return maintenance;

        await this.bestEffortIdleOpportunity();
        return { outcome: "idle" };
      }

      if (this.resultRecoveryConversations.has(reservation.command.conversation_id)) {
        await this.bestEffortReject(reservation.reservationId, "EXECUTION_START_FAILED");
        return this.resultRecoveryOutcome(reservation.reservationId, reservation.command.conversation_id);
      }
      if (reservation.command.operation === "wake"
        && !this.persistentExecutor?.canRoute(reservation.command)
        && this.persistentExecutor?.shouldDeferWake?.(reservation.command)) {
        // Foreground work or the bounded writer capacity is temporarily busy.
        // Do not mark this Wake started, submit a model request or close any
        // SDK writer. Keep the same durable reservation pending for retry.
        await this.bestEffortReject(reservation.reservationId, "EXECUTION_START_FAILED");
        return { outcome: "rejected", reservationId: reservation.reservationId, code: "EXECUTION_START_FAILED" };
      }
      try {
        await this.relay.markExecutionStarted({
          listenerInstanceId: this.listenerInstanceId,
          reservationId: reservation.reservationId,
        });
      } catch {
        await this.bestEffortReject(
          reservation.reservationId,
          "EXECUTION_START_FAILED",
        );
        return {
          outcome: "rejected",
          reservationId: reservation.reservationId,
          code: "EXECUTION_START_FAILED",
        };
      }

      let result: NativeLiveRuntimeExecutionResult;
      let eventSequence = 0;
      let eventDeliveryFailures = 0;
      let pendingRuntimeEvents: Array<{
        sequence: number;
        event: NativeLiveNormalizedEvent;
      }> = [];
      let runtimeEventFlush: Promise<void> | null = null;
      const flushRuntimeEvents = async (): Promise<void> => {
        if (runtimeEventTimer !== null) { clearTimeout(runtimeEventTimer); runtimeEventTimer = null; }
        if (runtimeEventFlush) {
          await runtimeEventFlush;
          if (pendingRuntimeEvents.length > 0) {
            await flushRuntimeEvents();
          }
          return;
        }
        if (
          !this.relay.appendRuntimeEvents
          || pendingRuntimeEvents.length === 0
        ) {
          return;
        }
        // Keep one ordered upload in flight. Deltas arriving during network
        // latency join the next batch instead of blocking the SDK callback queue.
        // 32 is the existing server protocol limit; sparse turns still flush at 8.
        const drain = (async () => {
          while (pendingRuntimeEvents.length > 0) {
            const batch = pendingRuntimeEvents.splice(0, 32);
            try {
              await this.relay.appendRuntimeEvents!({
                listenerInstanceId: this.listenerInstanceId,
                reservationId: reservation.reservationId,
                events: batch,
              });
            } catch {
              // The HTTP relay client already bounded-retries this exact,
              // idempotent sequence batch on transient transport / 5xx failures.
              // Once that budget is exhausted, stay fail-soft: the terminal
              // result still carries the canonical fallback event set. Runtime-only
              // observability is intentionally not duplicated into the result body.
              eventDeliveryFailures += batch.length;
            }
          }
        })();
        runtimeEventFlush = drain;
        try {
          await drain;
        } finally {
          runtimeEventFlush = null;
        }
      };
      let persistentRun: NativeLiveMacPersistentExecution | null = null;
      const commit = async (value: NativeLiveRuntimeExecutionResult) => {
        const entry = { listenerInstanceId: this.listenerInstanceId, reservationId: reservation.reservationId, result: value };
        await this.resultOutbox?.save(entry);
        await flushRuntimeEvents();
        let receipt: NativeLiveResultSubmissionReceipt | void;
        try { receipt = await this.relay.submitResult(entry); } catch (error) {
          if (await this.quarantineConflict(entry, error)) throw new Error("Terminal result requires verified recovery.");
          throw error;
        }
        await this.resultOutbox?.acknowledge(entry);
        return receipt;
      };
      const execute = async (command: NativeLiveRuntimeCommand, options: Parameters<NativeLivePreparedCommandExecutor["execute"]>[1]) => {
        this.persistentExecutor?.assertAccepting?.(command.conversation_id);
        // Edit/retry replaces the visible branch. Retire its old writer BEFORE
        // asking the new fork to open; the replaced native schedule must never
        // keep running in parallel with a different presentation branch.
        if (command.operation === "edit" || command.operation === "retry") {
          await this.persistentExecutor?.retire(command.conversation_id);
          // Only exact-checkpoint replacements can own a persistent child.
          // The executor still leaves legacy checkpoint-less forks one-shot.
          if (this.persistentExecutor?.canRoute(command)) {
            persistentRun = await this.persistentExecutor.execute(command, { ...options, commit });
            return persistentRun.result;
          }
          const exactReplacement = command.parent_provider_checkpoint_id !== undefined
            && (command.runtime_mode === "new" || command.runtime_mode === "fork"
              && !!command.parent_provider_session_id && !!command.parent_provider_checkpoint_id);
          if (this.persistentExecutor && exactReplacement) return runtimeFailure(command, "RUNTIME_UNAVAILABLE");
          return this.executor.execute(command, options);
        }
        if (command.operation === "wake") {
          // Wake NEVER reaches the branch/fork/one-shot execution below.
          // A missing or mismatched live writer is a failed Wake, not a
          // reason to close the writer currently holding native schedules.
          if (command.runtime_mode !== "resume" || !this.persistentExecutor?.canRoute(command)) {
            return runtimeFailure(command, "NO_PROVIDER_SESSION");
          }
          persistentRun = await this.persistentExecutor.execute(command, { ...options, commit });
          return persistentRun.result;
        }
        if (this.persistentExecutor?.canRoute(command)) {
          persistentRun = await this.persistentExecutor.execute(command, { ...options, commit });
          return persistentRun.result;
        }
        await this.persistentExecutor?.retire(command.conversation_id);
        return this.executor.execute(command, options);
      };
      try {
        result = await execute(
          reservation.command,
          {
            ...(this.relay.appendRuntimeEvents
              ? {
                  onNormalizedEvent: async (event: NativeLiveNormalizedEvent) => {
                    eventSequence += 1;
                    pendingRuntimeEvents.push({
                      sequence: eventSequence,
                      event,
                    });
                    // Clock boundaries must reach the repository independently even on sparse turns.
                    if ((event.type === "runtime" && event.payload?.kind === "provider_message_start")
                        || event.type === "result" || event.type === "error") {
                      await flushRuntimeEvents();
                    } else if (pendingRuntimeEvents.length >= 8 && !runtimeEventFlush) {
                      void flushRuntimeEvents();
                    } else if (!runtimeEventFlush && runtimeEventTimer === null) {
                      // Sparse output must not wait for another seven deltas.
                      // One upload owner still drains all batches in order.
                      runtimeEventTimer = setTimeout(() => { void flushRuntimeEvents(); }, 100);
                      runtimeEventTimer.unref();
                    }
                  },
                }
              : {}),
            ...(this.relay.requestRuntimeInteraction
              ? {
                  permissionHandler: async (
                    request: Record<string, unknown>,
                    context: { signal: AbortSignal | null },
                  ) =>
                    this.relay.requestRuntimeInteraction!({
                      listenerInstanceId:
                        this.listenerInstanceId,
                      reservationId:
                        reservation.reservationId,
                      kind: "permission",
                      request,
                      signal: context.signal,
                    }),
                  questionHandler: async (
                    request: Record<string, unknown>,
                    context: { signal: AbortSignal | null },
                  ) =>
                    this.relay.requestRuntimeInteraction!({
                      listenerInstanceId:
                        this.listenerInstanceId,
                      reservationId:
                        reservation.reservationId,
                      kind: "question",
                      request,
                      signal: context.signal,
                    }),
                }
              : {}),
            ...(this.relay.waitRuntimeControl
              && this.relay.completeRuntimeControl
              ? {
                  controlPump: (
                    controller: NativeLiveMacActiveTurnController,
                    context: { signal: AbortSignal },
                  ) =>
                    this.runRuntimeControlPump(
                      reservation.reservationId,
                      controller,
                      context.signal,
                    ),
                }
              : {}),
          },
        );
      } catch (error) {
        if (this.resultRecoveryConversations.has(reservation.command.conversation_id)) {
          return this.resultRecoveryOutcome(reservation.reservationId, reservation.command.conversation_id);
        }
        // A reservation that reached /execution-started then failed before
        // submitting any provider result must have an observable local cause.
        // Earlier logs only said "rejected", hiding a fenced SDK writer after
        // a 409 background receipt. Never log prompts, tokens or model output.
        const errorName = error instanceof Error ? error.name : "UnknownError";
        const errorMessage = error instanceof Error ? error.message.slice(0, 240) : "Unknown dispatch error";
        process.stderr.write(JSON.stringify({
          at: new Date().toISOString(),
          outcome: "native_runtime_dispatch_rejected",
          reservationId: reservation.reservationId,
          operation: reservation.command.operation,
          runtimeMode: reservation.command.runtime_mode,
          errorName, errorMessage,
        }) + "\n");
        await flushRuntimeEvents();
        await this.bestEffortReject(reservation.reservationId, "INVALID_COMMAND");
        return {
          outcome: "rejected",
          reservationId: reservation.reservationId,
          code: "INVALID_COMMAND",
        };
      }

      if (this.resultRecoveryConversations.has(reservation.command.conversation_id)) {
        return this.resultRecoveryOutcome(reservation.reservationId, reservation.command.conversation_id);
      }
      const persistent = persistentRun as NativeLiveMacPersistentExecution | null;
      if (persistent && persistent.delivery !== "pending") {
        if (persistent.delivery === "unknown") await this.bestEffortDeliveryUnknown(reservation.reservationId);
        return { outcome: persistent.delivery === "unknown" ? "delivery_unknown" : "completed",
          reservationId: reservation.reservationId, result,
          ...(persistent.canonicalOutcome ? { canonicalOutcome: persistent.canonicalOutcome } : {}),
          ...(eventDeliveryFailures ? { eventDeliveryFailures } : {}) };
      }
      const pendingResult = {
        listenerInstanceId: this.listenerInstanceId,
        reservationId: reservation.reservationId,
        result,
      };
      await this.resultOutbox?.save(pendingResult);
      await flushRuntimeEvents();
      let submission:
        NativeLiveResultSubmissionReceipt | void;
      try {
        submission = await this.relay.submitResult({
          listenerInstanceId: this.listenerInstanceId,
          reservationId: reservation.reservationId,
          result,
        });
      } catch (error) {
        if (await this.quarantineConflict(pendingResult, error)) return this.resultRecoveryOutcome(reservation.reservationId, result.conversation_id);
        await this.bestEffortDeliveryUnknown(reservation.reservationId);
        const diagnostics = relayFailureDiagnostics(error);
        return {
          outcome: "delivery_unknown",
          reservationId: reservation.reservationId,
          result,
          ...(eventDeliveryFailures > 0
            ? { eventDeliveryFailures }
            : {}),
          ...(diagnostics.relayErrorCode
            ? { relayErrorCode: diagnostics.relayErrorCode }
            : {}),
          ...(diagnostics.finalizeCode
            ? { finalizeCode: diagnostics.finalizeCode }
            : {}),
        };
      }

      await this.resultOutbox?.acknowledge(pendingResult);
      return {
        outcome: "completed",
        reservationId: reservation.reservationId,
        result,
        ...(eventDeliveryFailures > 0
          ? { eventDeliveryFailures }
          : {}),
        ...(submission?.canonicalOutcome
          ? {
              canonicalOutcome:
                submission.canonicalOutcome,
            }
          : {}),
      };
    } finally {
      if (runtimeEventTimer !== null) clearTimeout(runtimeEventTimer);
      this.running = false;
    }
  }

  private fenceResultConversation(conversationId: string): void {
    this.resultRecoveryConversations.add(conversationId);
    this.persistentExecutor?.suspend?.(conversationId, "recovery");
  }

  private resultRecoveryOutcome(reservationId: string, conversationId: string): NativeLiveDaemonRunOutcome {
    return { outcome: "result_recovery_required", reservationId, conversationId, code: "RESERVATION_CONFLICT" };
  }

  private async quarantineConflict(entry: NativeLivePendingResult, error: unknown): Promise<boolean> {
    if (!this.resultOutbox || !error || typeof error !== "object") return false;
    const failure = error as { httpStatus?: unknown; relayCode?: unknown };
    // Only an explicit permanent protocol rejection. Transport, malformed JSON
    // and 5xx failures keep the original reservation in the normal retry queue.
    if (failure.httpStatus !== 409 || failure.relayCode !== "RESERVATION_CONFLICT") return false;
    await this.resultOutbox.quarantine(entry);
    this.fenceResultConversation(entry.result.conversation_id);
    return true;
  }

  private async runRuntimeControlPump(
    reservationId: string,
    controller: NativeLiveMacActiveTurnController,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      let control: NativeLiveRuntimeControlReservation | null;
      try {
        control = await this.relay.waitRuntimeControl!({
          listenerInstanceId: this.listenerInstanceId,
          reservationId,
          signal,
        });
      } catch {
        if (signal.aborted) return;
        await delayWithAbort(1_000, signal);
        continue;
      }

      if (!control) {
        continue;
      }

      try {
        let receipt: Record<string, unknown>;
        if (control.kind === "mid_turn_input") {
          const text = control.payload.text;
          if (typeof text !== "string" || text.trim().length === 0) {
            throw Object.assign(
              new Error("Invalid mid-turn control payload."),
              { controlCode: "INVALID_CONTROL_PAYLOAD" },
            );
          }
          receipt = await controller.sendUserMessage(text, {
            uuid: control.controlId,
          });
        } else {
          receipt = await controller.interrupt();
        }

        try {
          await this.relay.completeRuntimeControl!({
            listenerInstanceId: this.listenerInstanceId,
            reservationId,
            controlId: control.controlId,
            outcome: {
              status: "applied",
              receipt,
            },
          });
        } catch {
          // The control was already applied to the provider. Never re-apply
          // after an ambiguous completion callback.
        }

        if (control.kind === "interrupt") return;
      } catch (error) {
        try {
          await this.relay.completeRuntimeControl!({
            listenerInstanceId: this.listenerInstanceId,
            reservationId,
            controlId: control.controlId,
            outcome: {
              status: "failed",
              failureCode:
                runtimeControlFailureCode(error),
            },
          });
        } catch {
          // Failure reporting is idempotent but best-effort. The reserved row
          // prevents a blind re-application of an uncertain provider control.
        }
      }
    }
  }

  private async bestEffortIdleOpportunity(): Promise<void> {
    try {
      await this.idleOpportunity?.offer();
    } catch {
      // Background opportunity failure must never turn an idle poll into
      // foreground Native Live failure.
    }
  }

  private async bestEffortReject(
    reservationId: string,
    code: NativeLiveDaemonRejectCode,
  ): Promise<void> {
    try {
      await this.relay.rejectReservation({
        listenerInstanceId: this.listenerInstanceId,
        reservationId,
        code,
      });
    } catch {
      // The caller only needs the local run outcome. A relay implementation
      // must reconcile ambiguous rejection separately rather than blind-retry.
    }
  }

  private async bestEffortDeliveryUnknown(
    reservationId: string,
  ): Promise<void> {
    try {
      await this.relay.markResultDeliveryUnknown({
        listenerInstanceId: this.listenerInstanceId,
        reservationId,
      });
    } catch {
      // Never blind-retry a result callback whose delivery outcome is unknown.
    }
  }
}

function isSemanticProviderFailure(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (
      (error as { code?: unknown }).code === "PROVIDER_NOT_PREPARED"
      || (error as { code?: unknown }).code === "PROVIDER_LOAD_FAILED"
      || (error as { code?: unknown }).code === "INVALID_EMBEDDING_OUTPUT"
    )
  );
}

function semanticFallbackCode(
  error: unknown,
): NativeLiveSemanticFallbackCode {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "PROVIDER_NOT_PREPARED"
  )
    ? "E5_PROVIDER_UNAVAILABLE"
    : "E5_SCORING_FAILED";
}

function runtimeControlFailureCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "controlCode" in error
    && typeof (error as { controlCode?: unknown }).controlCode === "string"
  ) {
    return (error as { controlCode: string }).controlCode;
  }
  if (
    typeof error === "object"
    && error !== null
    && "runtimeCode" in error
    && typeof (error as { runtimeCode?: unknown }).runtimeCode === "string"
  ) {
    return (error as { runtimeCode: string }).runtimeCode;
  }
  return "CONTROL_APPLICATION_FAILED";
}

function delayWithAbort(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function relayFailureDiagnostics(error: unknown): {
  relayErrorCode: string | null;
  finalizeCode: string | null;
} {
  if (!error || typeof error !== "object") {
    return { relayErrorCode: null, finalizeCode: null };
  }
  const record = error as {
    relayCode?: unknown;
    finalizeCode?: unknown;
  };
  return {
    relayErrorCode:
      typeof record.relayCode === "string"
        ? record.relayCode
        : null,
    finalizeCode:
      typeof record.finalizeCode === "string"
        ? record.finalizeCode
        : null,
  };
}
