import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpAbsoluteDeadlineScheduler,
  MAX_TIMER_DELAY_MS,
  McpSessionRegistry,
  type McpSessionNamespace,
} from "../src/mcp/server/session-registry.js";

type DummySession = {
  sessionId: string;
  userId: string;
  namespace: McpSessionNamespace;
  closeCalls: number;
};

type FakeTimer = {
  callback: () => void;
  delayMs: number;
  cancelled: boolean;
  unrefCalls: number;
};

function createFakeTimerHarness() {
  const timers: FakeTimer[] = [];
  const scheduler = createMcpAbsoluteDeadlineScheduler({
    setTimeout: (callback, delayMs) => {
      const timer: FakeTimer = { callback, delayMs, cancelled: false, unrefCalls: 0 };
      timers.push(timer);
      return {
        unref: () => { timer.unrefCalls += 1; },
        timer,
      };
    },
    clearTimeout: (handle) => { handle.timer.cancelled = true; },
  });
  return { scheduler, timers };
}

function createDummy(
  registry: McpSessionRegistry,
  input: Pick<DummySession, "sessionId" | "userId" | "namespace">,
): DummySession {
  const session: DummySession = { ...input, closeCalls: 0 };
  registry.register({
    sessionId: session.sessionId,
    userId: session.userId,
    namespace: session.namespace,
    server: {
      close: async () => {
        session.closeCalls += 1;
      },
    } as never,
    transport: {} as never,
  });
  return session;
}

test("registry records timestamps and balances request activity", async () => {
  let now = 1_000;
  const registry = new McpSessionRegistry({
    now: () => now,
    idleTtlMs: 10_000,
    absoluteTtlMs: 20_000,
  });
  createDummy(registry, { sessionId: "s1", userId: "u1", namespace: "public" });

  const acquired = await registry.acquire("s1", "public");
  assert.equal(acquired?.createdAt, 1_000);
  assert.equal(acquired?.lastActivityAt, 1_000);
  assert.equal(acquired?.inFlightCount, 1);

  now = 2_000;
  registry.finishRequest(acquired!);
  const touched = registry.touch("s1");
  assert.equal(touched?.lastActivityAt, 2_000);
  assert.equal(touched?.inFlightCount, 0);
});

test("registry isolates namespaces and users before transport handling", async () => {
  const registry = new McpSessionRegistry();
  createDummy(registry, { sessionId: "public-1", userId: "u1", namespace: "public" });

  assert.equal(await registry.acquire("public-1", "internal"), null);
  const wrongUser = await registry.acquire("public-1", "public", "u2");
  assert.equal(wrongUser, null);
  assert.ok(await registry.acquire("public-1", "public", "u1"));
});

test("idle expiry closes only idle sessions and absolute expiry is bounded", async () => {
  let now = 0;
  const events: string[] = [];
  const registry = new McpSessionRegistry({
    now: () => now,
    idleTtlMs: 100,
    absoluteTtlMs: 500,
    observer: (event) => events.push(event.name + ":" + event.reason),
  });
  const idle = createDummy(registry, { sessionId: "idle", userId: "u1", namespace: "public" });
  const absolute = createDummy(registry, { sessionId: "absolute", userId: "u1", namespace: "public" });

  const active = await registry.acquire("idle", "public");
  now = 50;
  registry.touch("absolute");
  now = 101;
  await registry.sweep(true);
  assert.ok(registry.find("idle"));
  registry.finishRequest(active!);
  await registry.sweep(true);
  assert.equal(await registry.acquire("idle", "public"), null);
  assert.equal(idle.closeCalls, 1);

  now = 500;
  await registry.sweep(true);
  assert.equal(await registry.acquire("absolute", "public"), null);
  assert.equal(absolute.closeCalls, 1);
  assert.deepEqual(
    events.filter((event) => event.startsWith("mcp_session_closed:")),
    ["mcp_session_closed:idle_ttl", "mcp_session_closed:absolute_ttl"],
  );
});

test("registry close is idempotent and capacity is per user namespace plus process", async () => {
  const registry = new McpSessionRegistry({
    maxPerUser: 2,
    maxTotal: 3,
  });
  createDummy(registry, { sessionId: "a1", userId: "u1", namespace: "public" });
  createDummy(registry, { sessionId: "a2", userId: "u1", namespace: "public" });
  createDummy(registry, { sessionId: "b1", userId: "u1", namespace: "internal" });

  assert.equal(registry.canCreate("u1", "public"), false);
  assert.equal(registry.canCreate("u2", "public"), false);

  await registry.close("a1", "absolute_ttl");
  await registry.close("a1", "absolute_ttl");
  assert.equal(registry.size, 2);
  assert.equal(registry.canCreate("u2", "public"), true);
});

test("transport close cleanup removes the registry entry once", async () => {
  const registry = new McpSessionRegistry();
  const transport = {} as never;
  registry.register({
    sessionId: "s1",
    userId: "u1",
    namespace: "public",
    server: { close: async () => undefined } as never,
    transport,
  });

  registry.handleTransportClose(transport);
  registry.handleTransportClose(transport);

  assert.equal(registry.size, 0);
});

test("chunked absolute deadlines schedule the maximum safe delay before the remainder", () => {
  const { scheduler, timers } = createFakeTimerHarness();
  let callbacks = 0;
  scheduler(MAX_TIMER_DELAY_MS + 1_000, () => { callbacks += 1; });

  assert.deepEqual(timers.map((timer) => timer.delayMs), [MAX_TIMER_DELAY_MS]);
  assert.equal(timers[0]!.unrefCalls, 1);
  timers[0]!.callback();
  assert.deepEqual(timers.map((timer) => timer.delayMs), [MAX_TIMER_DELAY_MS, 1_000]);
  assert.equal(callbacks, 0);
  assert.equal(timers[1]!.unrefCalls, 1);
  timers[1]!.callback();
  timers[1]!.callback();
  assert.equal(callbacks, 1);
});

test("chunked absolute deadlines cancel during the first chunk", () => {
  const { scheduler, timers } = createFakeTimerHarness();
  let callbacks = 0;
  const cancel = scheduler(MAX_TIMER_DELAY_MS + 1_000, () => { callbacks += 1; });
  cancel();

  assert.equal(timers[0]!.cancelled, true);
  timers[0]!.callback();
  assert.equal(timers.length, 1);
  assert.equal(callbacks, 0);
});

test("chunked absolute deadlines cancel during a remainder chunk", () => {
  const { scheduler, timers } = createFakeTimerHarness();
  let callbacks = 0;
  const cancel = scheduler(MAX_TIMER_DELAY_MS + 1_000, () => { callbacks += 1; });
  timers[0]!.callback();
  cancel();

  assert.equal(timers[1]!.cancelled, true);
  timers[1]!.callback();
  assert.equal(timers.length, 2);
  assert.equal(callbacks, 0);
});

test("the default 24-hour absolute TTL needs one timeout", () => {
  const { scheduler, timers } = createFakeTimerHarness();
  let callbacks = 0;
  scheduler(86_400_000, () => { callbacks += 1; });

  assert.deepEqual(timers.map((timer) => timer.delayMs), [86_400_000]);
  timers[0]!.callback();
  assert.equal(callbacks, 1);
  assert.equal(timers.length, 1);
});

test("reservations atomically enforce total and per-user namespace capacity", async () => {
  const registry = new McpSessionRegistry({ maxPerUser: 1, maxTotal: 1 });
  const first = registry.reserve("u1", "public");
  const second = registry.reserve("u1", "public");
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(registry.capacitySize, 1);

  registry.release(first!);
  const afterRelease = registry.reserve("u1", "public");
  assert.ok(afterRelease);
  registry.commit(afterRelease!, {
    sessionId: "committed",
    userId: "u1",
    namespace: "public",
    server: { close: async () => undefined } as never,
    transport: {} as never,
  });
  assert.equal(registry.capacitySize, 1);
  assert.equal(registry.reserve("u2", "public"), null);
});

test("concurrent admissions cannot exceed total or per-user namespace limits", async () => {
  const totalLimited = new McpSessionRegistry({ maxPerUser: 8, maxTotal: 1 });
  const totalResults = await Promise.all([
    totalLimited.admit("u1", "public"),
    totalLimited.admit("u2", "public"),
  ]);
  assert.equal(totalResults.filter(Boolean).length, 1);
  assert.equal(totalLimited.capacitySize, 1);

  const userLimited = new McpSessionRegistry({ maxPerUser: 1, maxTotal: 8 });
  const userResults = await Promise.all([
    userLimited.admit("u1", "public"),
    userLimited.admit("u1", "public"),
  ]);
  assert.equal(userResults.filter(Boolean).length, 1);
  assert.equal(userLimited.capacitySize, 1);
});

test("reservation release after failed initialize leaves capacity available", () => {
  const registry = new McpSessionRegistry({ maxTotal: 1 });
  const reservation = registry.reserve("u1", "public");
  assert.ok(reservation);
  registry.release(reservation!);
  assert.equal(registry.capacitySize, 0);
  assert.ok(registry.reserve("u2", "public"));
});

test("expired capacity is reclaimed even inside the lazy sweep throttle window", async () => {
  let now = 0;
  const events: string[] = [];
  const registry = new McpSessionRegistry({
    now: () => now,
    maxTotal: 1,
    idleTtlMs: 100,
    absoluteTtlMs: 1_000,
    sweepMinIntervalMs: 1_000,
    observer: (event) => events.push(event.name + ":" + event.reason),
  });
  const session = createDummy(registry, { sessionId: "expired", userId: "u1", namespace: "public" });
  await registry.sweep();
  now = 101;
  const reservation = await registry.admit("u2", "public");
  assert.ok(reservation);
  assert.equal(session.closeCalls, 1);
  assert.deepEqual(events.filter((event) => event.startsWith("mcp_session_closed:")), ["mcp_session_closed:idle_ttl"]);
});

test("explicit close reason is consumed once and unsolicited transport close remains distinct", async () => {
  const events: string[] = [];
  const registry = new McpSessionRegistry({ observer: (event) => events.push(event.name + ":" + event.reason) });
  const explicitTransport = {};
  registry.register({
    sessionId: "explicit",
    userId: "u1",
    namespace: "public",
    server: { close: async () => undefined } as never,
    transport: explicitTransport,
  });
  const explicit = registry.find("explicit")!;
  registry.expectClose(explicit);
  registry.handleTransportClose(explicitTransport);

  const transport = {};
  registry.register({
    sessionId: "transport",
    userId: "u1",
    namespace: "public",
    server: { close: async () => undefined } as never,
    transport,
  });
  registry.handleTransportClose(transport);
  assert.deepEqual(events, ["mcp_session_created:undefined", "mcp_session_closed:client_close", "mcp_session_created:undefined", "mcp_session_closed:transport_close"]);
});

test("absolute deadline closes an idle session without a request or sweep", async () => {
  const deadlines: Array<{ callback: () => void; cancelled: boolean }> = [];
  const events: string[] = [];
  const registry = new McpSessionRegistry({
    absoluteTtlMs: 86_400_000,
    scheduleAbsoluteDeadline: (_delay, callback) => {
      const deadline = { callback, cancelled: false };
      deadlines.push(deadline);
      return () => { deadline.cancelled = true; };
    },
    observer: (event) => events.push(`${event.name}:${event.reason ?? ""}`),
  });
  const session = createDummy(registry, { sessionId: "hard-deadline", userId: "u1", namespace: "public" });
  assert.equal(deadlines.length, 1);
  deadlines[0]!.callback();
  await Promise.resolve();
  assert.equal(registry.find(session.sessionId), null);
  assert.equal(session.closeCalls, 1);
  assert.deepEqual(events.filter((event) => event.startsWith("mcp_session_closed:")), ["mcp_session_closed:absolute_ttl"]);
});

test("absolute deadline is cancelled when registration observer closes the session", () => {
  let registry!: McpSessionRegistry;
  let cancelled = false;
  registry = new McpSessionRegistry({
    scheduleAbsoluteDeadline: (_delay, _callback) => () => { cancelled = true; },
    observer: (event) => {
      if (event.name === "mcp_session_created") {
        void registry.close("observer-close", "transport_close");
      }
    },
  });
  registry.register({
    sessionId: "observer-close",
    userId: "u1",
    namespace: "public",
    server: { close: async () => undefined },
    transport: {},
  });
  assert.equal(registry.size, 0);
  assert.equal(cancelled, true);
});

test("absolute deadline closes an in-flight session and wins the idle protection", async () => {
  const deadlines: Array<() => void> = [];
  let now = 0;
  const registry = new McpSessionRegistry({
    now: () => now,
    idleTtlMs: 1,
    absoluteTtlMs: 86_400_000,
    scheduleAbsoluteDeadline: (_delay, callback) => {
      deadlines.push(callback);
      return () => undefined;
    },
  });
  const session = createDummy(registry, { sessionId: "in-flight-deadline", userId: "u1", namespace: "public" });
  const acquired = await registry.acquire(session.sessionId, "public");
  assert.equal(acquired?.inFlightCount, 1);
  deadlines[0]!();
  await Promise.resolve();
  assert.equal(registry.find(session.sessionId), null);
  assert.equal(session.closeCalls, 1);
});

test("all close paths cancel the absolute deadline and never emit a second close", async () => {
  const deadlines: Array<{ callback: () => void; cancelled: boolean }> = [];
  const closedReasons: string[] = [];
  let now = 0;
  const registry = new McpSessionRegistry({
    idleTtlMs: 10,
    absoluteTtlMs: 100,
    now: () => now,
    scheduleAbsoluteDeadline: (_delay, callback) => {
      const deadline = { callback, cancelled: false };
      deadlines.push(deadline);
      return () => { deadline.cancelled = true; };
    },
    observer: (event) => {
      if (event.name === "mcp_session_closed") closedReasons.push(event.reason);
    },
  });
  const client = createDummy(registry, { sessionId: "client-close", userId: "u1", namespace: "public" });
  await registry.close(client.sessionId, "client_close");
  deadlines[0]!.callback();

  const transport = {};
  const transportSession = { sessionId: "transport-close", userId: "u1", namespace: "public" as const, closeCalls: 0 };
  registry.register({
    sessionId: transportSession.sessionId,
    userId: transportSession.userId,
    namespace: transportSession.namespace,
    server: { close: async () => { transportSession.closeCalls += 1; } },
    transport,
  });
  registry.handleTransportClose(transport);
  deadlines[1]!.callback();

  const idle = createDummy(registry, { sessionId: "idle-close", userId: "u1", namespace: "public" });
  now = 22;
  await registry.sweep(true);
  deadlines[2]!.callback();

  assert.deepEqual(deadlines.map((deadline) => deadline.cancelled), [true, true, true]);
  assert.deepEqual(closedReasons, ["client_close", "transport_close", "idle_ttl"]);
  assert.equal(client.closeCalls, 1);
  assert.equal(registry.find(transportSession.sessionId), null);
  assert.equal(idle.closeCalls, 1);
});

test("absolute deadline and another close racing still remove once and reclaim capacity once", async () => {
  const deadlines: Array<() => void> = [];
  const events: string[] = [];
  const registry = new McpSessionRegistry({
    maxTotal: 1,
    scheduleAbsoluteDeadline: (_delay, callback) => {
      deadlines.push(callback);
      return () => undefined;
    },
    observer: (event) => {
      if (event.name === "mcp_session_closed") events.push(event.reason);
    },
  });
  const session = createDummy(registry, { sessionId: "race", userId: "u1", namespace: "public" });
  await Promise.all([
    registry.close(session.sessionId, "client_close"),
    Promise.resolve().then(() => deadlines[0]!()),
  ]);
  assert.equal(registry.size, 0);
  assert.equal(registry.capacitySize, 0);
  assert.deepEqual(events, ["client_close"]);
  assert.equal(session.closeCalls, 1);
  assert.ok(registry.reserve("u2", "public"));
});
