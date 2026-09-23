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

const { HeadlessClaudeTransport } = await import(
  "../tools/claude-bridge/src/headless-claude-transport.mjs"
);

const {
  relayBaseUrl,
  relayToken,
  listenerInstanceId,
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
const runtime = new HeadlessClaudeTransport();
const executor = new NativeLiveMacRuntimeExecutor(runtime);
const backgroundModelExecutor =
  new NativeLiveMacBackgroundModelExecutor(runtime);
const semanticScorer = new LocalE5BreathSemanticScorer();
const loop = new NativeLiveMacDaemonLoop(
  listenerInstanceId,
  relay,
  executor,
  semanticScorer,
  {
    async offer() {
      await relay.offerTopicResurfaceOpportunity({
        listenerInstanceId,
        dispatchTarget: "claude_code",
      });
    },
  },
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
        ...("reservationId" in outcome
          ? { reservationId: outcome.reservationId }
          : {}),
      }) + "\n",
    );

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
