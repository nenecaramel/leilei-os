import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeLiveMacResultOutbox } from "../src/domains/bridge/mac/native-live-mac-result-outbox.js";
import { NativeLiveMacDaemonLoop } from "../src/domains/bridge/mac/native-live-mac-daemon-loop.js";
import type { NativeLiveMacDaemonRelayClient } from "../src/domains/bridge/mac/native-live-mac-daemon-loop.js";
import type { NativeLiveRuntimeExecutionResult } from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";

for (const status of ["success", "failure"] as const) {
  test(`durable ${status} retries original terminal result after commit/response loss and daemon restart`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "leilei-result-outbox-test-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const result = { protocol_version: 4, prepare_id: "prepare", request_id: "request", conversation_id: "conversation", status,
      ...(status === "success" ? { provider_session_id: "provider", normalized_events: [] } : { error_code: "CLAUDE_PROCESS_FAILED" }),
    } as NativeLiveRuntimeExecutionResult;
    const entry = { listenerInstanceId: "original-owner", reservationId: "prepare", result };
    const outbox = new NativeLiveMacResultOutbox(directory);
    await outbox.save(entry);
    const commits = new Set<string>();
    let loseResponse = true;
    let leasedOwner: string | null = null;
    const relay = {
      async renewLease(input: { listenerInstanceId: string; dispatchTarget: string }) {
        assert.equal(input.dispatchTarget, "claude_code");
        leasedOwner = input.listenerInstanceId;
        return "acquired";
      },
      async submitResult(input: typeof entry) {
        assert.ok(leasedOwner === "new-owner" || leasedOwner === "third-owner", "fresh listener lease precedes receipt replay");
        assert.deepEqual(input, entry);
        commits.add(input.reservationId);
        if (loseResponse) throw new Error("response lost after commit");
        return { canonicalOutcome: "committed" };
      },
    } as unknown as NativeLiveMacDaemonRelayClient;
    const executor = { async execute() { throw new Error("must not execute provider again"); } };
    const loop = new NativeLiveMacDaemonLoop("new-owner", relay, executor, null, null, null, null, null, null, outbox);
    assert.equal((await loop.runOnce()).outcome, "delivery_unknown");
    assert.equal(leasedOwner, "new-owner");
    assert.equal((await new NativeLiveMacResultOutbox(directory).list()).length, 1);
    loseResponse = false;
    const restarted = new NativeLiveMacDaemonLoop("third-owner", relay, executor, null, null, null, null, null, null, new NativeLiveMacResultOutbox(directory));
    assert.equal((await restarted.runOnce()).outcome, "completed");
    assert.equal(leasedOwner, "third-owner");
    assert.equal(commits.size, 1);
    assert.deepEqual(await outbox.list(), []);
  });
}

test("permanent result conflict quarantines exact evidence and allows another conversation after restart", async t => {
  const directory = mkdtempSync(join(tmpdir(), "leilei-terminal-conflict-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const result = { protocol_version: 4, prepare_id: "expired", request_id: "request", conversation_id: "blocked", status: "success", provider_session_id: "provider", normalized_events: [] } as NativeLiveRuntimeExecutionResult;
  const entry = { listenerInstanceId: "old-owner", reservationId: "expired", result };
  const outbox = new NativeLiveMacResultOutbox(directory);
  await outbox.save(entry);
  let conversation = "other", executions = 0;
  const suspended: unknown[] = [];
  const relay = {
    async submitResult(input: typeof entry) {
      if (input.reservationId === "expired") throw Object.assign(new Error("SECRET provider output"), { httpStatus: 409, relayCode: "RESERVATION_CONFLICT" });
    },
    async renewLease() { return "acquired"; },
    async reserveNext() { return { reservationId: "new", command: { conversation_id: conversation, operation: "send" } }; },
    async markExecutionStarted() {}, async rejectReservation() {},
  } as unknown as NativeLiveMacDaemonRelayClient;
  const executor = { async execute() { executions++; return { ...result, prepare_id: "new", conversation_id: conversation }; } };
  const persistent = { canRoute: () => false, async retire() {}, suspend(id: string, reason: string) { suspended.push([id, reason]); } };
  const makeLoop = (withPersistent = true) => new NativeLiveMacDaemonLoop("owner", relay, executor, null, null, null, null, null, null, new NativeLiveMacResultOutbox(directory), withPersistent ? persistent as never : null);
  const stale = await makeLoop().runOnce();
  assert.equal(stale.outcome, "result_recovery_required");
  assert.equal(JSON.stringify(stale).includes("provider"), false);
  assert.deepEqual(await outbox.list(), []);
  assert.deepEqual(await outbox.listQuarantined(), [entry]);
  assert.equal((await makeLoop().runOnce()).outcome, "completed");
  assert.equal(executions, 1);
  assert.deepEqual(suspended, [["blocked", "recovery"], ["blocked", "recovery"]]);
  conversation = "blocked";
  assert.equal((await makeLoop(false).runOnce()).outcome, "result_recovery_required");
  assert.equal(executions, 1, "restart without persistent executor cannot fall through to SDK");
  assert.deepEqual(await outbox.listQuarantined(), [entry]);
});

for (const error of [new Error("network"), { httpStatus: 503, relayCode: "RESERVATION_CONFLICT" }, { httpStatus: 409, relayCode: "RELAY_RESPONSE_INVALID_JSON" }, { relayCode: "RESERVATION_CONFLICT" }]) {
  test(`non-permanent submission keeps original pending evidence: ${JSON.stringify(error)}`, async t => {
    const directory = mkdtempSync(join(tmpdir(), "leilei-terminal-retry-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const result = { prepare_id: "pending", conversation_id: "conversation" } as NativeLiveRuntimeExecutionResult;
    const entry = { listenerInstanceId: "owner", reservationId: "pending", result };
    const outbox = new NativeLiveMacResultOutbox(directory); await outbox.save(entry);
    let renewals = 0;
    const relay = {
      async renewLease() { renewals++; return "acquired"; },
      async submitResult() { assert.equal(renewals, 1); throw error; },
    } as unknown as NativeLiveMacDaemonRelayClient;
    const loop = new NativeLiveMacDaemonLoop("owner", relay, { async execute() { throw new Error("forbidden"); } }, null, null, null, null, null, null, outbox);
    assert.equal((await loop.runOnce()).outcome, "delivery_unknown");
    assert.equal(renewals, 1);
    assert.deepEqual(await outbox.list(), [entry]);
    assert.deepEqual(await outbox.listQuarantined(), []);
  });
}


test("quarantine is an atomic rename retaining original bytes; symlink records and directories fail closed", async t => {
  const directory = mkdtempSync(join(tmpdir(), "leilei-terminal-path-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const entry = { listenerInstanceId: "owner", reservationId: "pending", result: { prepare_id: "pending", conversation_id: "conversation" } as NativeLiveRuntimeExecutionResult };
  const outbox = new NativeLiveMacResultOutbox(directory);
  await outbox.save(entry);
  const filename = readdirSync(directory)[0]!;
  const original = readFileSync(join(directory, filename));
  await outbox.quarantine(entry);
  assert.deepEqual(readdirSync(directory), [filename.replace(".json", ".quarantined.json")]);
  assert.deepEqual(readFileSync(join(directory, readdirSync(directory)[0]!)), original);
  const quarantine = join(directory, readdirSync(directory)[0]!);
  unlinkSync(quarantine);
  const evidence = join(directory, "evidence"); writeFileSync(evidence, original);
  symlinkSync(evidence, quarantine);
  await assert.rejects(outbox.listQuarantined());
  const directoryLink = join(directory, "linked"); symlinkSync(directory, directoryLink);
  await assert.rejects(new NativeLiveMacResultOutbox(directoryLink).listQuarantined(), /symlinks/u);
  assert.deepEqual(readFileSync(evidence), original);
});
