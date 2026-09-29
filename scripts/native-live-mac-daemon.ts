import "dotenv/config";
import {
  NativeLiveMacDaemonLoop,
} from "../src/domains/bridge/native-live-mac-daemon-loop.js";
import {
  NativeLiveMacHttpRelayClient,
} from "../src/domains/bridge/native-live-mac-http-relay-client.js";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/native-live-mac-runtime-executor.js";
import {
  NativeLiveMacBackgroundModelExecutor,
} from "../src/domains/bridge/native-live-mac-background-model-executor.js";
import {
  LocalE5BreathSemanticScorer,
} from "../src/domains/runtime/local-e5-embedding.js";
import {
  resolveNativeLiveMacDaemonConfig,
} from "../src/domains/bridge/native-live-mac-daemon-config.js";
import {
  resolveNativeLiveMacClaudeTransportKind,
} from "../src/domains/bridge/native-live-mac-claude-transport.js";
import {
  NativeLiveMacWorkspaceRuntimePool,
} from "../src/domains/bridge/native-live-mac-workspace-runtime.js";
import {
  NativeLiveMacProviderSessionStore,
} from "../src/domains/bridge/native-live-mac-provider-session-store.js";
import {
  NativeLiveMacCompanionScheduler,
} from "../src/domains/bridge/native-live-mac-companion-scheduler.js";
import {
  acquireNativeLiveMacDaemonLock,
} from "../src/domains/bridge/native-live-mac-daemon-lock.js";

const daemonLock = acquireNativeLiveMacDaemonLock();

const {
  relayBaseUrl,
  relayToken,
  listenerInstanceId,
  companionBackgroundIntervalMs,
  baseWorkspaceRoot,
  workspaceRoots,
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
const workspaceRuntimePool =
  new NativeLiveMacWorkspaceRuntimePool(
    process.env,
    baseWorkspaceRoot,
    workspaceRoots,
    undefined,
    (workspaceId) =>
      new NativeLiveMacProviderSessionStore(
        relayBaseUrl,
        relayToken,
        workspaceId,
      ),
  );
const { runtime } =
  await workspaceRuntimePool.resolveWorkspaceRuntime({
    workspaceId: null,
    expectedWorkspaceRoot: null,
  });

process.stdout.write(
  JSON.stringify({
    at: new Date().toISOString(),
    outcome: "daemon_config",
    claudeTransport: claudeTransportKind,
    baseWorkspaceRoot,
    workspaceMappingCount: Object.keys(workspaceRoots).length,
    providerSessionStore: "remote_workspace_scoped",
  }) + "\n",
);

const executor = new NativeLiveMacRuntimeExecutor(
  workspaceRuntimePool,
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
  workspaceRuntimePool,
  workspaceRuntimePool,
  workspaceRuntimePool,
);

let stopping = false;
let activeWorkWaitController: AbortController | null = null;
const stop = () => {
  stopping = true;
  activeWorkWaitController?.abort();
  workspaceRuntimePool.abortAll();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWork(): Promise<
  "ready" | "timeout" | "busy" | "stopped"
> {
  if (stopping) return "stopped";
  const controller = new AbortController();
  activeWorkWaitController = controller;
  try {
    const outcome = await relay.waitForWork({
      listenerInstanceId,
      dispatchTarget: "claude_code",
      signal: controller.signal,
    });
    if (stopping || controller.signal.aborted) return "stopped";
    return outcome;
  } catch (error) {
    if (stopping || controller.signal.aborted) return "stopped";
    throw error;
  } finally {
    if (activeWorkWaitController === controller) {
      activeWorkWaitController = null;
    }
  }
}

while (!stopping) {
  try {
    const outcome = await loop.runOnce();
    process.stdout.write(
      JSON.stringify({
        at: new Date().toISOString(),
        outcome: outcome.outcome,
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
      while (!stopping) {
        const wake = await waitForWork();
        if (wake === "stopped") break;
        if (wake === "ready") {
          process.stdout.write(
            JSON.stringify({
              at: new Date().toISOString(),
              outcome: "work_wake",
              claudeTransport: claudeTransportKind,
            }) + "\n",
          );
          break;
        }
        if (wake === "busy") {
          await sleep(5_000);
          break;
        }

        await companionScheduler.offer();
      }
      continue;
    }

    await sleep(outcome.outcome === "busy" ? 5_000 : 1_500);
  } catch (error) {
    if (stopping) break;
    process.stderr.write(
      JSON.stringify({
        at: new Date().toISOString(),
        outcome: "wake_or_poll_error",
        errorName: error instanceof Error ? error.name : "UnknownError",
      }) + "\n",
    );
    await sleep(5_000);
  }
}

daemonLock.release();
