import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { NativeLiveMacDaemonLoop, type NativeLiveMacDaemonRelayClient } from "../src/domains/bridge/mac/native-live-mac-daemon-loop.js";
import { NativeLiveMacWakeBrokerClient } from "../src/domains/bridge/mac/native-live-mac-wake-broker-client.js";
import { flushNativeLiveBackgroundWithListenerLease } from "../src/domains/bridge/mac/native-live-mac-background-lease.js";
import type { NativeLiveRuntimeCommand, NativeLiveRuntimeExecutionResult } from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";

const listener = "11111111-1111-4111-8111-111111111111";
const reservation = "22222222-2222-4222-8222-222222222222";
const prepared = "33333333-3333-4333-8333-333333333333";
const request = "44444444-4444-4444-8444-444444444444";
const conversation = "55555555-5555-4555-8555-555555555555";

// Run the real script's control statements, not a copy of its decisions. AST
// selection intentionally excludes startup: no lock, dotenv, local files,
// daemon/SDK construction, sockets or production configuration are executed.
function daemonControlSource(): string {
  const text = readFileSync("scripts/native-live-mac-daemon.ts", "utf8");
  const ast = ts.createSourceFile("daemon.ts", text, ts.ScriptTarget.ES2022, true);
  const functions = new Set(["waitForWork", "networkCauseDiagnostics", "isWakeTerminalOutcome", "armDurableRecoveryWindow"]);
  const variables = new Set(["consecutiveWakeErrors", "durableRecoveryDeadline"]);
  const selected = ast.statements.filter(statement => {
    if (ts.isFunctionDeclaration(statement)) return functions.has(statement.name?.text ?? "");
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && variables.has(declaration.name.text));
    return ts.isWhileStatement(statement);
  });
  assert.equal(selected.filter(ts.isWhileStatement).length, 1, "expected exactly one production daemon loop");
  assert.ok(selected.some(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "waitForWork"));
  return ts.transpileModule(selected.map(statement => statement.getText(ast)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

export async function runDaemonScenario(options: {
  loseReserveResponse?: boolean;
  semanticVisibleAt?: number;
  semantic?: boolean;
  normalTurn?: boolean;
  loseSemanticReceipt?: boolean;
  turnVisibleAt?: number;
  brokerErrors?: number[];
  durationMs?: number;
  stopAfterBrokerWait?: number;
  busy?: boolean;
  freshWorkAt?: number;
  relayErrorCalls?: number[];
}) {
  let now = 0;
  const horizon = options.durationMs ?? 12 * 60_000;
  const metrics = {
    relayProbeTimes: [] as number[],
    reserveListeners: [] as string[],
    sleeps: [] as number[],
    brokerErrorTimes: [] as number[],
    brokerWaits: 0,
    snapshotCalls: 0,
    scored: 0,
    executionStarted: 0,
    executed: 0,
    submitted: 0,
    semanticSubmitted: 0,
    silenceFired: 0,
    companionOffers: 0,
    workWakes: 0,
    iterations: 0,
  };
  let semanticPending = options.semantic ?? options.loseReserveResponse ?? false;
  let normalPending = options.normalTurn ?? false;
  let reserveResponseLost = false;
  let freshWorkQueued = false;
  let freshReserveResponseLost = false;
  let semanticVisibleAt = options.semanticVisibleAt ?? 0;
  const command: NativeLiveRuntimeCommand = {
    protocol_version: 4, dispatch_target: "claude_code", prepare_id: prepared,
    request_id: request, operation: "send", conversation_id: conversation,
    canonical_user_message_id: "66666666-6666-4666-8666-666666666666",
    runtime_mode: "new", parent_provider_session_id: null, expected_working_directory: null, prompt: "synthetic test input",
  };
  const success: NativeLiveRuntimeExecutionResult = {
    protocol_version: 4, prepare_id: prepared, request_id: request,
    conversation_id: conversation, status: "success", provider_session_id: "test-session", effective_working_directory: null,
    normalized_events: [],
  };
  const relay: NativeLiveMacDaemonRelayClient = {
    async renewLease() { return options.busy ? "busy" : "acquired"; },
    async reserveSemanticScoring(input) {
      metrics.relayProbeTimes.push(now);
      metrics.reserveListeners.push(input.listenerInstanceId);
      if ((options.loseReserveResponse && !reserveResponseLost)
        || options.relayErrorCalls?.includes(metrics.relayProbeTimes.length)) {
        // The durable reservation is retained for this same listener. Only
        // its response is lost; it is not executed by the fake transport.
        reserveResponseLost = true;
        throw new TypeError("synthetic response lost after reservation commit");
      }
      if (freshWorkQueued && !freshReserveResponseLost) {
        freshReserveResponseLost = true;
        throw new TypeError("synthetic new reservation response lost");
      }
      if (!semanticPending || now < semanticVisibleAt) return null;
      return { reservationId: prepared, query: "synthetic query", candidates: [] };
    },
    async submitSemanticScores() {
      metrics.semanticSubmitted++;
      semanticPending = false;
      if (options.loseSemanticReceipt) throw new TypeError("synthetic receipt lost after score commit");
    },
    async submitSemanticFallback() { throw new Error("unexpected fallback"); },
    async reserveNext() {
      if (!normalPending || semanticPending || now < (options.turnVisibleAt ?? 0)) return null;
      return { reservationId: reservation, command };
    },
    async markExecutionStarted() { metrics.executionStarted++; },
    async submitResult() { metrics.submitted++; normalPending = false; },
    async markResultDeliveryUnknown() { throw new Error("unexpected result delivery failure"); },
    async rejectReservation() { throw new Error("unexpected reservation rejection"); },
  };
  const loop = new NativeLiveMacDaemonLoop(listener, relay, {
    async execute() { metrics.executed++; return success; },
  }, {
    async score() { metrics.scored++; return new Map(); },
  });
  const sandbox: Record<string, unknown> = {
    stopping: false, activeWorkWaitController: null,
    listenerInstanceId: listener, claudeTransportKind: "test-only",
    AbortController, Error, TypeError, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return now; } },
    process: {
      stdout: { write(line: string) { if (JSON.parse(line).outcome === "work_wake") metrics.workWakes++; } },
      stderr: { write() {} },
    },
    silenceWakeScheduler: {
      nextDeadlineAt() { return null; },
      async refresh() {},
      async fireDue() { metrics.silenceFired++; throw new Error("unexpected silence wake"); },
    },
    companionScheduler: {
      markDirty() {},
      async offer() { metrics.companionOffers++; },
    },
    persistentRuntime: { backgroundResults: { async flush() { return 0; } } },
    flushNativeLiveBackgroundWithListenerLease,
    relay: {
      renewLease: (input: Parameters<typeof relay.renewLease>[0]) => relay.renewLease(input),
      async waitForWork() { throw new Error("unexpected main relay long-poll"); },
    },
    wakeBrokerCursor: { generation: "broker-generation", version: 0 },
    loop: { async runOnce() {
      assert.ok(++metrics.iterations <= 200, "daemon failed to reach the simulated shutdown");
      return loop.runOnce();
    } },
    async sleep(ms: number) {
      metrics.sleeps.push(ms); now += ms;
      if (now >= horizon) sandbox.stopping = true;
    },
  };
  sandbox.wakeBrokerClient = new NativeLiveMacWakeBrokerClient("https://test-broker.invalid", "test-only", async (url) => {
    assert.ok(String(url).startsWith("https://test-broker.invalid/"));
    if (String(url).endsWith("/state")) {
      metrics.snapshotCalls++;
      return new Response(JSON.stringify({ generation: "broker-generation", version: 0 }));
    }
    metrics.brokerWaits++;
    const error = options.brokerErrors?.includes(metrics.brokerWaits);
    now += error ? 35_000 : 25_000;
    if (now >= horizon || metrics.brokerWaits === options.stopAfterBrokerWait) sandbox.stopping = true;
    if (error) {
      metrics.brokerErrorTimes.push(now);
      throw new DOMException("synthetic broker request timeout", "TimeoutError");
    }
    if (options.freshWorkAt !== undefined && now >= options.freshWorkAt && !freshWorkQueued) {
      freshWorkQueued = true;
      semanticPending = true;
      semanticVisibleAt = now + 50_000;
      return new Response(JSON.stringify({ outcome: "ready", generation: "broker-generation", version: 1 }));
    }
    return new Response(JSON.stringify({ outcome: "timeout", generation: "broker-generation", version: 0 }));
  });
  await vm.runInNewContext(`(async () => { ${daemonControlSource()} })()`, sandbox, { timeout: 1_000 });
  return { ...metrics, now };
}
