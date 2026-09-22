import "dotenv/config";
import assert from "node:assert/strict";
import {
  NativeLiveMacDaemonLoop,
} from "../src/domains/bridge/native-live-mac-daemon-loop.js";
import {
  NativeLiveMacHttpRelayClient,
} from "../src/domains/bridge/native-live-mac-http-relay-client.js";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/native-live-mac-runtime-executor.js";

const { HeadlessClaudeTransport } = await import(
  "../tools/claude-bridge/src/headless-claude-transport.mjs"
);

const relayBaseUrl = process.env.LEILEI_NATIVE_LIVE_RELAY_URL;
const relayToken = process.env.LEILEI_NATIVE_LIVE_RELAY_TOKEN;
const listenerInstanceId = process.env.LEILEI_NATIVE_LIVE_LISTENER_ID;

assert.ok(relayBaseUrl, "LEILEI_NATIVE_LIVE_RELAY_URL is required");
assert.ok(relayToken, "LEILEI_NATIVE_LIVE_RELAY_TOKEN is required");
assert.ok(listenerInstanceId, "LEILEI_NATIVE_LIVE_LISTENER_ID is required");
assert.match(
  listenerInstanceId,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  "LEILEI_NATIVE_LIVE_LISTENER_ID must be a UUID",
);
assert.ok(
  !process.env.ANTHROPIC_API_KEY,
  "ANTHROPIC_API_KEY must be unset; native live uses Claude Code subscription auth",
);

const relay = new NativeLiveMacHttpRelayClient(
  relayBaseUrl,
  relayToken,
);
const runtime = new HeadlessClaudeTransport();
const executor = new NativeLiveMacRuntimeExecutor(runtime);
const loop = new NativeLiveMacDaemonLoop(
  listenerInstanceId,
  relay,
  executor,
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

    if (outcome.outcome === "completed") {
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
