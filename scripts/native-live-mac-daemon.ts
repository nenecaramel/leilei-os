import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { NativeLiveMacResultOutbox } from "../src/domains/bridge/mac/native-live-mac-result-outbox.js";
import {
  consumeNativeLiveMacMemeGitHubConfig,
  NativeLiveMacMemeSender,
} from "../src/domains/bridge/mac/native-live-mac-meme-sender.js";
import "dotenv/config";
import {
  NativeLiveMacDaemonLoop,
} from "../src/domains/bridge/mac/native-live-mac-daemon-loop.js";
import {
  NativeLiveMacHttpRelayClient,
} from "../src/domains/bridge/mac/native-live-mac-http-relay-client.js";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/mac/native-live-mac-runtime-executor.js";
import {
  NativeLiveMacBackgroundModelExecutor,
} from "../src/domains/bridge/mac/native-live-mac-background-model-executor.js";
import {
  LocalE5BreathSemanticScorer,
} from "../src/domains/runtime/breath/local-e5-embedding.js";
import {
  resolveNativeLiveMacDaemonConfig,
} from "../src/domains/bridge/mac/native-live-mac-daemon-config.js";
import {
  resolveNativeLiveMacClaudeTransportKind,
} from "../src/domains/bridge/mac/native-live-mac-claude-transport.js";
import {
  NativeLiveMacWorkingDirectoryRuntimePool,
} from "../src/domains/bridge/mac/native-live-mac-working-directory-runtime.js";
import {
  NativeLiveMacCompanionScheduler,
} from "../src/domains/bridge/mac/native-live-mac-companion-scheduler.js";
import {
  NativeLiveMacSilenceWakeScheduler,
} from "../src/domains/bridge/mac/native-live-mac-silence-wake-scheduler.js";
import {
  acquireNativeLiveMacDaemonLock,
} from "../src/domains/bridge/mac/native-live-mac-daemon-lock.js";
import {
  NativeLiveMacAttachmentMaterializer,
} from "../src/domains/bridge/mac/native-live-mac-attachment-materializer.js";
import {
  NativeLiveMacOutputAttachmentSender,
} from "../src/domains/bridge/mac/native-live-mac-output-attachment-sender.js";
import {
  NativeLiveMacWakeBrokerClient,
  type NativeLiveWakeBrokerCursor,
} from "../src/domains/bridge/mac/native-live-mac-wake-broker-client.js";
import {
  cleanupOrphanedLocalCheckpointForks,
} from "../tools/claude-bridge/src/local-checkpoint-fork.mjs";

const daemonLock = acquireNativeLiveMacDaemonLock();

await cleanupOrphanedLocalCheckpointForks({
  environment: process.env,
}).then((result) => {
  if (
    result.cleaned > 0
    || result.temporaryReceiptsRemoved > 0
    || result.failures.length > 0
  ) {
    process.stdout.write(
      JSON.stringify({
        at: new Date().toISOString(),
        outcome: "local_checkpoint_fork_cleanup",
        cleaned: result.cleaned,
        temporaryReceiptsRemoved:
          result.temporaryReceiptsRemoved,
        failures: result.failures.length,
      }) + "\n",
    );
  }
  for (const failure of result.failures) {
    process.stderr.write(
      JSON.stringify({
        at: new Date().toISOString(),
        outcome:
          "local_checkpoint_fork_cleanup_failed",
        receipt: failure.receipt,
        error: failure.error,
      }) + "\n",
    );
  }
}).catch((error) => {
  process.stderr.write(
    JSON.stringify({
      at: new Date().toISOString(),
      outcome:
        "local_checkpoint_fork_cleanup_failed",
      error:
        error instanceof Error
          ? error.message
          : String(error),
    }) + "\n",
  );
});

const memeGitHubConfig =
  consumeNativeLiveMacMemeGitHubConfig(process.env);

const {
  relayBaseUrl,
  relayToken,
  wakeBroker,
  listenerInstanceId,
  companionBackgroundIntervalMs,
  defaultWorkingDirectory,
} = resolveNativeLiveMacDaemonConfig(process.env);

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "ANTHROPIC_API_KEY must be unset; native live uses Claude Code subscription auth.",
  );
}

const relay = new NativeLiveMacHttpRelayClient(
  relayBaseUrl,
  relayToken,
);
const silenceWakeScheduler =
  new NativeLiveMacSilenceWakeScheduler(
    relay,
    () => Date.now(),
  );
const wakeBrokerClient =
  wakeBroker
    ? new NativeLiveMacWakeBrokerClient(
        wakeBroker.baseUrl,
        wakeBroker.token,
      )
    : null;
let wakeBrokerCursor: NativeLiveWakeBrokerCursor | null = null;
const companionScheduler = new NativeLiveMacCompanionScheduler(
  relay,
  listenerInstanceId,
  companionBackgroundIntervalMs,
  () => Date.now(),
  (result) => {
    process.stdout.write(
      JSON.stringify({
        at: new Date().toISOString(),
        outcome: "companion_background",
        companionOutcome: result.outcome,
        reason: result.reason,
        ...(
          result.outcome === "offered"
            ? { nextEligibleAt: result.nextEligibleAt }
            : {}
        ),
      }) + "\n",
    );
  },
);
const claudeTransportKind =
  resolveNativeLiveMacClaudeTransportKind(process.env);
const workingDirectoryRuntimePool =
  new NativeLiveMacWorkingDirectoryRuntimePool(
    process.env,
    defaultWorkingDirectory,
    undefined,
    () => null,
    {
      type: "http",
      url: relayBaseUrl + "/internal/native-live-mcp",
      headers: {
        Authorization: "Bearer " + relayToken,
      },
    },
  );
const { runtime } =
  await workingDirectoryRuntimePool.resolveWorkingDirectoryRuntime({
    expectedWorkingDirectory: null,
  });

process.stdout.write(
  JSON.stringify({
    at: new Date().toISOString(),
    outcome: "daemon_config",
    claudeTransport: claudeTransportKind,
    defaultWorkingDirectory,
    providerSessionStore: "local_sdk",
    leileiosMcp: "http_auto_recover",
    wakeMode:
      wakeBrokerClient
        ? "tiny_broker"
        : "relay_long_poll",
    attachments: "private_bucket_bidirectional",
  }) + "\n",
);

await silenceWakeScheduler.refresh().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      at: new Date().toISOString(),
      outcome: "silence_wake_schedule_refresh_failed",
      errorName:
        error instanceof Error ? error.name : "UnknownError",
    }) + "\n",
  );
});

const outputAttachmentSender = new NativeLiveMacOutputAttachmentSender(relay);
const executor = new NativeLiveMacRuntimeExecutor(
  workingDirectoryRuntimePool,
  "/",
  new NativeLiveMacAttachmentMaterializer(relay),
  outputAttachmentSender,
  (diagnostics) => {
    process.stdout.write(
      JSON.stringify({
        at: new Date().toISOString(),
        outcome: "runtime_failure_diagnostics",
        claudeTransport: claudeTransportKind,
        ...diagnostics,
      }) + "\n",
    );
  },
  relay,
  new NativeLiveMacMemeSender(
    outputAttachmentSender,
    memeGitHubConfig,
  ),
);
const backgroundModelExecutor =
  new NativeLiveMacBackgroundModelExecutor(runtime);
const semanticScorer = new LocalE5BreathSemanticScorer();
const loop = new NativeLiveMacDaemonLoop(
  listenerInstanceId,
  relay,
  executor,
  semanticScorer,
  companionScheduler,
  backgroundModelExecutor,
  workingDirectoryRuntimePool,
  workingDirectoryRuntimePool,
  workingDirectoryRuntimePool,
  new NativeLiveMacResultOutbox(join(homedir(), ".leileios", "terminal-results",
    createHash("sha256").update(JSON.stringify([relayBaseUrl, relayToken])).digest("hex"))),
);

let stopping = false;
let activeWorkWaitController: AbortController | null = null;
const stop = () => {
  stopping = true;
  activeWorkWaitController?.abort();
  workingDirectoryRuntimePool.abortAll();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function networkCauseDiagnostics(error: unknown): {
  causeName?: string;
  causeCode?: string;
  causeErrno?: string | number;
  causeSyscall?: string;
} {
  if (!error || typeof error !== "object") return {};
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return {};
  const record = cause as Record<string, unknown>;
  return {
    ...(typeof record.name === "string"
      ? { causeName: record.name }
      : {}),
    ...(typeof record.code === "string"
      ? { causeCode: record.code }
      : {}),
    ...(
      typeof record.errno === "string"
      || typeof record.errno === "number"
        ? { causeErrno: record.errno }
        : {}
    ),
    ...(typeof record.syscall === "string"
      ? { causeSyscall: record.syscall }
      : {}),
  };
}

let consecutiveWakeErrors = 0;

async function waitForWork(): Promise<
  "ready" | "timeout" | "busy" | "retry" | "silence_due" | "stopped"
> {
  if (stopping) return "stopped";
  const controller = new AbortController();
  activeWorkWaitController = controller;
  let silenceDeadlineReached = false;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  const silenceDeadline = silenceWakeScheduler.nextDeadlineAt();
  if (silenceDeadline !== null) {
    const delayMs = Math.max(0, silenceDeadline - Date.now());
    if (delayMs === 0) {
      activeWorkWaitController = null;
      return "silence_due";
    }
    silenceTimer = setTimeout(() => {
      silenceDeadlineReached = true;
      controller.abort();
    }, delayMs);
  }
  try {
    if (wakeBrokerClient) {
      try {
        if (!wakeBrokerCursor) {
          wakeBrokerCursor =
            await wakeBrokerClient.snapshot(
              controller.signal,
            );
          if (stopping || controller.signal.aborted) {
            return "stopped";
          }
          // Re-check durable relay state once after broker recovery so a
          // wake emitted while the broker was unavailable cannot be lost.
          return "ready";
        }

        const result = await wakeBrokerClient.wait({
          cursor: wakeBrokerCursor,
          signal: controller.signal,
        });
        wakeBrokerCursor = result.cursor;
        if (stopping) {
          return "stopped";
        }
        if (silenceDeadlineReached) {
          return "silence_due";
        }
        if (controller.signal.aborted) {
          return "stopped";
        }
        if (result.outcome === "reset") {
          process.stdout.write(
            JSON.stringify({
              at: new Date().toISOString(),
              outcome: "wake_broker_reset",
              claudeTransport: claudeTransportKind,
            }) + "\n",
          );
          return "ready";
        }
        return result.outcome;
      } catch (error) {
        if (stopping) {
          return "stopped";
        }
        if (silenceDeadlineReached) {
          return "silence_due";
        }
        if (controller.signal.aborted) {
          return "stopped";
        }
        process.stderr.write(
          JSON.stringify({
            at: new Date().toISOString(),
            outcome: "wake_broker_retry",
            errorName:
              error instanceof Error
                ? error.name
                : "UnknownError",
            errorMessage:
              error instanceof Error
                ? error.message
                : String(error),
          }) + "\n",
        );
        return "retry";
      }
    }

    const outcome = await relay.waitForWork({
      listenerInstanceId,
      dispatchTarget: "claude_code",
      signal: controller.signal,
    });
    if (stopping) return "stopped";
    if (silenceDeadlineReached) return "silence_due";
    if (controller.signal.aborted) return "stopped";
    return outcome;
  } catch (error) {
    if (stopping) return "stopped";
    if (silenceDeadlineReached) return "silence_due";
    if (controller.signal.aborted) return "stopped";
    throw error;
  } finally {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (activeWorkWaitController === controller) {
      activeWorkWaitController = null;
    }
  }
}

function isWakeTerminalOutcome(
  value: unknown,
): value is
  | "wake_quiet"
  | "wake_stale"
  | "wake_failed"
  | "wake_discarded" {
  return (
    value === "wake_quiet"
    || value === "wake_stale"
    || value === "wake_failed"
    || value === "wake_discarded"
  );
}

while (!stopping) {
  try {
    const outcome = await loop.runOnce();
    consecutiveWakeErrors = 0;
    const wakeTerminalOutcome =
      outcome.outcome === "completed"
      && "canonicalOutcome" in outcome
      && isWakeTerminalOutcome(outcome.canonicalOutcome)
        ? outcome.canonicalOutcome
        : null;
    process.stdout.write(
      JSON.stringify({
        at: new Date().toISOString(),
        outcome: wakeTerminalOutcome ?? outcome.outcome,
        ...(wakeTerminalOutcome
          ? { daemonOutcome: outcome.outcome }
          : {}),
        claudeTransport: claudeTransportKind,
        ...("reservationId" in outcome
          ? { reservationId: outcome.reservationId }
          : {}),
        ...("eventDeliveryFailures" in outcome
          && outcome.eventDeliveryFailures
          ? {
              eventDeliveryFailures:
                outcome.eventDeliveryFailures,
            }
          : {}),
        ...("relayErrorCode" in outcome
          && outcome.relayErrorCode
          ? { relayErrorCode: outcome.relayErrorCode }
          : {}),
        ...("finalizeCode" in outcome
          && outcome.finalizeCode
          ? { finalizeCode: outcome.finalizeCode }
          : {}),
        ...("result" in outcome
          ? {
              resultStatus: outcome.result.status,
              ...(
                outcome.result.status === "failure"
                  ? { errorCode: outcome.result.error_code }
                  : {}
              ),
            }
          : {}),
      }) + "\n",
    );

    if (outcome.outcome === "completed") {
      await silenceWakeScheduler.refresh().catch((error) => {
        process.stderr.write(
          JSON.stringify({
            at: new Date().toISOString(),
            outcome: "silence_wake_schedule_refresh_failed",
            errorName:
              error instanceof Error ? error.name : "UnknownError",
            ...(
              error && typeof error === "object"
              && "relayCode" in error
              && typeof error.relayCode === "string"
                ? { relayCode: error.relayCode }
                : {}
            ),
            ...(
              error && typeof error === "object"
              && "relayMessage" in error
              && typeof error.relayMessage === "string"
                ? { relayMessage: error.relayMessage }
                : {}
            ),
          }) + "\n",
        );
      });
    }

    if (
      outcome.outcome === "completed"
      && outcome.result.status === "success"
    ) {
      companionScheduler.markDirty();
    }

    if (
      outcome.outcome === "completed"
      || outcome.outcome === "semantic_completed"
      || outcome.outcome === "background_completed"
      || outcome.outcome === "provider_session_cleanup_completed"
      || outcome.outcome === "manual_compact_completed"
    ) {
      continue;
    }

    if (outcome.outcome === "idle") {
      if (wakeBrokerClient) {
        // Piggyback bounded background maintenance while the real API is
        // already awake. Never wake the main service on an idle timer.
        await companionScheduler.offer();
      }

      while (!stopping) {
        const wake = await waitForWork();
        if (wake === "stopped") break;
        if (wake === "ready") {
          process.stdout.write(
            JSON.stringify({
              at: new Date().toISOString(),
              outcome: "work_wake",
              claudeTransport: claudeTransportKind,
              wakeSource:
                wakeBrokerClient
                  ? "tiny_broker"
                  : "relay",
            }) + "\n",
          );
          break;
        }
        if (wake === "silence_due") {
          try {
            const fired = await silenceWakeScheduler.fireDue();
            process.stdout.write(
              JSON.stringify({
                at: new Date().toISOString(),
                outcome: "silence_wake",
                silenceOutcome: fired.outcome,
                ...(
                  fired.slot
                    ? { slot: fired.slot }
                    : {}
                ),
                ...(
                  fired.reason
                    ? { reason: fired.reason }
                    : {}
                ),
              }) + "\n",
            );
            if (fired.outcome === "queued") break;
          } catch (error) {
            process.stderr.write(
              JSON.stringify({
                at: new Date().toISOString(),
                outcome: "silence_wake_failed",
                errorName:
                  error instanceof Error
                    ? error.name
                    : "UnknownError",
                ...(
                  error && typeof error === "object"
                  && "relayCode" in error
                  && typeof error.relayCode === "string"
                    ? { relayCode: error.relayCode }
                    : {}
                ),
                ...(
                  error && typeof error === "object"
                  && "relayMessage" in error
                  && typeof error.relayMessage === "string"
                    ? { relayMessage: error.relayMessage }
                    : {}
                ),
              }) + "\n",
            );
            await silenceWakeScheduler
              .refresh()
              .catch(() => null);
            // The backend may have committed the durable wake even if this
            // HTTP response was lost. Probe the relay queue immediately;
            // if nothing committed, the next outer cycle will retry the
            // still-due local slot.
            break;
          }
          continue;
        }
        if (wake === "retry") {
          await sleep(5_000);
          continue;
        }
        if (wake === "busy") {
          await sleep(5_000);
          break;
        }

        if (!wakeBrokerClient) {
          await companionScheduler.offer();
        }
      }
      continue;
    }

    await sleep(outcome.outcome === "busy" ? 5_000 : 1_500);
  } catch (error) {
    if (stopping) break;
    const errorRecord =
      error && typeof error === "object"
        ? error as Record<string, unknown>
        : {};
    const causeDiagnostics = networkCauseDiagnostics(error);
    consecutiveWakeErrors += 1;
    const retryDelayMs = Math.min(
      5_000 * 2 ** Math.min(consecutiveWakeErrors - 1, 3),
      30_000,
    );
    process.stderr.write(
      JSON.stringify({
        at: new Date().toISOString(),
        outcome: "wake_or_poll_error",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error ? error.message : String(error),
        ...causeDiagnostics,
        consecutiveErrors: consecutiveWakeErrors,
        retryDelayMs,
        ...(
          typeof errorRecord.relayCode === "string"
            ? { relayCode: errorRecord.relayCode }
            : {}
        ),
        ...(
          typeof errorRecord.finalizeCode === "string"
            ? { finalizeCode: errorRecord.finalizeCode }
            : {}
        ),
        ...(
          typeof errorRecord.httpStatus === "number"
            ? { httpStatus: errorRecord.httpStatus }
            : {}
        ),
      }) + "\n",
    );
    await sleep(retryDelayMs);
  }
}

daemonLock.release();
