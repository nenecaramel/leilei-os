import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { flushNativeLiveBackgroundWithListenerLease } from "../src/domains/bridge/mac/native-live-mac-background-lease.js";

const listener = "11111111-1111-4111-8111-111111111111";

test("expired listener is reacquired before reusing the *same* durable Cron receipt", async () => {
  const calls: string[] = [];
  let commits = 0;
  const input = {
    listenerInstanceId: listener,
    relay: {
      async renewLease(value: { listenerInstanceId: string; dispatchTarget: "claude_code" }) {
        assert.deepEqual(value, { listenerInstanceId: listener, dispatchTarget: "claude_code" });
        calls.push("renew");
        return "acquired" as const;
      },
    },
    backgroundResults: {
      async flush() { calls.push("flush saved receipt"); commits++; return 1; },
    },
  };
  assert.equal(await flushNativeLiveBackgroundWithListenerLease(input), "flushed");
  assert.deepEqual(calls, ["renew", "flush saved receipt"]);
  assert.equal(commits, 1);
});

test("a competing listener's lease prevents any replay of old Claude output", async () => {
  let calls = 0;
  assert.equal(await flushNativeLiveBackgroundWithListenerLease({
    listenerInstanceId: listener,
    relay: { async renewLease() { return "busy"; } },
    backgroundResults: { async flush() { calls++; return 1; } },
  }), "busy");
  assert.equal(calls, 0);
});

test("a relay lease-renewal outage never delivers stale receipts anyway", async () => {
  let calls = 0;
  await assert.rejects(flushNativeLiveBackgroundWithListenerLease({
    listenerInstanceId: listener,
    relay: { async renewLease(): Promise<"acquired"> { throw new Error("network offline"); } },
    backgroundResults: { async flush() { calls++; return 1; } },
  }), /network offline/);
  assert.equal(calls, 0);
});

test("the running daemon wires background replay into the lease-owning dispatcher", () => {
  const source = readFileSync("scripts/native-live-mac-daemon.ts", "utf8");
  assert.match(source, /persistentRuntime\.executor,\s*\{ flush: \(\) => stopping \? Promise\.resolve\(0\) : persistentRuntime\.backgroundResults\.flush\(\) \}/);
  const loop = source.slice(source.indexOf("while (!stopping) {"));
  assert.doesNotMatch(loop, /flushNativeLiveBackgroundWithListenerLease/);
  assert.doesNotMatch(loop, /await persistentRuntime\.backgroundResults\.flush\(\)/);
});
