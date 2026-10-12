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


test("ambiguous relay failure enables bounded durable queue rechecks after broker timeouts", () => {
  assert.match(daemonSource, /let durableRecoveryDeadline = 0;/u);
  assert.match(daemonSource, /durableRecoveryDeadline = Date\.now\(\) \+ 6 \* 60_000;/u);
  assert.match(daemonSource, /result\.outcome === "timeout" && Date\.now\(\) < durableRecoveryDeadline/u);
  assert.match(daemonSource, /if \(outcome\.outcome === "completed"[\s\S]*?durableRecoveryDeadline = 0;/u);
  // Do not downgrade broker errors to an unbounded main-relay long poll.
  assert.doesNotMatch(daemonSource, /wakeBrokerCursor\s*=\s*null/u);
});

// Behavioral tests execute the actual daemon control flow and real daemon-loop
// and broker-client classes with a controlled clock and synthetic transports.
import { runDaemonScenario } from "./native-live-mac-daemon-control-fixture.js";

test("behavior: lost committed semantic reservation is recovered after a broker timeout and executes once", async () => {
  const result = await runDaemonScenario({ loseReserveResponse: true, semanticVisibleAt: 50_000, normalTurn: true });
  assert.equal(result.scored, 1);
  assert.equal(result.semanticSubmitted, 1);
  assert.equal(result.executionStarted, 1);
  assert.equal(result.executed, 1);
  assert.equal(result.submitted, 1);
  assert.ok(result.relayProbeTimes.includes(30_000));
  assert.ok(result.relayProbeTimes.includes(55_000));
  assert.ok(result.reserveListeners.every(value => value === "11111111-1111-4111-8111-111111111111"));
  assert.equal(result.silenceFired, 0);
});

test("behavior: timeout probes end at six minutes even when the queue remains empty", async () => {
  const result = await runDaemonScenario({ loseReserveResponse: true, semanticVisibleAt: Infinity });
  assert.ok(result.relayProbeTimes.length > 2);
  assert.ok(result.relayProbeTimes.every(time => time < 360_000));
  assert.ok(result.relayProbeTimes.length <= 16);
  assert.ok(result.brokerWaits > result.relayProbeTimes.length);
  assert.equal(result.executed, 0);
});

test("behavior: repeated broker request failures cannot slide an existing recovery window indefinitely", async () => {
  const result = await runDaemonScenario({ loseReserveResponse: true, semanticVisibleAt: Infinity, brokerErrors: [1, 3, 5, 7] });
  assert.ok(result.brokerErrorTimes.length === 4);
  assert.ok(result.relayProbeTimes.every(time => time < 360_000), `probe times: ${result.relayProbeTimes}`);
  assert.ok(result.sleeps.filter(ms => ms === 5_000).length >= 4);
  assert.equal(result.executed, 0);
});

test("behavior: broker-only outages are bounded from the first failure, without idle model or silence wakes", async () => {
  const result = await runDaemonScenario({ brokerErrors: [1, 3, 5, 7] });
  const deadline = result.brokerErrorTimes[0]! + 360_000;
  assert.ok(result.relayProbeTimes.every(time => time < deadline), `probe times: ${result.relayProbeTimes}`);
  assert.equal(result.executed, 0);
  assert.equal(result.scored, 0);
  assert.equal(result.silenceFired, 0);
});

test("behavior: lost semantic completion receipt still recovers the resulting delayed turn once", async () => {
  const result = await runDaemonScenario({ semantic: true, normalTurn: true, loseSemanticReceipt: true, turnVisibleAt: 45_000 });
  assert.equal(result.scored, 1);
  assert.equal(result.semanticSubmitted, 1);
  assert.equal(result.executed, 1);
  assert.equal(result.submitted, 1);
});

test("behavior: semantic completion clears recovery so subsequent idle broker timeouts do not probe", async () => {
  const result = await runDaemonScenario({ loseReserveResponse: true, semanticVisibleAt: 50_000 });
  assert.equal(result.scored, 1);
  assert.equal(result.executed, 0);
  assert.ok(result.relayProbeTimes.every(time => time <= 55_000));
});

test("behavior: normal task completion clears recovery without a second execution", async () => {
  const result = await runDaemonScenario({ loseReserveResponse: true, semanticVisibleAt: 50_000, normalTurn: true });
  assert.equal(result.executed, 1);
  assert.equal(result.submitted, 1);
  assert.ok(result.relayProbeTimes.every(time => time <= 55_000));
});

test("behavior: ordinary idle timeouts and shutdown do not produce work wakes", async () => {
  const result = await runDaemonScenario({ stopAfterBrokerWait: 3 });
  assert.deepEqual(result.relayProbeTimes, [0]);
  assert.equal(result.workWakes, 0);
  assert.equal(result.brokerWaits, 3);
  assert.equal(result.executed, 0);
  assert.equal(result.silenceFired, 0);
});


test("behavior: a real broker wake after expiry permits a new bounded recovery episode", async () => {
  const result = await runDaemonScenario({ loseReserveResponse: true, semanticVisibleAt: Infinity, freshWorkAt: 500_000, normalTurn: true });
  assert.equal(result.scored, 1);
  assert.equal(result.executed, 1);
  assert.equal(result.submitted, 1);
  assert.ok(result.relayProbeTimes.some(time => time >= 500_000));
  assert.ok(!result.relayProbeTimes.some(time => time >= 360_000 && time < 500_000));
});

test("behavior: another listener owning the lease prevents reservation and execution", async () => {
  const result = await runDaemonScenario({ busy: true });
  assert.deepEqual(result.relayProbeTimes, []);
  assert.equal(result.executionStarted, 0);
  assert.equal(result.executed, 0);
  assert.equal(result.workWakes, 0);
});


test("behavior: repeated relay errors during timeout recovery do not renew the six-minute deadline", async () => {
  const result = await runDaemonScenario({ loseReserveResponse: true, semanticVisibleAt: Infinity, relayErrorCalls: [5, 8] });
  assert.ok(result.sleeps.filter(ms => ms === 5_000).length >= 3);
  assert.ok(result.relayProbeTimes.every(time => time < 360_000), `probe times: ${result.relayProbeTimes}`);
  assert.equal(result.executed, 0);
});
