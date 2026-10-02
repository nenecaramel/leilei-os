import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacCompanionScheduler,
  type NativeLiveMacCompanionBackgroundClient,
} from "../src/domains/bridge/mac/native-live-mac-companion-scheduler.js";

const listenerInstanceId =
  "11111111-1111-4111-8111-111111111111";

class FakeClient
implements NativeLiveMacCompanionBackgroundClient {
  calls: unknown[] = [];
  error: Error | null = null;
  gate: Promise<void> | null = null;

  async offerCompanionBackgroundOpportunity(input: unknown) {
    this.calls.push(input);
    if (this.gate) await this.gate;
    if (this.error) throw this.error;
    return { accepted: true };
  }
}

test("first idle offer performs one startup catch-up and then respects cadence", async () => {
  let now = Date.parse("2026-09-25T00:00:00.000Z");
  const client = new FakeClient();
  const scheduler = new NativeLiveMacCompanionScheduler(
    client,
    listenerInstanceId,
    60_000,
    () => now,
  );

  assert.deepEqual(await scheduler.offer(), {
    outcome: "offered",
    reason: "startup",
    nextEligibleAt: "2026-09-25T00:01:00.000Z",
  });
  assert.equal(client.calls.length, 1);

  now += 30_000;
  assert.deepEqual(await scheduler.offer(), {
    outcome: "not_due",
    nextEligibleAt: "2026-09-25T00:01:00.000Z",
  });
  assert.equal(client.calls.length, 1);

  now += 30_000;
  assert.deepEqual(await scheduler.offer(), {
    outcome: "offered",
    reason: "due",
    nextEligibleAt: "2026-09-25T00:02:00.000Z",
  });
  assert.equal(client.calls.length, 2);
});

test("successful foreground work marks the next idle opportunity dirty", async () => {
  let now = Date.parse("2026-09-25T00:00:00.000Z");
  const client = new FakeClient();
  const scheduler = new NativeLiveMacCompanionScheduler(
    client,
    listenerInstanceId,
    3_600_000,
    () => now,
  );

  await scheduler.offer();
  now += 1_000;
  scheduler.markDirty();

  const result = await scheduler.offer();
  assert.deepEqual(result, {
    outcome: "offered",
    reason: "dirty",
    nextEligibleAt: "2026-09-25T01:00:01.000Z",
  });
  assert.equal(client.calls.length, 2);
});

test("failed opportunity does not consume startup or due state", async () => {
  const now = Date.parse("2026-09-25T00:00:00.000Z");
  const client = new FakeClient();
  client.error = new Error("relay unavailable");
  const scheduler = new NativeLiveMacCompanionScheduler(
    client,
    listenerInstanceId,
    60_000,
    () => now,
  );

  assert.deepEqual(await scheduler.offer(), {
    outcome: "failed",
    reason: "startup",
  });
  assert.equal(client.calls.length, 1);

  client.error = null;
  assert.deepEqual(await scheduler.offer(), {
    outcome: "offered",
    reason: "startup",
    nextEligibleAt: "2026-09-25T00:01:00.000Z",
  });
  assert.equal(client.calls.length, 2);
});

test("concurrent idle offers coalesce into one authority request", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = new FakeClient();
  client.gate = gate;
  const scheduler = new NativeLiveMacCompanionScheduler(
    client,
    listenerInstanceId,
    60_000,
    () => Date.parse("2026-09-25T00:00:00.000Z"),
  );

  const first = scheduler.offer();
  const second = scheduler.offer();
  assert.equal(client.calls.length, 1);

  release();
  assert.deepEqual(await first, await second);
  assert.equal(client.calls.length, 1);
});

test("dirty signal arriving during an in-flight startup offer is not lost", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = new FakeClient();
  client.gate = gate;
  const scheduler = new NativeLiveMacCompanionScheduler(
    client,
    listenerInstanceId,
    60_000,
    () => Date.parse("2026-09-25T00:00:00.000Z"),
  );

  const startup = scheduler.offer();
  scheduler.markDirty();
  release();
  await startup;

  client.gate = null;
  const next = await scheduler.offer();
  assert.equal(next.outcome, "offered");
  if (next.outcome !== "offered") {
    throw new Error("expected dirty offer");
  }
  assert.equal(next.reason, "dirty");
  assert.equal(client.calls.length, 2);
});


test("opportunity observer records offered and failed remote attempts without not-due noise", async () => {
  let now = Date.parse("2026-09-25T00:00:00.000Z");
  const client = new FakeClient();
  const observed: unknown[] = [];
  const scheduler = new NativeLiveMacCompanionScheduler(
    client,
    listenerInstanceId,
    60_000,
    () => now,
    (result) => {
      observed.push(result);
    },
  );

  assert.equal((await scheduler.offer()).outcome, "offered");
  now += 30_000;
  assert.equal((await scheduler.offer()).outcome, "not_due");
  assert.deepEqual(observed, [{
    outcome: "offered",
    reason: "startup",
    nextEligibleAt: "2026-09-25T00:01:00.000Z",
  }]);

  now += 30_000;
  client.error = new Error("relay unavailable");
  assert.equal((await scheduler.offer()).outcome, "failed");
  assert.deepEqual(observed.at(-1), {
    outcome: "failed",
    reason: "due",
  });
});

test("opportunity observer failure is acceptance-only and never changes scheduler outcome", async () => {
  const client = new FakeClient();
  const scheduler = new NativeLiveMacCompanionScheduler(
    client,
    listenerInstanceId,
    60_000,
    () => Date.parse("2026-09-25T00:00:00.000Z"),
    () => {
      throw new Error("observer unavailable");
    },
  );

  assert.deepEqual(await scheduler.offer(), {
    outcome: "offered",
    reason: "startup",
    nextEligibleAt: "2026-09-25T00:01:00.000Z",
  });
});
