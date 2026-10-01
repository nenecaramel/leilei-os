import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const daemonSource = readFileSync(
  "scripts/native-live-mac-daemon.ts",
  "utf8",
);

test("wake broker errors retry the broker without re-entering main relay long-poll", () => {
  const brokerStart = daemonSource.indexOf(
    "if (wakeBrokerClient) {",
    daemonSource.indexOf("async function waitForWork"),
  );
  const relayFallback = daemonSource.indexOf(
    "const outcome = await relay.waitForWork",
    brokerStart,
  );
  assert.notEqual(brokerStart, -1);
  assert.notEqual(relayFallback, -1);

  const brokerBlock = daemonSource.slice(
    brokerStart,
    relayFallback,
  );

  assert.doesNotMatch(
    brokerBlock,
    /wakeBrokerCursor\s*=\s*null/u,
  );
  assert.match(
    brokerBlock,
    /outcome:\s*"wake_broker_retry"/u,
  );
  assert.match(
    brokerBlock,
    /return\s+"retry"/u,
  );
});

test("broker retry outcome backs off and does not advertise a work wake", () => {
  assert.match(
    daemonSource,
    /if\s*\(wake\s*===\s*"retry"\)\s*\{[\s\S]*?await sleep\(5_000\);[\s\S]*?continue;/u,
  );
});
