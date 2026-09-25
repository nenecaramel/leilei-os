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
  createNativeLiveMacClaudeTransport,
} from "../src/domains/bridge/native-live-mac-claude-transport.js";
import {
  NativeLiveMacCompanionScheduler,
} from "../src/domains/bridge/native-live-mac-companion-scheduler.js";

const {
  relayBaseUrl,
  relayToken,
  listenerInstanceId,
  companionBackgroundIntervalMs,
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
const {
  kind: claudeTransportKind,
  runtime,
} = await createNativeLiveMacClaudeTransport(process.env);
const executor = new NativeLiveMacRuntimeExecutor(runtime);
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
);

let stopping = false;
const stop = () => {
  stopping = true;
  runtime.abort();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    ) {
      continue;
    }
    await sleep(outcome.outcome === "busy" ? 5_000 : 1_500);
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        at: new Date().toISOString(),
        outcome: "poll_error",
        errorName: error instanceof Error ? error.name : "UnknownError",
      }) + "\n",
    );
    await sleep(5_000);
  }
}
