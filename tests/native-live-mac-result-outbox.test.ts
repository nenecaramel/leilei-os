import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
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
    const relay = {
      async submitResult(input: typeof entry) {
        assert.deepEqual(input, entry);
        commits.add(input.reservationId);
        if (loseResponse) throw new Error("response lost after commit");
        return { canonicalOutcome: "committed" };
      },
    } as unknown as NativeLiveMacDaemonRelayClient;
    const executor = { async execute() { throw new Error("must not execute provider again"); } };
    const loop = new NativeLiveMacDaemonLoop("new-owner", relay, executor, null, null, null, null, null, null, outbox);
    assert.equal((await loop.runOnce()).outcome, "delivery_unknown");
    assert.equal((await new NativeLiveMacResultOutbox(directory).list()).length, 1);
    loseResponse = false;
    const restarted = new NativeLiveMacDaemonLoop("third-owner", relay, executor, null, null, null, null, null, null, new NativeLiveMacResultOutbox(directory));
    assert.equal((await restarted.runOnce()).outcome, "completed");
    assert.equal(commits.size, 1);
    assert.deepEqual(await outbox.list(), []);
  });
}
